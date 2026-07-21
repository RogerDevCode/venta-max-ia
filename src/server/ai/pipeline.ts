import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { sendChatAction } from "@/lib/telegram/client";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { buildRagContext } from "@/server/ai/rag/rag-builder";
import {
  buscarProductos,
  agregarAlCarrito,
  confirmarPedido,
} from "@/server/ecommerce/service";
import { parseSlashCommand, processSlashCommand } from "@/server/ai/commands";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
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
export function scheduleAgentTurn(conversationId: string, immediate = false): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = immediate ? 0 : getEnv().AGENT_COALESCE_MS;
  if (delay === 0) {
    entry.timer = null;
    void executeTurn(conversationId);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
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
  const db = getDb();

  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) return;

  const { organizationId } = conversation;

  if (!conversation.aiEnabled || conversation.handoffAt) {
    return;
  }

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) return;
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);

  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");

  if (!lastInbound) return;

  // Intercepción directa de Comandos Slash (/start, /menu, /reset, /humano)
  if (lastInbound.text) {
    const slashCmd = parseSlashCommand(lastInbound.text);
    if (slashCmd) {
      const cmdResult = await processSlashCommand({
        command: slashCmd,
        conversation,
        lastInboundWaId: lastInbound.waMessageId,
      });
      if (cmdResult.handled) return;
    }
  }

  if (!isAiConfigured()) return;

  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }
  
  if (lastInbound.waMessageId?.startsWith("tg_")) {
    const parts = lastInbound.waMessageId.split("_");
    const chatId = parts[1];
    if (chatId && chatId !== "cb") {
      void sendChatAction({ chatId, action: "typing" }).catch(() => {});
    }
  }

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  // Inyección de RAG y Búsqueda Vectorial Coseno (Paso 3.3)
  const ragResult = await buildRagContext({
    organizationId,
    query: lastInbound.text,
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
    await applyHandoff(conversationId, organizationId, "error");
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
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
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
      const isTelegram = lastInbound?.waMessageId?.startsWith("tg_") ?? false;
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
      const productList =
        productos.length > 0
          ? `📦 Productos encontrados:\n` +
            productos
              .map(
                (p) =>
                  `• ${p.name} (${p.sku}): $${(p.price / 100).toFixed(2)} (Stock: ${p.stock})`
              )
              .join("\n")
          : `No encontré productos con "${action.query}".`;

      const resText = action.reply
        ? `${action.reply}\n\n${productList}`
        : productList;

      await deliverReply(conversation, resText);
      return;
    }
    case "agregar_al_carrito": {
      const res = await agregarAlCarrito({
        organizationId,
        conversationId,
        sku: action.sku,
        cantidad: action.cantidad,
      });
      const resText =
        action.reply ||
        (res.ok
          ? `Agregado al carrito: ${res.product.name} (Cantidad: ${action.cantidad})`
          : `No pude agregar el producto (${res.error}).`);
      await deliverReply(conversation, resText);
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
        const resText =
          action.reply ||
          `¡Pedido confirmado exitosamente! Número de pedido: ${res.order.orderNumber}.`;
        await deliverReply(conversation, resText);
      } else {
        const resText =
          action.reply ||
          `No pude confirmar el pedido porque su carrito está vacío.`;
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
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
      replyMarkup: opts?.replyMarkup,
      parseMode: opts?.parseMode,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
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
