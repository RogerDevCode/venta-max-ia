import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { applyHandoff } from "@/server/ai/pipeline";
import { buscarProductos, listarCategorias, listCatalogProducts } from "@/server/ecommerce/service";
import { preloadCatalogCache } from "@/server/ecommerce/cache";

export type SlashCommandType =
  | "start"
  | "menu"
  | "reset"
  | "humano"
  | "menu:categorias"
  | "menu:promociones"
  | "menu:mas_vendidos"
  | "menu:carrito"
  | "menu:pedidos"
  | "menu:humano"
  | "catalog:return"
  | "catalog:home"
  | `catalog:category:${string}`
  | `catalog:number:${string}`;

/** Parsea un texto entrante o payload de botón callback para detectar comandos y menús. */
export function parseSlashCommand(text?: string | null): SlashCommandType | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. Manejo de Callback Payload exacto del menú
  if (clean.startsWith("menu:") || clean.startsWith("catalog:category:")) {
    return clean as SlashCommandType;
  }
  if (clean === "r" || clean === "R" || clean === "catalog:return") return "catalog:return";
  if (clean === "i" || clean === "I" || clean === "catalog:home") return "catalog:home";

  // 2. Manejo de Comandos Slash clásicos (/start, /menu, /reset, /humano)
  if (clean.startsWith("/")) {
    const match = clean.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+.*)?$/);
    if (!match || !match[1]) return null;
    const cmd = match[1].toLowerCase();
    if (cmd === "start" || cmd === "menu" || cmd === "reset" || cmd === "humano") {
      return cmd as SlashCommandType;
    }
  }

  // 3. Manejo de selección numérica por texto (1..6)
  if (/^[1-9]$/.test(clean)) return `catalog:number:${clean}`;
  return null;
}

type Conversation = typeof schema.conversation.$inferSelect;

/**
 * Constante del Menú Principal Transaccional (migrado desde chatbot)
 * Optimizado para 2 columnas en Telegram Inline Keyboard y lista ordenada en WhatsApp.
 */
export function buildMainMenuMarkup(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: "1. 🛍️ Ver Catálogo", callback_data: "menu:categorias" },
        { text: "2. ⚡ Promos del Día", callback_data: "menu:promociones" },
      ],
      [
        { text: "3. ⭐ Recomendados", callback_data: "menu:mas_vendidos" },
        { text: "4. 🛒 Mi Carrito (Pagar)", callback_data: "menu:carrito" },
      ],
      [
        { text: "5. 📋 Mis Pedidos", callback_data: "menu:pedidos" },
        { text: "6. 👤 Hablar con Humano", callback_data: "menu:humano" },
      ],
    ],
  };
}

/** Procesador central de comandos slash y menús interactivos de VentaMaxIA. */
export async function processSlashCommand(input: {
  command: SlashCommandType;
  conversation: Conversation;
  lastInboundWaId?: string | null;
  profile?: typeof schema.agentProfile.$inferSelect | null;
}): Promise<{ handled: boolean }> {
  const { command, conversation, lastInboundWaId } = input;
  const { organizationId, id: conversationId } = conversation;
  const db = getDb();
  const channel = lastInboundWaId?.startsWith("tg_") ? "telegram" : "wa";

  // Precarga asíncrona no bloqueante del catálogo y stock en paralelo mientras se muestra el menú/comando
  void preloadCatalogCache(organizationId).catch(() => {});

  const currentState = (conversation.stateMetadata as Record<string, unknown>) ?? {};

  async function updateState(newState: Record<string, unknown>) {
    await db
      .update(schema.conversation)
      .set({
        stateMetadata: { ...currentState, ...newState },
        updatedAt: new Date(),
      })
      .where(
        and(
          scoped(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.id, conversationId)
        )
      );

    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversationId } },
    });
  }

  async function showCategories() {
    const categorias = await listarCategorias(organizationId);
    await updateState({ current_state: "menu:catalog", active_step: "viewing_catalog", catalogCategoryIds: categorias.map((c) => c.id), catalogCategoryId: null });
    const text = `📁 *Categorías de Productos*:\n${categorias.map((c, index) => `${index + 1}. *${c.name}*${c.description ? `: ${c.description}` : ""}`).join("\n")}\n\nElige una categoría con su botón o número.`;
    const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
    await deliverCommandReply(conversation, text, { replyMarkup: isTelegram ? { inline_keyboard: categorias.map((c, index) => [{ text: `${index + 1}. ${c.name}`, callback_data: `catalog:category:${c.id}` }]) } : undefined, channel });
  }

  if (command === "catalog:return") { await showCategories(); return { handled: true }; }
  if (command === "catalog:home") {
    await updateState({ current_state: "menu:main", active_step: "main_menu", catalogCategoryIds: null, catalogCategoryId: null });
    const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
    await deliverCommandReply(conversation, "📌 *Menú Principal — VentaMaxIA*\nSelecciona una opción:", { replyMarkup: isTelegram ? buildMainMenuMarkup() : undefined, channel });
    return { handled: true };
  }
  let categoryId: string | null = null;
  if (command.startsWith("catalog:category:")) categoryId = command.slice("catalog:category:".length);
  if (command.startsWith("catalog:number:")) {
    const number = Number(command.slice("catalog:number:".length));
    const ids = Array.isArray(currentState.catalogCategoryIds) ? currentState.catalogCategoryIds.filter((id): id is string => typeof id === "string") : [];
    if (currentState.current_state === "menu:catalog" && number > 0 && number <= ids.length) categoryId = ids[number - 1] ?? null;
    else {
      const main = ["menu:categorias", "menu:promociones", "menu:mas_vendidos", "menu:carrito", "menu:pedidos", "menu:humano"][number - 1];
      if (main) return processSlashCommand({ ...input, command: main as SlashCommandType });
    }
  }
  if (categoryId) {
    try {
      const products = await listCatalogProducts(organizationId, categoryId);
      await updateState({ current_state: "menu:catalog", active_step: "viewing_category", catalogCategoryId: categoryId });
      const text = products.length ? `🛍️ *Productos*:\n${products.map((p) => `• ${p.name} (${p.sku}): $${p.price.toLocaleString("es-CL")} CLP (Stock: ${p.stock})`).join("\n")}\n\nR. Retornar · I. Inicio` : "Esta categoría no tiene productos activos.\n\nR. Retornar · I. Inicio";
      const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
      await deliverCommandReply(conversation, text, { replyMarkup: isTelegram ? { inline_keyboard: [[{ text: "↩ Retornar", callback_data: "catalog:return" }, { text: "⌂ Inicio", callback_data: "catalog:home" }]] } : undefined, channel });
    } catch { await showCategories(); }
    return { handled: true };
  }

  switch (command) {
    case "start":
    case "reset": {
      await db
        .update(schema.conversation)
        .set({
          stateMetadata: { current_state: "menu:main", active_step: "main_menu" },
          handoffAt: null,
          handoffReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            scoped(schema.conversation.organizationId, organizationId),
            eq(schema.conversation.id, conversationId)
          )
        );

      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });

      const profile = input.profile !== undefined
        ? input.profile
        : (await db
            .select()
            .from(schema.agentProfile)
            .where(scoped(schema.agentProfile.organizationId, organizationId))
            .limit(1))[0];

      const welcomeText = profile?.greeting?.trim()
        ? profile.greeting.trim()
        : `¡Hola! Soy ${profile?.name || "tu asistente"} de VentaMaxIA. 🤖\n\n` +
          `He reiniciado la conversación. ¿En qué te puedo ayudar hoy?\n\n` +
          `Puedes escribirme lo que buscas o elegir una opción del menú.`;

      const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
      if (isTelegram) {
        await deliverCommandReply(conversation, welcomeText, { replyMarkup: buildMainMenuMarkup(), channel });
      } else {
        await deliverCommandReply(conversation, welcomeText, { channel });
      }
      return { handled: true };
    }

    case "menu": {
      await updateState({ current_state: "menu:main", active_step: "main_menu" });
      const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
      const menuTitle = "📌 *Menú Principal — VentaMaxIA*\nSelecciona una opción:";

      if (isTelegram) {
        await deliverCommandReply(conversation, menuTitle, { replyMarkup: buildMainMenuMarkup() });
      } else {
        const textMenu =
          `${menuTitle}\n\n` +
          `1. 🛍️ Ver Catálogo\n` +
          `2. ⚡ Promos del Día\n` +
          `3. ⭐ Recomendados\n` +
          `4. 🛒 Mi Carrito (Pagar)\n` +
          `5. 📋 Mis Pedidos\n` +
          `6. 👤 Hablar con Humano`;
        await deliverCommandReply(conversation, textMenu);
      }
      return { handled: true };
    }

    case "menu:categorias": {
      await showCategories();
      return { handled: true };
    }

    case "menu:promociones": {
      await updateState({ current_state: "menu:promos", active_step: "viewing_promos" });
      const productos = await buscarProductos({ organizationId, query: "promo" });
      const text = productos.length > 0
        ? `⚡ *Promociones del Día*:\n` + productos.map((p) => `• ${p.name} (${p.sku}): $${p.price.toLocaleString("es-CL")} CLP`).join("\n")
        : `Por el momento no hay promociones activas registradas.`;
      await deliverCommandReply(conversation, text);
      return { handled: true };
    }

    case "menu:mas_vendidos": {
      await updateState({ current_state: "menu:recommended", active_step: "viewing_recommended" });
      const productos = await buscarProductos({ organizationId, query: "*" });
      const text = productos.length > 0
        ? `⭐ *Productos Mas Vendidos / Recomendados*:\n` + productos.map((p) => `• ${p.name} (${p.sku}): $${p.price.toLocaleString("es-CL")} CLP`).join("\n")
        : `No hay productos recomendados configurados.`;
      await deliverCommandReply(conversation, text);
      return { handled: true };
    }

    case "menu:carrito": {
      await updateState({ current_state: "menu:cart", active_step: "viewing_cart" });
      const cartRows = await db
        .select()
        .from(schema.cart)
        .where(
          scoped(
            schema.cart.organizationId,
            organizationId,
            and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
          )
        )
        .limit(1);

      const cart = cartRows[0];
      const items = (cart?.items as Array<{ name: string; quantity: number; unitPrice: number }>) ?? [];
      if (items.length === 0) {
        await deliverCommandReply(conversation, "🛒 Tu carrito de compras está vacío actualmente.");
      } else {
        const total = items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
        const text =
          `🛒 *Tu Carrito Actual*:\n` +
          items.map((i) => `• ${i.name} x${i.quantity}: $${(i.quantity * i.unitPrice).toLocaleString("es-CL")} CLP`).join("\n") +
          `\n\n*Total:* $${total.toLocaleString("es-CL")} CLP\n\nPara confirmar tu compra responde con la palabra "confirmar".`;
        await deliverCommandReply(conversation, text);
      }
      return { handled: true };
    }

    case "menu:pedidos": {
      await updateState({ current_state: "menu:orders", active_step: "viewing_orders" });
      const orderRows = await db
        .select()
        .from(schema.order)
        .where(
          scoped(
            schema.order.organizationId,
            organizationId,
            eq(schema.order.conversationId, conversationId)
          )
        )
        .orderBy(desc(schema.order.createdAt))
        .limit(3);

      if (orderRows.length === 0) {
        await deliverCommandReply(conversation, "📋 No tienes pedidos registrados aún.");
      } else {
        const text =
          `📋 *Tus Últimos Pedidos*:\n` +
          orderRows
            .map((o) => `• N° ${o.orderNumber}: $${o.totalAmount.toLocaleString("es-CL")} CLP (Estado: ${o.status})`)
            .join("\n");
        await deliverCommandReply(conversation, text);
      }
      return { handled: true };
    }

    case "humano":
    case "menu:humano": {
      await updateState({ current_state: "handoff:humano", active_step: "awaiting_human" });
      const profileRows = await db
        .select()
        .from(schema.agentProfile)
        .where(scoped(schema.agentProfile.organizationId, organizationId))
        .limit(1);
      const profile = profileRows[0];
      const humanAvailable = profile?.humanAvailable ?? true;

      if (humanAvailable) {
        const responseText = `Un agente humano revisará tu solicitud a la brevedad. Gracias por comunicarte con nosotros. 👋`;
        await deliverCommandReply(conversation, responseText);
        await applyHandoff(conversationId, organizationId, "cliente");
      } else {
        const responseText = `En este momento no contamos con un agente humano disponible en línea. Hemos tomado nota de tu solicitud para nuestro equipo, pero mientras tanto ¡puedes seguir consultándome cualquier duda o catálogo! 🙏`;
        await deliverCommandReply(conversation, responseText);
      }
      return { handled: true };
    }
  }
  return { handled: false };
}

async function deliverCommandReply(
  conversation: Conversation,
  text: string,
  opts?: { replyMarkup?: unknown; channel?: "wa" | "telegram" }
): Promise<void> {
  if (conversation.isTest) {
    const db = getDb();
    await db.insert(schema.message).values({
      id: `msg_${Date.now()}`,
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      direction: "out",
      type: "text",
      text,
      status: "sent",
      aiGenerated: true,
    });
    return;
  }

  await sendText({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    text,
    aiGenerated: true,
    replyMarkup: opts?.replyMarkup,
    channel: opts?.channel,
    row: { conversation },
  });
}
