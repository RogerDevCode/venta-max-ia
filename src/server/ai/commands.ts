import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { applyHandoff } from "@/server/ai/pipeline";

export type SlashCommandType = "start" | "menu" | "reset" | "humano";

/** Parsea un texto entrante para detectar comandos slash válidos (/start, /menu, /reset, /humano). */
export function parseSlashCommand(text?: string | null): SlashCommandType | null {
  if (!text) return null;
  const clean = text.trim();
  if (!clean.startsWith("/")) return null;

  // Extrae el comando ignorando sufijos de usuario de bot (ej. /start@bot_name -> start)
  const match = clean.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+.*)?$/);
  if (!match || !match[1]) return null;

  const cmd = match[1].toLowerCase();
  if (cmd === "start" || cmd === "menu" || cmd === "reset" || cmd === "humano") {
    return cmd as SlashCommandType;
  }
  return null;
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Procesador central de comandos slash para el bot de VentaMaxIA. */
export async function processSlashCommand(input: {
  command: SlashCommandType;
  conversation: Conversation;
  lastInboundWaId?: string | null;
}): Promise<{ handled: boolean }> {
  const { command, conversation, lastInboundWaId } = input;
  const db = getDb();

  switch (command) {
    case "start":
    case "reset": {
      // Reinicia stateMetadata y limpia cualquier handoff previo
      await db
        .update(schema.conversation)
        .set({
          stateMetadata: {},
          handoffAt: null,
          handoffReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversation.id, conversation.id));

      publish(conversation.organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversation.id } },
      });

      const welcomeText =
        `¡Hola! Soy tu asistente de VentaMaxIA. 🤖\n\n` +
        `He reiniciado el estado de la conversación. ¿En qué te puedo ayudar hoy?\n\n` +
        `Puedes escribir tu consulta directamente o usar /menu para ver opciones.`;

      await deliverCommandReply(conversation, welcomeText);
      return { handled: true };
    }

    case "menu": {
      const isTelegram = lastInboundWaId?.startsWith("tg_") ?? false;
      const menuTitle = "📌 *Menú Principal — VentaMaxIA*:\nSelecciona una opción:";
      const buttons = [
        { text: "📦 Ver Productos", payload: "CATALOGO" },
        { text: "🛒 Ver Carrito / Pedido", payload: "CARRITO" },
        { text: "👤 Hablar con Humano", payload: "HUMANO" },
      ];

      if (isTelegram) {
        const replyMarkup = {
          inline_keyboard: buttons.map((b) => [
            { text: b.text, callback_data: b.payload },
          ]),
        };
        await deliverCommandReply(conversation, menuTitle, { replyMarkup });
      } else {
        const textMenu =
          `${menuTitle}\n\n` +
          buttons.map((b, i) => `${i + 1}. ${b.text}`).join("\n");
        await deliverCommandReply(conversation, textMenu);
      }
      return { handled: true };
    }

    case "humano": {
      const farewellText =
        `Un agente humano revisará tu solicitud a la brevedad. Gracias por comunicarte con nosotros. 👋`;

      await deliverCommandReply(conversation, farewellText);
      await applyHandoff(conversation.id, conversation.organizationId, "cliente");
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
    // Sandbox: registrar sin enviar a la API externa
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
