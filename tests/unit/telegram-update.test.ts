import { describe, expect, it } from "vitest";
import {
  MAX_TELEGRAM_WEBHOOK_BODY_BYTES,
  parseTelegramUpdate,
} from "@/server/inbox/telegram-update";

describe("parseTelegramUpdate", () => {
  it("rechaza JSON inválido y updates sin contenido soportado", () => {
    expect(parseTelegramUpdate("{").ok).toBe(false);
    expect(parseTelegramUpdate(JSON.stringify({ update_id: 1 }))).toMatchObject({
      ok: false,
      reason: "invalid_update",
    });
  });

  it("acepta un mensaje Telegram válido", () => {
    const parsed = parseTelegramUpdate(
      JSON.stringify({
        update_id: 100,
        message: {
          message_id: 8,
          from: { id: 99, is_bot: false, first_name: "Ana" },
          chat: { id: 99, type: "private" },
          date: 1_780_000_000,
          text: "Hola",
        },
      })
    );

    expect(parsed).toMatchObject({ ok: true, data: { update_id: 100 } });
  });

  it("acepta un callback válido y rechaza texto fuera del límite Telegram", () => {
    const callback = parseTelegramUpdate(
      JSON.stringify({
        update_id: 101,
        callback_query: {
          id: "callback_1",
          from: { id: 99, is_bot: false, first_name: "Ana" },
          data: "product:sku_1",
        },
      })
    );
    expect(callback).toMatchObject({ ok: true, data: { update_id: 101 } });

    const tooLong = parseTelegramUpdate(
      JSON.stringify({
        update_id: 102,
        message: {
          message_id: 9,
          chat: { id: 99, type: "private" },
          date: 1_780_000_000,
          text: "a".repeat(4097),
        },
      })
    );
    expect(tooLong).toMatchObject({ ok: false, reason: "invalid_update" });
  });

  it("declara un máximo de body explícito para el webhook", () => {
    expect(MAX_TELEGRAM_WEBHOOK_BODY_BYTES).toBe(256 * 1024);
  });
});
