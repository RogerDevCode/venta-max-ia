import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { applyHandoff } from "@/server/ai/pipeline";
import { buscarProductos } from "@/server/ecommerce/service";

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
  | "menu:humano";

/** Parsea un texto entrante o payload de botón callback para detectar comandos y menús. */
export function parseSlashCommand(text?: string | null): SlashCommandType | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. Manejo de Callback Payload exacto del menú
  if (clean.startsWith("menu:")) {
    return clean as SlashCommandType;
  }

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
  if (clean === "1") return "menu:categorias";
  if (clean === "2") return "menu:promociones";
  if (clean === "3") return "menu:mas_vendidos";
  if (clean === "4") return "menu:carrito";
  if (clean === "5") return "menu:pedidos";
  if (clean === "6") return "menu:humano";

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
}): Promise<{ handled: boolean }> {
  const { command, conversation, lastInboundWaId } = input;
  const { organizationId, id: conversationId } = conversation;
  const db = getDb();

  switch (command) {
    case "start":
    case "reset": {
      await db
        .update(schema.conversation)
        .set({
          stateMetadata: {},
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

      const profileRows = await db
        .select()
        .from(schema.agentProfile)
        .where(scoped(schema.agentProfile.organizationId, organizationId))
        .limit(1);
      const profile = profileRows[0];

      const welcomeText = profile?.greeting?.trim()
        ? profile.greeting.trim()
        : `¡Hola! Soy ${profile?.name || "tu asistente"} de VentaMaxIA. 🤖\n\n` +
          `He reiniciado la conversación. ¿En qué te puedo ayudar hoy?\n\n` +
          `Puedes escribirme lo que buscas o elegir una opción del menú.`;

      const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
      if (isTelegram) {
        await deliverCommandReply(conversation, welcomeText, { replyMarkup: buildMainMenuMarkup() });
      } else {
        await deliverCommandReply(conversation, welcomeText);
      }
      return { handled: true };
    }

    case "menu": {
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
      const productos = await buscarProductos({ organizationId, query: "todo" });
      const text = productos.length > 0
        ? `🛍️ *Catálogo de Productos*:\n` + productos.map((p) => `• ${p.name} (${p.sku}): $${(p.price / 100).toFixed(2)} (Stock: ${p.stock})`).join("\n")
        : `No hay productos activos en el catálogo de este negocio actualmente.`;
      await deliverCommandReply(conversation, text);
      return { handled: true };
    }

    case "menu:promociones": {
      const productos = await buscarProductos({ organizationId, query: "promo" });
      const text = productos.length > 0
        ? `⚡ *Promociones del Día*:\n` + productos.map((p) => `• ${p.name} (${p.sku}): $${(p.price / 100).toFixed(2)}`).join("\n")
        : `Por el momento no hay promociones activas registradas.`;
      await deliverCommandReply(conversation, text);
      return { handled: true };
    }

    case "menu:mas_vendidos": {
      const productos = await buscarProductos({ organizationId, query: "*" });
      const text = productos.length > 0
        ? `⭐ *Productos Mas Vendidos / Recomendados*:\n` + productos.map((p) => `• ${p.name} (${p.sku}): $${(p.price / 100).toFixed(2)}`).join("\n")
        : `No hay productos recomendados configurados.`;
      await deliverCommandReply(conversation, text);
      return { handled: true };
    }

    case "menu:carrito": {
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
          items.map((i) => `• ${i.name} x${i.quantity}: $${((i.quantity * i.unitPrice) / 100).toFixed(2)}`).join("\n") +
          `\n\n*Total:* $${(total / 100).toFixed(2)}\n\nPara confirmar tu compra responde con la palabra "confirmar".`;
        await deliverCommandReply(conversation, text);
      }
      return { handled: true };
    }

    case "menu:pedidos": {
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
            .map((o) => `• N° ${o.orderNumber}: $${(o.totalAmount / 100).toFixed(2)} (Estado: ${o.status})`)
            .join("\n");
        await deliverCommandReply(conversation, text);
      }
      return { handled: true };
    }

    case "humano":
    case "menu:humano": {
      const farewellText =
        `Un agente humano revisará tu solicitud a la brevedad. Gracias por comunicarte con nosotros. 👋`;

      await deliverCommandReply(conversation, farewellText);
      await applyHandoff(conversationId, organizationId, "cliente");
      return { handled: true };
    }
  }
}

async function deliverCommandReply(
  conversation: Conversation,
  text: string,
  opts?: { replyMarkup?: unknown }
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
  });
}
