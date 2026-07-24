import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sendMessage, TelegramApiError } from "@/lib/telegram/client";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { getTelegramCredentialsByOrg } from "@/server/telegram/credentials";
import {
  activateDeliveredTelegramMenu,
  isInlineKeyboard,
  markTelegramMenuFailed,
  reserveTelegramMenu,
} from "@/server/telegram/menu-store";
import { deliverOutboxEntry, enqueueTelegramOutbox } from "@/server/telegram/outbox";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
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
 * Envía un mensaje de texto por Telegram para la conversación indicada.
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
  channel?: "telegram";
  row?: {
    conversation: typeof schema.conversation.$inferSelect;
    contact?: typeof schema.contact.$inferSelect;
  };
  telegramCredentials?: { id?: string; token: string; status: string } | null;
}): Promise<SendResult> {
  return sendTelegramText({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    text: input.text,
    aiGenerated: input.aiGenerated,
    replyMarkup: input.replyMarkup,
    parseMode: input.parseMode,
    row: input.row,
    telegramCredentials: input.telegramCredentials,
  });
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
  telegramCredentials?: { id?: string; token: string; status: string } | null;
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

  const menu = isInlineKeyboard(input.replyMarkup)
    ? await reserveTelegramMenu({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        chatId: row.contact.externalAddress,
        markup: input.replyMarkup,
      })
    : null;
  const durableMode = (process.env.TELEGRAM_DURABLE_MODE ?? "enforce") as "off" | "shadow" | "enforce";
  let res: { message_id: number };
  let deliveredByOutbox = false;
  try {
    if (durableMode === "enforce" && process.env.NODE_ENV !== "test") {
      const integrationId = telegramCredentials.id ?? (await db.select({ id: schema.telegramIntegration.id })
        .from(schema.telegramIntegration)
        .where(eq(schema.telegramIntegration.organizationId, input.organizationId)).limit(1))[0]?.id;
      if (!integrationId) throw new SendError("not_connected", "Integración Telegram no encontrada");
      const entry = await db.transaction(async (tx) => {
        await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
          where ${schema.conversation.organizationId}=${input.organizationId}
            and ${schema.conversation.id}=${input.conversationId} for update`);
        const sequenceRows = await tx.select({ value: sql<number>`coalesce(max(${schema.telegramOutbox.sequence}),0)+1` })
          .from(schema.telegramOutbox).where(eq(schema.telegramOutbox.conversationId, input.conversationId));
        return enqueueTelegramOutbox(tx, {
          organizationId: input.organizationId,
          integrationId,
          conversationId: input.conversationId,
          idempotencyKey: `reply:${input.conversationId}:${conversation.fsmRevision}:${sequenceRows[0]?.value ?? 1}`,
          kind: menu ? "menu" : "message",
          sequence: Number(sequenceRows[0]?.value ?? 1),
          text: input.text,
          payload: { chatId: row.contact.externalAddress, menuInstanceId: menu?.instanceId },
          replyMarkup: (menu?.replyMarkup ?? input.replyMarkup) as Record<string, unknown> | undefined,
          fsmRevision: conversation.fsmRevision,
        });
      });
      if (!entry) throw new SendError("telegram_error", "No se pudo crear el outbox Telegram");
      await db.update(schema.telegramOutbox).set({ status: "sending", attempts: 1, leaseExpiresAt: new Date(Date.now() + 30_000) })
        .where(eq(schema.telegramOutbox.id, entry.id));
      const delivered = await deliverOutboxEntry({ ...entry, status: "sending", attempts: 1 });
      if (!delivered) throw new SendError("telegram_unavailable", "Telegram no confirmó la entrega; el outbox continuará la recuperación");
      const sentRows = await db.select({ messageId: schema.telegramOutbox.telegramMessageId }).from(schema.telegramOutbox)
        .where(eq(schema.telegramOutbox.id, entry.id)).limit(1);
      if (!sentRows[0]?.messageId) throw new SendError("telegram_error", "Telegram no devolvió ID de mensaje");
      res = { message_id: sentRows[0].messageId };
      deliveredByOutbox = true;
    } else {
      res = await sendMessage({
        chatId: row.contact.externalAddress,
        text: input.text,
        parseMode: input.parseMode,
        replyMarkup: menu?.replyMarkup ?? input.replyMarkup,
        token: telegramCredentials.token,
      });
    }
  } catch (err) {
    if (menu) await markTelegramMenuFailed(input.organizationId, menu.instanceId);
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

  if (menu && !deliveredByOutbox) {
    await activateDeliveredTelegramMenu({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      instanceId: menu.instanceId,
      telegramMessageId: res.message_id,
    });
  }

  const tgMessageId = `message:${row.contact.externalAddress}:${res.message_id}`;

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      channel: "telegram",
      integrationId: telegramCredentials.id,
      externalMessageId: tgMessageId,
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
  channel?: "telegram";
}): Promise<SendResult> {
  const replyMarkup = input.replyMarkup ?? input.menu;
  return sendTelegramText({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    text: input.text,
    aiGenerated: input.aiGenerated,
    replyMarkup,
  });
}
