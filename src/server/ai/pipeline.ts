import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runDetached } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { buildRagContext } from "@/server/ai/rag/rag-builder";
import {
  addProductToCart,
  buscarProductos,
  confirmarPedido,
} from "@/server/ecommerce/service";
import { customerProductLabel } from "@/server/ecommerce/quantity";
import { createPaymentLink } from "@/server/payments/mercadopago";
import { renderPriceDisclosure } from "@/server/ecommerce/pricing";
import { parseSlashCommand, processNaturalAddToCart, processPendingProductQuantity, processSlashCommand } from "@/server/ai/commands";
import { resolveMenuInput, type MenuStateMetadata } from "@/server/ai/menu-fsm";
import { classifyConversationInput, guardReply } from "@/server/ai/conversation-guard";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  organizationId: string;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
  pendingImmediate?: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(organizationId: string, conversationId: string, immediate = false): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    organizationId,
    timer: null,
    running: false,
    pending: false,
    pendingImmediate: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true;
    if (immediate) {
      entry.pendingImmediate = true;
    }
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = immediate ? 50 : getEnv().AGENT_COALESCE_MS;
  if (delay === 0) {
    entry.timer = null;
    runDetached(() => void executeTurn(conversationId));
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    runDetached(() => void executeTurn(conversationId));
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  console.log(`[debug] executeTurn started for ${conversationId}`);
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) {
    console.log(`[debug] executeTurn returning early: entry=${!!entry}, running=${entry?.running}`);
    return;
  }
  entry.running = true;
  try {
    await withJobTransaction(entry.organizationId, "executeTurn-1", async () => {
      await runAgentTurn(conversationId);
    });
  } catch (err) {
    console.error("[agente] turno falló:", err);
    try {
      await withJobTransaction(entry.organizationId, "executeTurn-2", async () => {
        const db = getDb();
        await db.insert(schema.message).values({
          id: newId("message"),
          organizationId: entry.organizationId,
          conversationId,
          direction: "out",
          status: "failed",
          text: "⚠️ El agente encontró un error interno y no pudo responder.",
          error: String(err instanceof Error ? err.stack || err.message : err).slice(0, 1000),
          aiGenerated: true,
        });
      });
    } catch (dbErr) {
      console.error("[agente] no se pudo registrar el error en la BD:", dbErr);
    }
  } finally {
    entry.running = false;
    if (entry.pending) {
      const nextImmediate = entry.pendingImmediate ?? false;
      entry.pending = false;
      entry.pendingImmediate = false;
      if (nextImmediate) {
        runDetached(() => void executeTurn(conversationId));
      } else {
        scheduleAgentTurn(entry.organizationId, conversationId, false);
      }
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta un turno del agente IA (FR-020, FR-021).
 * Recibe el conversationId, extrae historial, evalúa contexto RAG + FSB y despacha acciones.
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  console.log(`[debug] runAgentTurn started for ${conversationId}`);
  const db = getDb();

  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) {
    console.log(`[debug] runAgentTurn returning early: no conversation found`);
    return;
  }

  const { organizationId } = conversation;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    console.log(`[debug] runAgentTurn returning early: no profile found`);
    return;
  }

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);

  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");

  if (!lastInbound) {
    console.log(`[debug] runAgentTurn returning early: no lastInbound found`);
    return;
  }
  console.log(`[debug] runAgentTurn passed all early returns! Calling dispatch...`);

  const state = (conversation.stateMetadata ?? {}) as Record<string, unknown>;
  console.log(`[debug] current_state=${state.current_state}`);
  if (lastInbound.text && state.current_state === "cart:awaiting_quantity") {
    console.log(`[debug] calling processPendingProductQuantity`);
    const navigation = parseSlashCommand(lastInbound.text);
    if (navigation === "nav:home" || navigation === "nav:back") {
      const result = await processSlashCommand({
        command: navigation, conversation, lastInboundExternalId: lastInbound.externalMessageId, profile,
      });
      if (result.handled) return;
    }
    if (await processPendingProductQuantity({
      conversation, text: lastInbound.text, lastInboundExternalId: lastInbound.externalMessageId,
    })) return;
  }

  // Intercepción directa de Comandos Slash (/start, /menu, /reset, /humano)
  if (lastInbound.text) {
    let slashCmd = parseSlashCommand(lastInbound.text);
    console.log(`[debug] parsed slashCmd: ${slashCmd} for text: ${lastInbound.text}`);
    if (slashCmd) {
      const contextual =
        slashCmd.startsWith("menu:") ||
        slashCmd.startsWith("nav:") ||
        slashCmd.startsWith("catalog:category:") ||
        slashCmd.startsWith("catalog:product:") ||
        slashCmd.startsWith("cart:") ||
        slashCmd.startsWith("order:");
      if (contextual) {
        const decision = resolveMenuInput(state as MenuStateMetadata,
          slashCmd === "nav:home"
            ? { type: "home" }
            : slashCmd === "nav:back"
              ? { type: "back" }
              : { type: "action", action: slashCmd });
        if (decision.kind === "ignore") return;
        if (decision.kind === "action") slashCmd = decision.action as typeof slashCmd;
      }
      // /start y /reset se permiten siempre incluso si la conversación estaba en handoff humano
      if (!conversation.handoffAt || slashCmd === "start" || slashCmd === "reset") {
        console.log(`[debug] calling processSlashCommand for cmd=${slashCmd}`);
        const cmdResult = await processSlashCommand({
          command: slashCmd,
          conversation,
          lastInboundExternalId: lastInbound.externalMessageId,
          profile,
        });
        console.log(`[debug] processSlashCommand returned`);
        if (cmdResult.handled) return;
      }
    }
  }

  if (!conversation.aiEnabled || conversation.handoffAt) {
    console.log(`[debug] returning because aiEnabled=${conversation.aiEnabled}, handoffAt=${conversation.handoffAt}`);
    return;
  }

  if (lastInbound.text) {
    console.log(`[debug] checking guardrails for text: ${lastInbound.text}`);
    const guard = classifyConversationInput(lastInbound.text);
    const previousStrikes = Number(state.guard_offensive_strikes) || 0;
    if (guard) {
      const strikes = guard === "offensive" ? previousStrikes + 1 : 0;
      await db.update(schema.conversation).set({
        stateMetadata: { ...state, guard_offensive_strikes: strikes },
        updatedAt: new Date(),
      }).where(eq(schema.conversation.id, conversationId));
      await deliverReply(conversation, guardReply(guard, strikes));
      return;
    }
    if (previousStrikes > 0) {
      await db.update(schema.conversation).set({
        stateMetadata: { ...state, guard_offensive_strikes: 0 },
        updatedAt: new Date(),
      }).where(eq(schema.conversation.id, conversationId));
    }
  }

  if (lastInbound.text && await processNaturalAddToCart({
    conversation,
    text: lastInbound.text,
    lastInboundExternalId: lastInbound.externalMessageId,
  })) return;

  if (!conversation.isTest && !profile.enabled) return;

  if (!isAiConfigured()) return;

  
  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    if (profile.humanAvailable) {
      await applyHandoff(conversationId, organizationId, "cliente");
    } else {
      await deliverReply(
        conversation,
        "En este momento no contamos con un agente humano disponible en línea. Hemos tomado nota de tu solicitud para nuestro equipo, pero mientras tanto ¡puedes seguir consultándome cualquier duda o catálogo! 🙏"
      );
    }
    return;
  }

  // Inyección de RAG y Búsqueda Vectorial Coseno (Paso 3.3)
  const ragResult = await buildRagContext({
    organizationId,
    // El Laboratorio es un sandbox: reutiliza el conocimiento persistido sin
    // abrir conexiones hacia proveedores externos de embeddings.
    query: conversation.isTest ? null : lastInbound.text,
  });

  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb: ragResult.entries,
        stages,
        ragContext: ragResult.contextText,
        stateMetadata: (conversation.stateMetadata as Record<string, unknown>) ?? {},
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    if (profile.humanAvailable) {
      await applyHandoff(conversationId, organizationId, "error");
    }
    return;
  }

  let action: AgentActionType = result.data;

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (profile.humanAvailable) {
        if (action.farewell) {
          await deliverReply(conversation, action.farewell);
        }
        await applyHandoff(conversationId, organizationId, "modelo");
      } else {
        await deliverReply(
          conversation,
          action.farewell ||
            "En este momento no contamos con un agente humano disponible en línea. Hemos tomado nota de tu solicitud para nuestro equipo, pero mientras tanto ¡puedes seguir consultándome cualquier duda o catálogo! 🙏"
        );
      }
      return;
    }
    case "actualizar_variable": {
      const currentState = (conversation.stateMetadata as Record<string, unknown>) ?? {};
      const newState = {
        ...currentState,
        [action.clave]: action.valor,
      };
      await db
        .update(schema.conversation)
        .set({ stateMetadata: newState })
        .where(eq(schema.conversation.id, conversationId));
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
    case "enviar_menu_opciones": {
      const isTelegram = lastInbound?.channel === "telegram";
      if (isTelegram) {
        const replyMarkup = {
          inline_keyboard: action.botones.map((b) => [
            { text: b.texto, callback_data: b.payload || b.texto },
          ]),
        };
        await deliverReply(conversation, action.titulo, { replyMarkup });
      } else {
        const menuText =
          `${action.titulo}\n\n` +
          action.botones.map((b, idx) => `${idx + 1}. ${b.texto}`).join("\n");
        await deliverReply(conversation, menuText);
      }
      return;
    }
    case "buscar_producto": {
      const productos = await buscarProductos({
        organizationId,
        query: action.query,
      });
      if (productos.length > 0 && productos[0]) {
        const currentState = (conversation.stateMetadata as Record<string, unknown>) ?? {};
        await db.update(schema.conversation).set({
          stateMetadata: {
            ...currentState,
            selectedProductId: productos[0].id,
            last_searched_product_ids: productos.map((p) => p.id),
          },
          updatedAt: new Date(),
        }).where(eq(schema.conversation.id, conversationId));
      }
      const resText = productos.length > 0
        ? `📦 Productos encontrados:\n${productos
          .map((p) => `${[p.name, p.description].filter(Boolean).join(" — ")} — $${p.price.toLocaleString("es-CL")} CLP (Stock: ${p.stock})`)
          .join("\n")}`
        : `No encontré productos con "${action.query}" en el catálogo actual. Puedo mostrarte las categorías disponibles.`;
      await deliverReply(conversation, resText);
      return;
    }
    case "agregar_producto": {
      let productId = action.productId;
      const qty = action.cantidad || 1;
      const state = (conversation.stateMetadata as Record<string, unknown>) ?? {};

      if (!productId && action.query) {
        const productos = await buscarProductos({ organizationId, query: action.query });
        if (productos.length > 0 && productos[0]) {
          productId = productos[0].id;
        }
      }
      if (!productId) {
        if (typeof state.selectedProductId === "string") {
          productId = state.selectedProductId;
        } else if (Array.isArray(state.last_searched_product_ids) && typeof state.last_searched_product_ids[0] === "string") {
          productId = state.last_searched_product_ids[0];
        }
      }
      if (productId) {
        const result = await addProductToCart({
          organizationId,
          conversationId,
          productId,
          quantity: qty,
        });
        if (result.ok) {
          await deliverReply(
            conversation,
            action.reply ||
              `✅ Agregamos ${customerProductLabel(result.product)}, cantidad ${qty}, a tu carrito.\n\n🛒 Carrito: ${result.units} productos · Total: $${result.totalAmount.toLocaleString("es-CL")} CLP\n\n¿Deseas agregar algo más o confirmamos la compra?`
          );
          return;
        }
      }
      await deliverReply(
        conversation,
        action.reply || "No pudimos agregar el producto al carrito. Por favor indícame el nombre exacto del producto."
      );
      return;
    }
    case "mostrar_pedido": {
      await processSlashCommand({
        command: "menu:carrito",
        conversation,
        lastInboundExternalId: lastInbound?.externalMessageId,
        profile,
      });
      return;
    }
    case "cancelar_pedido": {
      await processSlashCommand({
        command: "order:cancel:active",
        conversation,
        lastInboundExternalId: lastInbound?.externalMessageId,
        profile,
      });
      return;
    }
    case "mostrar_catalogo": {
      await processSlashCommand({
        command: "menu:categorias",
        conversation,
        lastInboundExternalId: lastInbound?.externalMessageId,
        profile,
      });
      return;
    }
    case "confirmar_pedido": {
      const res = await confirmarPedido({
        organizationId,
        conversationId,
      });
      if (res.ok) {
        const stageMatch =
          resolveStage("Interesado / Pedido", stages) ||
          resolveStage("Interesado", stages) ||
          resolveStage("Pedido", stages) ||
          stages.find(
            (s) =>
              s.name.toLowerCase().includes("interesado") ||
              s.name.toLowerCase().includes("pedido")
          );
        if (stageMatch) {
          await moveLeadToStage(
            organizationId,
            conversation.contactId,
            stageMatch.id
          );
        }
        publish(organizationId, {
          type: "conversation.updated",
          data: { conversation: { id: conversationId } },
        });
        if (res.priceChanges?.length) {
          await deliverReply(conversation, renderPriceDisclosure(res.priceChanges, res.order.totalAmount));
        }
        const resText =
          action.reply ||
          `¡Pedido confirmado exitosamente! Número de pedido: ${res.order.orderNumber}. Total definitivo: $${res.order.totalAmount.toLocaleString("es-CL")} CLP.`;
        await deliverReply(conversation, resText);
        await processSlashCommand({
          command: `order:detail:${res.order.id}`,
          conversation,
          lastInboundExternalId: lastInbound?.externalMessageId,
          profile,
          navigationStack: ["menu:main", "menu:orders"],
        });
      } else {
        if (res.error === "active_order_limit") {
          await processSlashCommand({
            command: "cart:checkout",
            conversation,
            lastInboundExternalId: lastInbound?.externalMessageId,
            profile,
          });
          return;
        }
        const resText = res.error === "stock_changed"
          ? `No pude confirmar el pedido porque cambió el stock. Disponibilidad actual: ${res.available}; solicitadas: ${res.requested}.`
          : res.error === "tenant_limit_exceeded"
            ? `No pude confirmar el pedido: el máximo permitido es ${res.limit} unidades por producto.`
            : res.error === "invalid_cart"
              ? "No pude confirmar el pedido porque el carrito contiene cantidades inválidas."
              : `No pude confirmar el pedido porque su carrito está vacío.`;
        await deliverReply(conversation, resText);
      }
      return;
    }
    case "generar_link_pago": {
      const res = await createPaymentLink(organizationId, action.orderId);
      if (res.ok && res.url) {
        const resText = action.reply 
          ? `${action.reply}\n\nPuedes pagar aquí: ${res.url}`
          : `Aquí tienes tu link de pago para MercadoPago: ${res.url}`;
        await deliverReply(conversation, resText);
      } else {
        const resText = action.reply || "Hubo un error al generar el link de pago. Por favor intenta más tarde.";
        await deliverReply(conversation, resText);
      }
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string,
  opts?: { replyMarkup?: unknown; parseMode?: "HTML" | "MarkdownV2" }
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  await sendText({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    text,
    aiGenerated: true,
    replyMarkup: opts?.replyMarkup,
    parseMode: opts?.parseMode,
  });
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set({ stageId, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(schema.lead.contactId, contactId));
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
