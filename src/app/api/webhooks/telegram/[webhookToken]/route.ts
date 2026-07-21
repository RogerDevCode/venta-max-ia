import { createHash } from "node:crypto";
import { after } from "next/server";
import {
  findTelegramIntegrationByWebhookToken,
  registerTelegramWebhookReceipt,
} from "@/server/telegram/integrations";
import {
  isTelegramWebhookBodyWithinLimit,
  parseTelegramUpdate,
} from "@/server/inbox/telegram-update";
import { processTelegramUpdate } from "@/server/inbox/telegram-webhook";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

/**
 * Webhook público de la Telegram Bot API.
 * POST /api/webhooks/telegram/[webhookToken]
 */
export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;

  const integration = await findTelegramIntegrationByWebhookToken(webhookToken);
  if (!integration) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  if (!isTelegramWebhookBodyWithinLimit(rawBody)) {
    return Response.json({ received: true });
  }

  const parsed = parseTelegramUpdate(rawBody);
  if (!parsed.ok) {
    return Response.json({ received: true });
  }

  const update = parsed.data;
  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");

  const receipt = await registerTelegramWebhookReceipt({
    organizationId: integration.organizationId,
    integrationId: integration.id,
    updateId: update.update_id,
    payloadHash,
  });

  if (receipt !== "received") {
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processTelegramUpdate({
        organizationId: integration.organizationId,
        update,
      });
    } catch (err) {
      console.error("[telegram-webhook] error procesando update:", err);
    }
  });

  return Response.json({ received: true });
}

