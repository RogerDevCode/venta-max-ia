import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, getIngressSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export type TelegramIntegrationRoute = {
  id: string;
  organizationId: string;
  status: "pending" | "header_pending" | "connected" | "reconnect_required" | "failed";
  webhookHeaderSecretHash: string | null;
};

export type TelegramWebhookReceiptResult = "received" | "duplicate" | "conflict";

export async function captureTelegramReceiptContext(input: {
  organizationId: string;
  chatId: string;
  menuInstanceId?: string | null;
}): Promise<{ conversationId: string | null; expectedFsmRevision: number; expectedFsmStateKey: string }> {
  const db = getDb();
  if (input.menuInstanceId) {
    const rows = await db.select({
      conversationId: schema.telegramMenuInstance.conversationId,
      expectedFsmRevision: schema.telegramMenuInstance.fsmRevision,
      expectedFsmStateKey: schema.telegramMenuInstance.fsbState,
    }).from(schema.telegramMenuInstance).where(scoped(
      schema.telegramMenuInstance.organizationId,
      input.organizationId,
      and(eq(schema.telegramMenuInstance.id, input.menuInstanceId), eq(schema.telegramMenuInstance.chatId, input.chatId)),
    )).limit(1);
    if (rows[0]) return rows[0];
  }
  const rows = await db.select({
    conversationId: schema.conversation.id,
    expectedFsmRevision: schema.conversation.fsmRevision,
    stateMetadata: schema.conversation.stateMetadata,
  }).from(schema.contact)
    .innerJoin(schema.conversation, eq(schema.conversation.contactId, schema.contact.id))
    .where(scoped(schema.contact.organizationId, input.organizationId, and(
      eq(schema.contact.channel, "telegram"),
      eq(schema.contact.externalAddress, input.chatId),
      eq(schema.conversation.organizationId, input.organizationId),
      eq(schema.conversation.isTest, false),
    ))).limit(1);
  const row = rows[0];
  if (!row) return { conversationId: null, expectedFsmRevision: 0, expectedFsmStateKey: "menu:main/main_menu" };
  const state = (row.stateMetadata ?? {}) as Record<string, unknown>;
  const currentState = typeof state.current_state === "string" ? state.current_state : "menu:main";
  const activeStep = typeof state.active_step === "string" ? state.active_step : currentState === "menu:main" ? "main_menu" : "unknown";
  return { conversationId: row.conversationId, expectedFsmRevision: row.expectedFsmRevision, expectedFsmStateKey: `${currentState}/${activeStep}` };
}

/** Genera un secreto opaco para incluir una sola vez en la URL del webhook. */
export function createTelegramWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

/** El token de ruta jamás se persiste en claro. */
export function hashTelegramWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Resuelve el tenant solo desde una integración Telegram persistida. */
export async function findTelegramIntegrationByWebhookToken(
  webhookToken: string
): Promise<TelegramIntegrationRoute | null> {
  const rows = await getIngressSql()<{
    id: string;
    organization_id: string;
    webhook_header_secret_hash: string | null;
    status: TelegramIntegrationRoute["status"];
  }[]>`select * from app_security.resolve_telegram_webhook(${hashTelegramWebhookToken(webhookToken)})`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        status: row.status,
        webhookHeaderSecretHash: row.webhook_header_secret_hash,
      }
    : null;
}

/**
 * Persiste evidencia de recepción antes del procesamiento. La unicidad por
 * organización/updateId hace los reintentos seguros y detecta payloads
 * incompatibles bajo el mismo identificador externo.
 */
export async function registerTelegramWebhookReceipt(input: {
  organizationId: string;
  integrationId: string;
  updateId: number;
  payloadHash: string;
  payload?: Record<string, unknown>;
  conversationId?: string | null;
  expectedFsmRevision?: number | null;
  expectedFsmStateKey?: string | null;
}): Promise<TelegramWebhookReceiptResult> {
  const db = getDb();
  const inserted = await db
    .insert(schema.telegramWebhookReceipt)
    .values({
      id: newId("telegramReceipt"),
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      updateId: input.updateId,
      payloadHash: input.payloadHash,
      payload: input.payload ?? {},
      conversationId: input.conversationId,
      expectedFsmRevision: input.expectedFsmRevision,
      expectedFsmStateKey: input.expectedFsmStateKey,
      status: "received",
    })
    .onConflictDoNothing({
      target: [
        schema.telegramWebhookReceipt.organizationId,
        schema.telegramWebhookReceipt.integrationId,
        schema.telegramWebhookReceipt.updateId,
      ],
    })
    .returning({ id: schema.telegramWebhookReceipt.id });
  if (inserted[0]) return "received";

  const existing = await db
    .select({
      id: schema.telegramWebhookReceipt.id,
      payloadHash: schema.telegramWebhookReceipt.payloadHash,
    })
    .from(schema.telegramWebhookReceipt)
    .where(
      and(
        scoped(schema.telegramWebhookReceipt.organizationId, input.organizationId),
        eq(schema.telegramWebhookReceipt.integrationId, input.integrationId),
        eq(schema.telegramWebhookReceipt.updateId, input.updateId)
      )
    )
    .limit(1);
  const receipt = existing[0];
  if (!receipt) {
    throw new Error("No se encontró el receipt Telegram después del conflicto de inserción");
  }
  if (receipt.payloadHash === input.payloadHash) return "duplicate";

  await db
    .update(schema.telegramWebhookReceipt)
    .set({ status: "conflict" })
    .where(
      and(
        scoped(schema.telegramWebhookReceipt.organizationId, input.organizationId),
        eq(schema.telegramWebhookReceipt.id, receipt.id)
      )
    );
  return "conflict";
}

export async function registerTelegramWebhookRejection(input: {
  organizationId: string;
  integrationId: string;
  payloadHash: string;
  reason: "malformed" | "oversized";
}): Promise<void> {
  await getDb().insert(schema.telegramWebhookRejection).values({
    id: newId("telegramRejection"),
    ...input,
  }).onConflictDoNothing({
    target: [
      schema.telegramWebhookRejection.organizationId,
      schema.telegramWebhookRejection.integrationId,
      schema.telegramWebhookRejection.payloadHash,
    ],
  });
}
