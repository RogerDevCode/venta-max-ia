import { safeEqual } from "@/server/security/safe-equal";
import { ingestTelegramMessage } from "@/server/inbox/ingest";
import { answerCallbackQuery, sendChatAction } from "@/lib/telegram/client";
import { getTelegramCredentialsByOrg } from "@/server/telegram/credentials";
import { acceptTelegramMenuCallback } from "@/server/telegram/menu-guard";
import { runTelegramMenuAction } from "@/server/telegram/menu-action-runner";

/**
 * Autenticación e ingesta de actualizaciones de la Telegram Bot API.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

/**
 * Verifica si el token en la ruta del webhook coincide con el secreto configurado en el servidor.
 */
export function isValidTelegramWebhookToken(
  tokenSegment: string,
  configuredSecret: string | undefined
): boolean {
  if (!configuredSecret || configuredSecret.length === 0) return false;
  return safeEqual(tokenSegment, configuredSecret);
}

/**
 * Procesa un Update crudo de Telegram e ingesta el mensaje entrante o selección de menú (callback_query)
 * scoped por organización con idempotencia por tg_${chatId}_${messageId} o tg_cb_${queryId}.
 */
export async function processTelegramUpdate(input: {
  organizationId: string;
  integrationId: string;
  update: TelegramUpdate;
}): Promise<void> {
  const { organizationId, integrationId, update } = input;

  // 1. Intercepción de clics en menús (callback_query) - Paso 2.2
  if (update.callback_query) {
    const cb = update.callback_query;
    if (!cb.message || cb.message.chat.type !== "private" || String(cb.message.chat.id) !== String(cb.from.id)) {
      return;
    }
    const chatId = String(cb.message?.chat.id ?? cb.from.id);
    const queryId = cb.id;
    const profileName = [cb.from.first_name, cb.from.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || `Telegram ${chatId}`;

    const credentials = await getTelegramCredentialsByOrg(organizationId);
    const ack = answerCallbackQuery({ callbackQueryId: queryId, token: credentials?.token }).catch((error) =>
      console.error("[telegram] callback ACK falló:", error)
    );
    if (!cb.data || !cb.message) {
      await ack;
      return;
    }
    const decisionPromise = acceptTelegramMenuCallback({
      organizationId,
      updateId: update.update_id,
      callbackQueryId: queryId,
      callbackData: cb.data,
      chatId,
      fromId: String(cb.from.id),
      messageId: cb.message.message_id,
      chatType: cb.message.chat.type,
    });
    const [decision] = await Promise.all([decisionPromise, ack]);
    if (!decision.accepted) return;
    await runTelegramMenuAction({
      organizationId,
      actionId: decision.actionId,
      profileName,
      timestamp: String(cb.message.date),
    });
    return;
  }

  // 2. Intercepción de mensajes regulares
  const message = update.message;
  if (!message) {
    return;
  }
  if (message.chat.type !== "private" || !message.from || String(message.chat.id) !== String(message.from.id)) {
    return;
  }

  const chatId = String(message.chat.id);
  const messageId = String(message.message_id);
  const profileName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || [message.chat.first_name, message.chat.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  const channelMessageId = `message:${chatId}:${messageId}`;

  // Disparar señal de escritura en T=0ms sin bloquear
  const credentials = await getTelegramCredentialsByOrg(organizationId);
  if (credentials?.status === "connected") {
    void sendChatAction({ chatId, action: "typing", token: credentials.token }).catch((error) =>
      console.error("[telegram] typing falló:", error)
    );
  }

  await ingestTelegramMessage({
    organizationId,
    integrationId,
    from: chatId,
    profileName: profileName || `Telegram ${chatId}`,
    externalMessageId: channelMessageId,
    type: message.text !== undefined ? "text" : "unknown",
    text: message.text ?? null,
    timestamp: String(message.date ?? Math.floor(Date.now() / 1000)),
  });
}
