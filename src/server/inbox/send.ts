import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { sendMessage, TelegramApiError } from "@/lib/telegram/client";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";
import { getTelegramCredentialsByOrg } from "@/server/telegram/credentials";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "telegram_error"
    | "telegram_unavailable";

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}

type SendResult = { messageId: string };

/**
 * Envía un mensaje de texto libre por WhatsApp o Telegram automáticamente según el canal de la conversación.
 *
 * ASERCIÓN DURA (FR-031): una conversación de prueba del Laboratorio jamás
 * llega a la API real — se lanza ANTES de tocar credenciales o red.
 */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
  replyMarkup?: unknown;
  parseMode?: "HTML" | "MarkdownV2";
  channel?: "wa" | "telegram";
  row?: {
    conversation: typeof schema.conversation.$inferSelect;
    contact?: typeof schema.contact.$inferSelect;
  };
  telegramCredentials?: { token: string; status: string } | null;
}): Promise<SendResult> {
  const db = getDb();

  let conversation = input.row?.conversation;
  let contact = input.row?.contact;
  if (!conversation || !contact) {
    if (conversation && !contact) {
      const contactRows = await db
        .select()
        .from(schema.contact)
        .where(eq(schema.contact.id, conversation.contactId))
        .limit(1);
      contact = contactRows[0];
    } else {
      const rows = await db
        .select({
          conversation: schema.conversation,
          contact: schema.contact,
        })
        .from(schema.conversation)
        .innerJoin(
          schema.contact,
          eq(schema.conversation.contactId, schema.contact.id)
        )
        .where(eq(schema.conversation.id, input.conversationId))
        .limit(1);
      conversation = rows[0]?.conversation;
      contact = rows[0]?.contact;
    }
  }

  if (!conversation || conversation.organizationId !== input.organizationId || !contact) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }
  const row = { conversation, contact };

  if (conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  if (input.channel === "telegram") {
    return sendTelegramText({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      text: input.text,
      aiGenerated: input.aiGenerated,
      replyMarkup: input.replyMarkup,
      parseMode: input.parseMode,
      row,
      telegramCredentials: input.telegramCredentials,
    });
  }

  const telegramCredentials =
    input.telegramCredentials !== undefined
      ? input.telegramCredentials
      : await getTelegramCredentialsByOrg(input.organizationId);
  if (!telegramCredentials || telegramCredentials.status !== "connected") {
    throw new SendError("not_connected", "Telegram no está conectado para esta organización");
  }

  let isTelegram = false;
  if (input.channel === "wa") {
    isTelegram = false;
  } else {
    // Enrutamiento automático al canal Telegram si el último mensaje entrante fue de Telegram o si el contacto es Telegram ID
    const lastMsgRows = await db
      .select({ waMessageId: schema.message.waMessageId })
      .from(schema.message)
      .where(eq(schema.message.conversationId, input.conversationId))
      .orderBy(desc(schema.message.createdAt))
      .limit(1);
    isTelegram = lastMsgRows[0]?.waMessageId?.startsWith("tg_") ?? false;
  }

  if (isTelegram) {
    return sendTelegramText({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      text: input.text,
      aiGenerated: input.aiGenerated,
      replyMarkup: input.replyMarkup,
      parseMode: input.parseMode,
      row,
      telegramCredentials,
    });
  }

  if (!isWindowOpen(row.conversation.lastInboundAt)) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }

  const credentials = await getCredentialsByOrg(input.organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  const waMessageId = await callGraphSend(credentials, {
    messaging_product: "whatsapp",
    to: normalizeRecipient(row.contact.phone),
    type: "text",
    text: { body: input.text },
  });

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "text",
      text: input.text,
      status: "pending",
      aiGenerated: input.aiGenerated ?? false,
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/**
 * Envía un mensaje de texto por Telegram soportando menús interactivos (`replyMarkup` / `inline_keyboard`).
 * Respeta rigurosamente el guardarraíl de sandbox (isTest).
 */
export async function sendTelegramText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
  replyMarkup?: unknown;
  parseMode?: "HTML" | "MarkdownV2";
  row?: {
    conversation: typeof schema.conversation.$inferSelect;
    contact?: typeof schema.contact.$inferSelect;
  };
  telegramCredentials?: { token: string; status: string } | null;
}): Promise<SendResult> {
  const db = getDb();

  let conversation = input.row?.conversation;
  let contact = input.row?.contact;
  if (!conversation || !contact) {
    if (conversation && !contact) {
      const contactRows = await db
        .select()
        .from(schema.contact)
        .where(eq(schema.contact.id, conversation.contactId))
        .limit(1);
      contact = contactRows[0];
    } else {
      const rows = await db
        .select({
          conversation: schema.conversation,
          contact: schema.contact,
        })
        .from(schema.conversation)
        .innerJoin(
          schema.contact,
          eq(schema.conversation.contactId, schema.contact.id)
        )
        .where(eq(schema.conversation.id, input.conversationId))
        .limit(1);
      conversation = rows[0]?.conversation;
      contact = rows[0]?.contact;
    }
  }

  if (!conversation || conversation.organizationId !== input.organizationId || !contact) {
    throw new SendError("telegram_error", "Conversación no encontrada");
  }
  const row = { conversation, contact };

  if (conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  const telegramCredentials =
    input.telegramCredentials !== undefined
      ? input.telegramCredentials
      : await getTelegramCredentialsByOrg(input.organizationId);
  if (!telegramCredentials || telegramCredentials.status !== "connected") {
    throw new SendError("not_connected", "Telegram no está conectado para esta organización");
  }

  let res: { message_id: number };
  try {
    res = await sendMessage({
      chatId: row.contact.phone,
      text: input.text,
      parseMode: input.parseMode,
      replyMarkup: input.replyMarkup,
      token: telegramCredentials.token,
    });
  } catch (err) {
    if (err instanceof TelegramApiError) {
      if (err.isAuthError) {
        throw new SendError(
          "reconnect_required",
          "El token de Telegram es inválido o expiró"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("telegram_unavailable", "Telegram no está disponible ahora");
      }
      throw new SendError("telegram_error", err.description || err.message);
    }
    throw err;
  }

  const tgMessageId = `tg_${row.contact.phone}_${res.message_id}`;

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: tgMessageId,
      direction: "out",
      type: "text",
      text: input.text,
      status: "delivered",
      aiGenerated: input.aiGenerated ?? false,
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}

/**
 * Función general de envío saliente (Paso 2.1) que soporta menús de Telegram
 * y delega al canal correspondiente.
 */
export async function sendOutbound(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
  replyMarkup?: unknown;
  menu?: { inline_keyboard: unknown[] };
  channel?: "wa" | "telegram";
}): Promise<SendResult> {
  const replyMarkup = input.replyMarkup ?? input.menu;
  if (input.channel === "telegram" || replyMarkup !== undefined) {
    return sendTelegramText({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      text: input.text,
      aiGenerated: input.aiGenerated,
      replyMarkup,
    });
  }
  return sendText({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    text: input.text,
    aiGenerated: input.aiGenerated,
  });
}
