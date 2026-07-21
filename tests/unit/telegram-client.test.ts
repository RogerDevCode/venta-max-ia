import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  sendMessage,
  sendChatAction,
  getMe,
  getWebhookInfo,
  setWebhook,
  TelegramApiError,
  telegramRequest,
} from "@/lib/telegram/client";

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-suficiente-para-tests";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.TELEGRAM_ADMIN_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
  process.env.TELEGRAM_API_BASE_URL = "https://api.telegram.org";
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("Telegram Bot API Client (Paso 1.1)", () => {
  it("envía un mensaje correctamente formateado con sendMessage", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 42,
              chat: { id: 987654321 },
            },
          })
        ),
    } as unknown as Response);

    const res = await sendMessage({
      chatId: 987654321,
      text: "¡Hola desde Venta Max IA vía Telegram!",
      parseMode: "HTML",
    });

    expect(res.message_id).toBe(42);
    expect(res.chat.id).toBe(987654321);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage"
    );
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      chat_id: 987654321,
      text: "¡Hola desde Venta Max IA vía Telegram!",
      parse_mode: "HTML",
    });
  });

  it("envía acción de escritura con sendChatAction", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ ok: true, result: true })),
    } as unknown as Response);

    const res = await sendChatAction({
      chatId: 987654321,
      action: "typing",
    });

    expect(res).toBe(true);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/sendChatAction");
    expect(JSON.parse(options.body)).toEqual({
      chat_id: 987654321,
      action: "typing",
    });
  });

  it("lanza TelegramApiError tipado cuando Telegram responde ok: false o error HTTP", async () => {
    const errorResponse = {
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: chat not found",
          })
        ),
    } as unknown as Response;

    fetchMock.mockResolvedValueOnce(errorResponse);
    await expect(
      sendMessage({ chatId: 0, text: "fallo" })
    ).rejects.toThrowError(TelegramApiError);

    fetchMock.mockResolvedValueOnce(errorResponse);
    try {
      await sendMessage({ chatId: 0, text: "fallo" });
    } catch (err) {
      if (err instanceof TelegramApiError) {
        expect(err.status).toBe(400);
        expect(err.errorCode).toBe(400);
        expect(err.description).toBe("Bad Request: chat not found");
        expect(err.isAuthError).toBe(false);
      } else {
        throw err;
      }
    }
  });

  it("detecta isAuthError en fallos 401 o Unauthorized de Telegram", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: false,
            error_code: 401,
            description: "Unauthorized",
          })
        ),
    } as unknown as Response);

    try {
      await telegramRequest("getMe", { token: "token-revocado" });
    } catch (err) {
      expect(err instanceof TelegramApiError).toBe(true);
      if (err instanceof TelegramApiError) {
        expect(err.isAuthError).toBe(true);
      }
    }
  });

  it("permite inyectar un token específico en lugar de usar el del entorno", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 1 } } })),
    } as unknown as Response);

    await sendMessage({
      chatId: 100,
      text: "Mensaje custom token",
      token: "CUSTOM_TOKEN_999",
    });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botCUSTOM_TOKEN_999/sendMessage");
  });

  it("obtiene información del bot con getMe", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            result: { id: 123, is_bot: true, first_name: "VentaMaxIABot", username: "venta_max_ia_bot" },
          })
        ),
    } as unknown as Response);

    const bot = await getMe();
    expect(bot.id).toBe(123);
    expect(bot.first_name).toBe("VentaMaxIABot");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("/getMe");
  });

  it("obtiene estado del webhook con getWebhookInfo", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: true,
            result: { url: "https://ejemplo.com/webhook", has_custom_certificate: false, pending_update_count: 0 },
          })
        ),
    } as unknown as Response);

    const info = await getWebhookInfo();
    expect(info.url).toBe("https://ejemplo.com/webhook");
    expect(info.pending_update_count).toBe(0);
  });

  it("configura el webhook con setWebhook", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ ok: true, result: true })),
    } as unknown as Response);

    const res = await setWebhook({
      url: "https://ejemplo.com/api/webhooks/telegram/secret123",
      secretToken: "secret123",
    });

    expect(res).toBe(true);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/setWebhook");
    expect(JSON.parse(options.body)).toEqual({
      url: "https://ejemplo.com/api/webhooks/telegram/secret123",
      secret_token: "secret123",
    });
  });
});
