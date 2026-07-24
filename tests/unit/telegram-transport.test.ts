import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyTelegramError, telegramCall } from "@/server/telegram/transport";
import { TelegramApiError } from "@/lib/telegram/client";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ TELEGRAM_API_BASE_URL: "https://api.telegram.org", TELEGRAM_ADMIN_BOT_TOKEN: undefined }),
}));

describe("Telegram tenant transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("always sends with the tenant token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await telegramCall({ token: "tenant-token", status: "connected" }, "sendChatAction", { chat_id: "1", action: "typing" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("bottenant-token/sendChatAction");
  });

  it("classifies retryable and terminal errors", () => {
    expect(classifyTelegramError(new TelegramApiError("rate", { status: 429 }))).toMatchObject({ code: "rate_limited", retryable: true });
    expect(classifyTelegramError(new TelegramApiError("auth", { status: 401 }))).toMatchObject({ code: "unauthorized", retryable: false });
    expect(classifyTelegramError(new TelegramApiError("server", { status: 500 }))).toMatchObject({ code: "server", retryable: true });
  });

  it("blocks every sandbox request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(telegramCall({ token: "tenant", status: "connected" }, "sendMessage", {}, { isTest: true }))
      .rejects.toMatchObject({ message: "sandbox_violation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
