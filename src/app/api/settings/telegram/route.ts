import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getMe, setMyCommands, setWebhook } from "@/lib/telegram/client";
import { createTelegramWebhookToken, hashTelegramWebhookToken } from "@/server/telegram/integrations";
import { getTelegramCredentialsByOrg, saveTelegramCredentials, tokenLast4 } from "@/server/telegram/credentials";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session) => {
  const connection = await getTelegramCredentialsByOrg(session.organizationId);
  return Response.json({ connection: connection ? { botId: connection.botId, botUsername: connection.botUsername, status: connection.status, tokenLast4: tokenLast4(connection.token) } : null });
});

const input = z.object({ token: z.string().trim().min(20) });
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, input); if (!body.ok) return body.response;
  try {
    const bot = await getMe({ token: body.data.token });
    const secret = createTelegramWebhookToken();
    const webhookUrl = `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/telegram/${secret}`;
    await setWebhook({ token: body.data.token, url: webhookUrl, allowedUpdates: ["message", "callback_query"] });
    await setMyCommands({ token: body.data.token });
    await saveTelegramCredentials({ organizationId: session.organizationId, token: body.data.token, botId: bot.id, botUsername: bot.username ?? null, webhookTokenHash: hashTelegramWebhookToken(secret) });
    return Response.json({ ok: true, botUsername: bot.username ?? null, webhookUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo conectar Telegram";
    return apiError(422, "telegram_connection_failed", message);
  }
});
