import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getMe, setMyCommands, setWebhook } from "@/lib/telegram/client";
import { createTelegramWebhookToken, hashTelegramWebhookToken } from "@/server/telegram/integrations";
import { decryptWebhookSecrets, getTelegramCredentialsByOrg, getTelegramIntegrationSnapshot, restoreTelegramIntegrationSnapshot, saveTelegramCredentials, tokenLast4 } from "@/server/telegram/credentials";
import { createTelegramWebhookUrl } from "@/server/telegram/webhook-url";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session) => {
  const connection = await getTelegramCredentialsByOrg(session.organizationId);
  return Response.json({ connection: connection ? { botId: connection.botId, botUsername: connection.botUsername, status: connection.status, tokenLast4: tokenLast4(connection.token) } : null });
});

const input = z.object({ token: z.string().trim().min(20) });
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario puede configurar Telegram.");
  const body = await parseBody(req, input); if (!body.ok) return body.response;
  const secret = createTelegramWebhookToken();
  const headerSecret = createTelegramWebhookToken();
  let webhookUrl: string;
  try {
    webhookUrl = createTelegramWebhookUrl(getEnv().APP_BASE_URL, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "APP_BASE_URL no permite registrar el webhook de Telegram.";
    return apiError(422, "telegram_webhook_url_invalid", message);
  }
  const previous = await getTelegramIntegrationSnapshot(session.organizationId);
  const previousCredentials = await getTelegramCredentialsByOrg(session.organizationId);
  try {
    const bot = await getMe({ token: body.data.token });
    const collision = await getDb().select({ organizationId: schema.telegramIntegration.organizationId })
      .from(schema.telegramIntegration).where(and(eq(schema.telegramIntegration.botId, bot.id), ne(schema.telegramIntegration.organizationId, session.organizationId))).limit(1);
    if (collision[0]) return apiError(409, "telegram_bot_already_claimed", "El bot ya pertenece a otra organización.");
    await saveTelegramCredentials({
      organizationId: session.organizationId,
      token: body.data.token,
      botId: bot.id,
      botUsername: bot.username ?? null,
      webhookTokenHash: hashTelegramWebhookToken(secret),
      webhookHeaderSecretHash: hashTelegramWebhookToken(headerSecret),
      routeSecret: secret,
      headerSecret,
      status: "pending",
    });
    await setWebhook({ token: body.data.token, url: webhookUrl, secretToken: headerSecret, allowedUpdates: ["message", "callback_query"] });
    await setMyCommands({ token: body.data.token });
    await saveTelegramCredentials({ organizationId: session.organizationId, token: body.data.token, botId: bot.id, botUsername: bot.username ?? null, webhookTokenHash: hashTelegramWebhookToken(secret), webhookHeaderSecretHash: hashTelegramWebhookToken(headerSecret), routeSecret: secret, headerSecret, status: "connected" });
    return Response.json({ ok: true, botUsername: bot.username ?? null });
  } catch (error) {
    const oldSecrets = decryptWebhookSecrets(previous);
    if (previousCredentials && oldSecrets) {
      try {
        await setWebhook({
          token: previousCredentials.token,
          url: createTelegramWebhookUrl(getEnv().APP_BASE_URL, oldSecrets.routeSecret),
          secretToken: oldSecrets.headerSecret,
          allowedUpdates: ["message", "callback_query"],
        });
      } catch (compensationError) {
        console.error("[telegram-settings] compensación del webhook falló:", compensationError);
      }
    }
    await restoreTelegramIntegrationSnapshot(session.organizationId, previous);
    const message = error instanceof Error ? error.message : "No se pudo conectar Telegram";
    return apiError(422, "telegram_connection_failed", message);
  }
});
