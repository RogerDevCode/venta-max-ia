import { safeEqual } from "@/server/inbox/webhook";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { answerCallbackQuery, sendChatAction } from "@/lib/telegram/client";

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
  update: TelegramUpdate;
}): Promise<void> {
  const { organizationId, update } = input;

  // 1. Intercepción de clics en menús (callback_query) - Paso 2.2
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message?.chat.id ?? cb.from.id);
    const queryId = cb.id;
    const profileName = [cb.from.first_name, cb.from.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || `Telegram ${chatId}`;

    const cbData = cb.data ?? "[Botón presionado]";
    const channelMessageId = `tg_cb_${queryId}`;

    // Disparar señal de escritura en T=0ms sin bloquear
    void sendChatAction({ chatId, action: "typing" }).catch(() => {});

    // Intentar responder al callback para quitar el loader del botón en el cliente de Telegram
    try {
      await answerCallbackQuery({ callbackQueryId: queryId });
    } catch {
      // No bloquear la ingesta si la llamada a answerCallbackQuery falla
    }

    await ingestInboundMessage({
      organizationId,
      from: chatId,
      profileName,
      waMessageId: channelMessageId,
      type: "interactive",
      text: cbData,
      timestamp: String(cb.message?.date ?? Math.floor(Date.now() / 1000)),
    });
    return;
  }

  // 2. Intercepción de mensajes regulares
  const message = update.message;
  if (!message) {
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

  const channelMessageId = `tg_${chatId}_${messageId}`;

  // Disparar señal de escritura en T=0ms sin bloquear
  void sendChatAction({ chatId, action: "typing" }).catch(() => {});

  await ingestInboundMessage({
    organizationId,
    from: chatId,
    profileName: profileName || `Telegram ${chatId}`,
    waMessageId: channelMessageId,
    type: message.text !== undefined ? "text" : "unknown",
    text: message.text ?? null,
    timestamp: String(message.date ?? Math.floor(Date.now() / 1000)),
  });
}
