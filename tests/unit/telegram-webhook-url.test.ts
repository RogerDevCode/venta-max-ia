import { describe, expect, it } from "vitest";
import { createTelegramWebhookUrl } from "@/server/telegram/webhook-url";

describe("createTelegramWebhookUrl", () => {
  it("construye una URL HTTPS pública sin duplicar barras", () => {
    expect(createTelegramWebhookUrl("https://crm.example.com/", "secret_test")).toBe(
      "https://crm.example.com/api/webhooks/telegram/secret_test"
    );
  });

  it("rechaza una URL local o HTTP antes de llamar a Telegram", () => {
    expect(() => createTelegramWebhookUrl("http://127.0.0.1:3000", "secret_test")).toThrow(
      "APP_BASE_URL debe ser una URL pública con HTTPS"
    );
  });
});
