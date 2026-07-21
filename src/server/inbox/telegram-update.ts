import { z } from "zod";

/** Límite de protección antes de parsear un webhook Telegram. */
export const MAX_TELEGRAM_WEBHOOK_BODY_BYTES = 256 * 1024;

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean(),
  first_name: z.string().min(1).max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(256).optional(),
}).passthrough();

const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().max(256).optional(),
  username: z.string().max(256).optional(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
}).passthrough();

const telegramMessageSchema = z.object({
  message_id: z.number().int().positive(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number().int().positive(),
  text: z.string().max(4096).optional(),
}).passthrough();

const telegramCallbackSchema = z.object({
  id: z.string().min(1).max(256),
  from: telegramUserSchema,
  message: telegramMessageSchema.optional(),
  data: z.string().max(64).optional(),
}).passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackSchema.optional(),
  })
  .passthrough()
  .refine((update) => Boolean(update.message || update.callback_query), {
    message: "El update no contiene message ni callback_query soportado",
  });

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export type TelegramUpdateParseResult =
  | { ok: true; data: TelegramUpdate }
  | { ok: false; reason: "invalid_json" | "invalid_update" };

/** Parsea datos externos sin propagar excepciones al webhook. */
export function parseTelegramUpdate(rawBody: string): TelegramUpdateParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const parsed = telegramUpdateSchema.safeParse(payload);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "invalid_update" };
}

export function isTelegramWebhookBodyWithinLimit(rawBody: string): boolean {
  return Buffer.byteLength(rawBody, "utf8") <= MAX_TELEGRAM_WEBHOOK_BODY_BYTES;
}
