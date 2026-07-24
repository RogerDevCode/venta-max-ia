import { createHash } from "node:crypto";
import { after } from "next/server";
import {
  findTelegramIntegrationByWebhookToken,
  captureTelegramReceiptContext,
  hashTelegramWebhookToken,
  registerTelegramWebhookRejection,
  registerTelegramWebhookReceipt,
} from "@/server/telegram/integrations";
import {
  isTelegramWebhookBodyWithinLimit,
  parseTelegramUpdate,
} from "@/server/inbox/telegram-update";
import { safeEqual } from "@/server/security/safe-equal";
import { drainTelegramReceipts } from "@/server/telegram/receipt-queue";
import { decodeMenuCallback } from "@/server/telegram/menu-codec";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };
const MAX_BODY_BYTES = 256 * 1024;

async function readLimitedBody(req: Request): Promise<{ body: string; oversized: boolean }> {
  if (!req.body) return { body: "", oversized: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return { body: Buffer.concat(chunks).toString("utf8"), oversized: true };
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks).toString("utf8"), oversized: false };
}

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

  if (integration.status === "connected" && integration.webhookHeaderSecretHash) {
    const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!header || !safeEqual(hashTelegramWebhookToken(header), integration.webhookHeaderSecretHash)) {
      return new Response(null, { status: 404 });
    }
  }

  const limited = await readLimitedBody(req);
  const rawBody = limited.body;
  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (limited.oversized || !isTelegramWebhookBodyWithinLimit(rawBody)) {
    await registerTelegramWebhookRejection({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      payloadHash,
      reason: "oversized",
    });
    return Response.json({ received: true });
  }

  const parsed = parseTelegramUpdate(rawBody);
  if (!parsed.ok) {
    await registerTelegramWebhookRejection({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      payloadHash,
      reason: "malformed",
    });
    return Response.json({ received: true });
  }

  const update = parsed.data;
  const sourceMessage = update.callback_query?.message ?? update.message;
  const context = sourceMessage ? await captureTelegramReceiptContext({
    organizationId: integration.organizationId,
    chatId: String(sourceMessage.chat.id),
    menuInstanceId: update.callback_query?.data ? decodeMenuCallback(update.callback_query.data)?.instanceId : null,
  }) : { conversationId: null, expectedFsmRevision: 0, expectedFsmStateKey: "menu:main/main_menu" };

  const receipt = await registerTelegramWebhookReceipt({
    organizationId: integration.organizationId,
    integrationId: integration.id,
    updateId: update.update_id,
    payloadHash,
    payload: update,
    ...context,
  });

  if (receipt !== "received") {
    return Response.json({ received: true });
  }

  after(() => drainTelegramReceipts().catch((err) =>
    console.error("[telegram-webhook] drenaje inmediato falló:", err)
  ));

  return Response.json({ received: true });
}
