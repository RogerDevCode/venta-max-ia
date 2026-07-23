import { getEnv } from "@/lib/env";
import dns from "node:dns";

// En entornos Linux con doble pila (dual-stack), api.telegram.org suele devolver AAAA (IPv6) y A (IPv4).
// Algunas rutas IPv6 descartan paquetes, así que el canal Telegram usa IPv4 de forma explícita.
try {
  dns.setDefaultResultOrder("ipv4first");
  const originalLookup = dns.lookup;
  dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
    if (typeof options === "function") {
      return originalLookup(
        hostname,
        { family: 4 },
        options as (error: NodeJS.ErrnoException | null, address: string, family: number) => void
      );
    }
    return originalLookup(
      hostname,
      { ...(typeof options === "object" && options !== null ? options : {}), family: 4 },
      callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void
    );
  }) as typeof dns.lookup;
} catch {}

/**
 * Cliente propio de la Telegram Bot API.
 * Única frontera de salida hacia Telegram (Constitución II): todo request pasa
 * por telegramRequest.
 */

export class TelegramApiError extends Error {
  status: number;
  errorCode: number | null;
  description: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: {
      status: number;
      errorCode?: number | null;
      description?: string | null;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = "TelegramApiError";
    this.status = opts.status;
    this.errorCode = opts.errorCode ?? null;
    this.description = opts.description ?? null;
    this.details = opts.details;
  }

  /** Token vencido/inválido → la conexión requiere re-autenticación. */
  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.errorCode === 401 ||
      (typeof this.description === "string" &&
        this.description.toLowerCase().includes("unauthorized"))
    );
  }
}

export async function telegramRequest<T>(
  methodName: string,
  opts: {
    token?: string;
    body?: unknown;
  }
): Promise<T> {
  const env = getEnv();
  const token = opts.token ?? env.TELEGRAM_ADMIN_BOT_TOKEN;
  if (!token) {
    throw new TelegramApiError(
      "No hay TELEGRAM_ADMIN_BOT_TOKEN configurado en el entorno o parámetros",
      { status: 401 }
    );
  }

  const url = `${env.TELEGRAM_API_BASE_URL}/bot${token}/${methodName}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new TelegramApiError("No se pudo contactar la API de Telegram", {
      status: 0,
      details: cause,
    });
  }

  if (!res) {
    throw new TelegramApiError("No se recibió respuesta HTTP de Telegram", {
      status: 0,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON
  }

  const payload = json as {
    ok?: boolean;
    result?: T;
    error_code?: number;
    description?: string;
  } | null;

  if (!res.ok || payload?.ok === false) {
    throw new TelegramApiError(
      payload?.description ?? `Telegram respondió ${res.status}`,
      {
        status: res.status,
        errorCode: payload?.error_code ?? null,
        description: payload?.description ?? null,
        details: json ?? text,
      }
    );
  }

  return (payload?.result ?? json) as T;
}

export interface TelegramSendMessageOptions {
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyMarkup?: unknown;
  token?: string;
}

export async function sendMessage(
  opts: TelegramSendMessageOptions
): Promise<{ message_id: number; chat: { id: number } }> {
  return telegramRequest("sendMessage", {
    token: opts.token,
    body: {
      chat_id: opts.chatId,
      text: opts.text,
      parse_mode: opts.parseMode,
      reply_markup: opts.replyMarkup,
    },
  });
}

export async function sendChatAction(opts: {
  chatId: string | number;
  action: "typing" | "record_voice" | "upload_voice";
  token?: string;
}): Promise<boolean> {
  return telegramRequest<boolean>("sendChatAction", {
    token: opts.token,
    body: {
      chat_id: opts.chatId,
      action: opts.action,
    },
  });
}

export async function sendVoice(opts: {
  chatId: string | number;
  voiceUrl: string;
  caption?: string;
  token?: string;
}): Promise<{ message_id: number }> {
  return telegramRequest("sendVoice", {
    token: opts.token,
    body: {
      chat_id: opts.chatId,
      voice: opts.voiceUrl,
      caption: opts.caption,
    },
  });
}

export async function answerCallbackQuery(opts: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
  token?: string;
}): Promise<boolean> {
  return telegramRequest<boolean>("answerCallbackQuery", {
    token: opts.token,
    body: {
      callback_query_id: opts.callbackQueryId,
      text: opts.text,
      show_alert: opts.showAlert,
    },
  });
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

export async function getMe(opts?: { token?: string }): Promise<TelegramBotInfo> {
  return telegramRequest<TelegramBotInfo>("getMe", { token: opts?.token });
}

export async function getWebhookInfo(opts?: { token?: string }): Promise<TelegramWebhookInfo> {
  return telegramRequest<TelegramWebhookInfo>("getWebhookInfo", { token: opts?.token });
}

export async function setWebhook(opts: {
  url: string;
  secretToken?: string;
  maxConnections?: number;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
  token?: string;
}): Promise<boolean> {
  return telegramRequest<boolean>("setWebhook", {
    token: opts.token,
    body: {
      url: opts.url,
      secret_token: opts.secretToken,
      max_connections: opts.maxConnections,
      allowed_updates: opts.allowedUpdates,
      drop_pending_updates: opts.dropPendingUpdates,
    },
  });
}

export async function deleteWebhook(opts?: {
  dropPendingUpdates?: boolean;
  token?: string;
}): Promise<boolean> {
  return telegramRequest<boolean>("deleteWebhook", {
    token: opts?.token,
    body: {
      drop_pending_updates: opts?.dropPendingUpdates,
    },
  });
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export const DEFAULT_TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Iniciar o reiniciar la conversación" },
  { command: "menu", description: "Desplegar el menú principal de opciones" },
  { command: "reset", description: "Limpiar estado y reiniciar asistente IA" },
  { command: "humano", description: "Solicitar atención con un agente humano" },
];

export async function setMyCommands(opts: {
  commands?: TelegramBotCommand[];
  token?: string;
}): Promise<boolean> {
  return telegramRequest<boolean>("setMyCommands", {
    token: opts.token,
    body: {
      commands: opts.commands ?? DEFAULT_TELEGRAM_COMMANDS,
    },
  });
}
