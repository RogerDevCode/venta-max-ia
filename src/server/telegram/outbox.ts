import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getTelegramCredentialsByOrg } from "@/server/telegram/credentials";
import { activateDeliveredTelegramMenu } from "@/server/telegram/menu-store";
import { telegramCall, type TelegramTransportError } from "@/server/telegram/transport";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type OutboxInsert = typeof schema.telegramOutbox.$inferInsert;
type OutboxRow = typeof schema.telegramOutbox.$inferSelect;

export async function enqueueTelegramOutbox(tx: Tx, input: Omit<OutboxInsert, "id" | "status" | "attempts" | "availableAt" | "createdAt">) {
  const rows = await tx.insert(schema.telegramOutbox).values({
    id: newId("telegramOutbox"),
    ...input,
    status: "pending",
  }).onConflictDoNothing({
    target: [schema.telegramOutbox.organizationId, schema.telegramOutbox.idempotencyKey],
  }).returning();
  if (rows[0]) return rows[0];
  const existing = await tx.select().from(schema.telegramOutbox).where(scoped(
    schema.telegramOutbox.organizationId,
    input.organizationId,
    eq(schema.telegramOutbox.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  return existing[0] ?? null;
}

async function claimOutbox(id: string, organizationId: string) {
  const now = new Date();
  const rows = await getDb().update(schema.telegramOutbox).set({
    status: "sending",
    attempts: sql`${schema.telegramOutbox.attempts} + 1`,
    leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
  }).where(scoped(schema.telegramOutbox.organizationId, organizationId, and(
    eq(schema.telegramOutbox.id, id),
    or(
      and(eq(schema.telegramOutbox.status, "pending"), lte(schema.telegramOutbox.availableAt, now)),
      and(eq(schema.telegramOutbox.status, "retryable_failed"), lte(schema.telegramOutbox.availableAt, now)),
      and(eq(schema.telegramOutbox.status, "sending"), lte(schema.telegramOutbox.leaseExpiresAt, now)),
    ),
  ))).returning();
  return rows[0] ?? null;
}

function retryDelay(attempts: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

export async function deliverOutboxEntry(entry: OutboxRow): Promise<boolean> {
  const credentials = await getTelegramCredentialsByOrg(entry.organizationId);
  if (!credentials || credentials.status !== "connected") {
    await getDb().update(schema.telegramOutbox).set({ status: "failed", leaseExpiresAt: null, lastError: "telegram_integration_unavailable" })
      .where(scoped(schema.telegramOutbox.organizationId, entry.organizationId, eq(schema.telegramOutbox.id, entry.id)));
    return false;
  }
  const payload = entry.payload as { chatId?: string; menuInstanceId?: string };
  if (!payload.chatId || !entry.text) throw new Error("invalid_outbox_payload");
  try {
    const sent = await telegramCall<{ message_id: number }>(credentials, "sendMessage", {
      chat_id: payload.chatId,
      text: entry.text,
      reply_markup: entry.replyMarkup ?? undefined,
    });
    await getDb().update(schema.telegramOutbox).set({
      status: "delivered", telegramMessageId: sent.message_id, deliveredAt: new Date(), leaseExpiresAt: null, lastError: null,
    }).where(scoped(schema.telegramOutbox.organizationId, entry.organizationId, eq(schema.telegramOutbox.id, entry.id)));
    if (entry.kind === "menu" && payload.menuInstanceId) {
      await activateDeliveredTelegramMenu({
        organizationId: entry.organizationId,
        conversationId: entry.conversationId,
        instanceId: payload.menuInstanceId,
        telegramMessageId: sent.message_id,
      });
    }
    return true;
  } catch (error) {
    const transport = error as TelegramTransportError;
    const status = transport.deliveryUnknown
      ? "delivery_unknown"
      : transport.retryable ? "retryable_failed" : "failed";
    await getDb().update(schema.telegramOutbox).set({
      status,
      availableAt: new Date(Date.now() + retryDelay(entry.attempts)),
      leaseExpiresAt: null,
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    }).where(scoped(schema.telegramOutbox.organizationId, entry.organizationId, eq(schema.telegramOutbox.id, entry.id)));
    if (transport.code === "unauthorized") {
      await getDb().update(schema.telegramIntegration).set({ status: "reconnect_required", updatedAt: new Date() })
        .where(scoped(schema.telegramIntegration.organizationId, entry.organizationId, eq(schema.telegramIntegration.id, entry.integrationId)));
    }
    return false;
  }
}

export async function drainTelegramOutbox(batchSize = 100): Promise<void> {
  for (;;) {
    const now = new Date();
    const rows = await getDb().select({ id: schema.telegramOutbox.id, organizationId: schema.telegramOutbox.organizationId })
      .from(schema.telegramOutbox)
      .where(or(
        and(inArray(schema.telegramOutbox.status, ["pending", "retryable_failed"]), lte(schema.telegramOutbox.availableAt, now)),
        and(eq(schema.telegramOutbox.status, "sending"), lte(schema.telegramOutbox.leaseExpiresAt, now)),
      ))
      .orderBy(asc(schema.telegramOutbox.availableAt), asc(schema.telegramOutbox.id))
      .limit(batchSize);
    if (rows.length === 0) return;
    await Promise.allSettled(rows.map(async (row) => {
      const claimed = await claimOutbox(row.id, row.organizationId);
      if (claimed) await deliverOutboxEntry(claimed);
    }));
    if (rows.length < batchSize) return;
  }
}
