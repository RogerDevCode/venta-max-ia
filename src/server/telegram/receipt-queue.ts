import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { processTelegramReceipt } from "@/server/telegram/update-processor";

const LEASE_SECONDS = 30;
const MAX_ATTEMPTS = 5;

export async function claimTelegramReceipt(organizationId: string, receiptId: string) {
  const now = new Date();
  const rows = await getDb().update(schema.telegramWebhookReceipt).set({
    status: "processing",
    attempts: sql`${schema.telegramWebhookReceipt.attempts} + 1`,
    leaseExpiresAt: sql`clock_timestamp() + (${LEASE_SECONDS} * interval '1 second')`,
    lastError: null,
  }).where(scoped(schema.telegramWebhookReceipt.organizationId, organizationId, and(
    eq(schema.telegramWebhookReceipt.id, receiptId),
    or(
      and(eq(schema.telegramWebhookReceipt.status, "received"), lte(schema.telegramWebhookReceipt.availableAt, now)),
      and(eq(schema.telegramWebhookReceipt.status, "retryable_failed"), lte(schema.telegramWebhookReceipt.availableAt, now)),
      and(eq(schema.telegramWebhookReceipt.status, "processing"), lte(schema.telegramWebhookReceipt.leaseExpiresAt, now)),
    ),
  ))).returning();
  return rows[0] ?? null;
}

export async function completeTelegramReceipt(input: {
  organizationId: string;
  receiptId: string;
  status?: "processed" | "ignored" | "failed";
  ignoredReason?: string | null;
  error?: string | null;
}) {
  await getDb().update(schema.telegramWebhookReceipt).set({
    status: input.status ?? "processed",
    ignoredReason: input.ignoredReason ?? null,
    lastError: input.error?.slice(0, 1000) ?? null,
    leaseExpiresAt: null,
    processedAt: new Date(),
  }).where(scoped(schema.telegramWebhookReceipt.organizationId, input.organizationId,
    eq(schema.telegramWebhookReceipt.id, input.receiptId)));
}

export function telegramReceiptRetryDelayMs(attempts: number): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export async function retryTelegramReceipt(input: {
  organizationId: string;
  receiptId: string;
  attempts: number;
  error: unknown;
}) {
  const terminal = input.attempts >= MAX_ATTEMPTS;
  await getDb().update(schema.telegramWebhookReceipt).set({
    status: terminal ? "failed" : "retryable_failed",
    availableAt: new Date(Date.now() + telegramReceiptRetryDelayMs(input.attempts)),
    leaseExpiresAt: null,
    lastError: (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 1000),
    processedAt: terminal ? new Date() : null,
  }).where(scoped(schema.telegramWebhookReceipt.organizationId, input.organizationId,
    eq(schema.telegramWebhookReceipt.id, input.receiptId)));
}

export async function drainTelegramReceipts(batchSize = 100): Promise<void> {
  const db = getDb();
  for (;;) {
    const now = new Date();
    const rows = await db.select({
      id: schema.telegramWebhookReceipt.id,
      organizationId: schema.telegramWebhookReceipt.organizationId,
    }).from(schema.telegramWebhookReceipt).where(or(
      and(eq(schema.telegramWebhookReceipt.status, "received"), lte(schema.telegramWebhookReceipt.availableAt, now)),
      and(eq(schema.telegramWebhookReceipt.status, "retryable_failed"), lte(schema.telegramWebhookReceipt.availableAt, now)),
      and(eq(schema.telegramWebhookReceipt.status, "processing"), lte(schema.telegramWebhookReceipt.leaseExpiresAt, now)),
    )).orderBy(asc(schema.telegramWebhookReceipt.availableAt), asc(schema.telegramWebhookReceipt.id)).limit(batchSize);
    if (rows.length === 0) return;
    await Promise.allSettled(rows.map(async (row) => {
      const receipt = await claimTelegramReceipt(row.organizationId, row.id);
      if (!receipt) return;
      try {
        await processTelegramReceipt(receipt);
      } catch (error) {
        await retryTelegramReceipt({ organizationId: row.organizationId, receiptId: row.id, attempts: receipt.attempts, error });
      }
    }));
    if (rows.length < batchSize) return;
  }
}
