export function createTelegramWebhookUrl(appBaseUrl: string, webhookToken: string): string {
  const baseUrl = new URL(appBaseUrl);
  if (baseUrl.protocol !== "https:") {
    throw new Error(
      "APP_BASE_URL debe ser una URL pública con HTTPS para que Telegram pueda entregar mensajes."
    );
  }

  return new URL(`/api/webhooks/telegram/${webhookToken}`, baseUrl).toString();
}
