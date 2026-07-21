import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export type TelegramIntegrationRoute = {
  id: string;
  organizationId: string;
};

export type TelegramWebhookReceiptResult = "received" | "duplicate" | "conflict";

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
  const db = getDb();
  const rows = await db
    .select({
      id: schema.telegramIntegration.id,
      organizationId: schema.telegramIntegration.organizationId,
    })
    .from(schema.telegramIntegration)
    .where(
      eq(
        schema.telegramIntegration.webhookTokenHash,
        hashTelegramWebhookToken(webhookToken)
      )
    )
    .limit(1);
  return rows[0] ?? null;
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
      status: "received",
    })
    .onConflictDoNothing({
      target: [
        schema.telegramWebhookReceipt.organizationId,
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
