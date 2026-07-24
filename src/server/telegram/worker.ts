import { and, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { drainTelegramMenuActions } from "@/server/telegram/menu-action-runner";
import { drainTelegramOutbox } from "@/server/telegram/outbox";
import { drainTelegramReceipts } from "@/server/telegram/receipt-queue";

const workerGlobal = globalThis as unknown as {
  __telegramReliabilityTimer?: NodeJS.Timeout;
  __telegramReliabilityRunning?: Promise<void>;
  __telegramReliabilityLastError?: string | null;
  __telegramReliabilityLastPurgeAt?: Date | null;
};

function logError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  workerGlobal.__telegramReliabilityLastError = message.slice(0, 1000);
  console.error("[telegram-worker]", error);
}

export async function purgeTelegramTerminalRows(batchSize = 500): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const connection = await import("@/lib/db").then(({ getSql }) => getSql().reserve());
  const lock = await connection<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('venta-max:telegram-retention')) as locked`;
  if (!lock[0]?.locked) { await connection.release(); return 0; }
  let purged = 0;
  try {
    const receiptIds = await db.select({ id: schema.telegramWebhookReceipt.id }).from(schema.telegramWebhookReceipt)
      .where(and(inArray(schema.telegramWebhookReceipt.status, ["processed", "ignored", "failed", "conflict"]), lt(schema.telegramWebhookReceipt.receivedAt, cutoff))).limit(batchSize);
    if (receiptIds.length) {
      const deleted = await db.delete(schema.telegramWebhookReceipt).where(inArray(schema.telegramWebhookReceipt.id, receiptIds.map((row) => row.id))).returning({ id: schema.telegramWebhookReceipt.id });
      purged += deleted.length;
    }
    const rejectionIds = await db.select({ id: schema.telegramWebhookRejection.id }).from(schema.telegramWebhookRejection)
      .where(lt(schema.telegramWebhookRejection.receivedAt, cutoff)).limit(batchSize);
    if (rejectionIds.length) {
      const deleted = await db.delete(schema.telegramWebhookRejection).where(inArray(schema.telegramWebhookRejection.id, rejectionIds.map((row) => row.id))).returning({ id: schema.telegramWebhookRejection.id });
      purged += deleted.length;
    }
    const outboxIds = await db.select({ id: schema.telegramOutbox.id }).from(schema.telegramOutbox)
      .where(and(inArray(schema.telegramOutbox.status, ["delivered", "failed", "superseded"]), lt(schema.telegramOutbox.createdAt, cutoff))).limit(batchSize);
    if (outboxIds.length) {
      const deleted = await db.delete(schema.telegramOutbox).where(inArray(schema.telegramOutbox.id, outboxIds.map((row) => row.id))).returning({ id: schema.telegramOutbox.id });
      purged += deleted.length;
    }
    workerGlobal.__telegramReliabilityLastPurgeAt = new Date();
    return purged;
  } finally {
    await connection`select pg_advisory_unlock(hashtext('venta-max:telegram-retention'))`;
    await connection.release();
  }
}

export async function drainTelegramReliabilityWork(): Promise<void> {
  if (workerGlobal.__telegramReliabilityRunning) return workerGlobal.__telegramReliabilityRunning;
  const running = (async () => {
    const connection = await import("@/lib/db").then(({ getSql }) => getSql().reserve());
    const lock = await connection<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('venta-max:telegram-worker')) as locked`;
    if (!lock[0]?.locked) { await connection.release(); return; }
    try {
      await Promise.allSettled([
        drainTelegramReceipts(),
        drainTelegramMenuActions(),
        drainTelegramOutbox(),
        purgeTelegramTerminalRows(),
      ]).then((results) => {
        for (const result of results) if (result.status === "rejected") logError(result.reason);
      });
    } finally {
      await connection`select pg_advisory_unlock(hashtext('venta-max:telegram-worker'))`;
      await connection.release();
    }
  })();
  workerGlobal.__telegramReliabilityRunning = running;
  try {
    await running;
  } finally {
    workerGlobal.__telegramReliabilityRunning = undefined;
  }
}

export async function startTelegramReliabilityWorker(): Promise<void> {
  await drainTelegramReliabilityWork().catch(logError);
  if (workerGlobal.__telegramReliabilityTimer) return;
  const timer = setInterval(() => {
    void drainTelegramReliabilityWork().catch(logError);
  }, 5_000);
  timer.unref();
  workerGlobal.__telegramReliabilityTimer = timer;
  const shutdown = () => {
    if (workerGlobal.__telegramReliabilityTimer) clearInterval(workerGlobal.__telegramReliabilityTimer);
    workerGlobal.__telegramReliabilityTimer = undefined;
    void workerGlobal.__telegramReliabilityRunning?.catch(logError);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function telegramWorkerState() {
  return {
    running: Boolean(workerGlobal.__telegramReliabilityRunning),
    lastError: workerGlobal.__telegramReliabilityLastError ?? null,
    lastPurgeAt: workerGlobal.__telegramReliabilityLastPurgeAt?.toISOString() ?? null,
  };
}
