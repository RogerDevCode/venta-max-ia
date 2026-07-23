import { and, eq, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { ingestInboundMessage } from "@/server/inbox/ingest";

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 5;
const globalRunner = globalThis as unknown as { __telegramMenuActionLocks?: Set<string> };
const locks = globalRunner.__telegramMenuActionLocks ??= new Set<string>();

export async function runTelegramMenuAction(input: {
  organizationId: string;
  actionId: string;
  profileName?: string;
  timestamp?: string;
}): Promise<boolean> {
  const db = getDb();
  const queued = await db.select({ conversationId: schema.telegramMenuAction.conversationId })
    .from(schema.telegramMenuAction)
    .where(scoped(schema.telegramMenuAction.organizationId, input.organizationId, eq(schema.telegramMenuAction.id, input.actionId)))
    .limit(1);
  if (!queued[0]) return false;
  const lockKey = `${input.organizationId}:${queued[0].conversationId}`;
  if (locks.has(lockKey)) return false;
  locks.add(lockKey);
  let attempts = 0;
  try {
    const now = new Date();
    const claimed = await db.update(schema.telegramMenuAction).set({
      status: "processing", attempts: sqlIncrement(schema.telegramMenuAction.attempts), leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    }).where(scoped(schema.telegramMenuAction.organizationId, input.organizationId,
      and(eq(schema.telegramMenuAction.id, input.actionId), or(
        and(eq(schema.telegramMenuAction.status, "pending"), lte(schema.telegramMenuAction.availableAt, now)),
        and(eq(schema.telegramMenuAction.status, "processing"), lte(schema.telegramMenuAction.leaseExpiresAt, now))
      )))).returning();
    const action = claimed[0];
    if (!action) return false;
    attempts = action.attempts;
    const menus = await db.select({ chatId: schema.telegramMenuInstance.chatId })
      .from(schema.telegramMenuInstance)
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId, eq(schema.telegramMenuInstance.id, action.menuInstanceId)))
      .limit(1);
    const menu = menus[0];
    if (!menu) throw new Error("Telegram menu instance missing for accepted action");
    await ingestInboundMessage({
      organizationId: input.organizationId,
      from: menu.chatId,
      profileName: input.profileName || `Telegram ${menu.chatId}`,
      waMessageId: `tg_cb_${action.callbackQueryId}`,
      type: "interactive",
      text: action.action,
      timestamp: input.timestamp || String(Math.floor(Date.now() / 1000)),
    });
    await db.update(schema.telegramMenuAction).set({ status: "processed", processedAt: new Date(), leaseExpiresAt: null, lastError: null })
      .where(scoped(schema.telegramMenuAction.organizationId, input.organizationId, eq(schema.telegramMenuAction.id, action.id)));
    return true;
  } catch (error) {
    const terminal = attempts >= MAX_ATTEMPTS;
    await db.update(schema.telegramMenuAction).set({
      status: terminal ? "failed" : "pending",
      availableAt: new Date(Date.now() + retryDelayMs(attempts)), leaseExpiresAt: null,
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown menu action error",
    }).where(scoped(schema.telegramMenuAction.organizationId, input.organizationId, eq(schema.telegramMenuAction.id, input.actionId)));
    throw error;
  } finally {
    locks.delete(lockKey);
  }
}

export function retryDelayMs(attempts: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

export async function drainTelegramMenuActions(): Promise<void> {
  const db = getDb();
  const organizations = await db.select({ id: schema.organization.id }).from(schema.organization).limit(50);
  const now = new Date();
  const batches = await Promise.all(organizations.map(async ({ id: organizationId }) => {
    const rows = await db.select({ id: schema.telegramMenuAction.id })
      .from(schema.telegramMenuAction)
      .where(scoped(schema.telegramMenuAction.organizationId, organizationId, or(
        and(eq(schema.telegramMenuAction.status, "pending"), lte(schema.telegramMenuAction.availableAt, now)),
        and(eq(schema.telegramMenuAction.status, "processing"), lte(schema.telegramMenuAction.leaseExpiresAt, now))
      )))
      .limit(20);
    return rows.map((row) => ({ organizationId, actionId: row.id }));
  }));
  await Promise.allSettled(batches.flat().map(runTelegramMenuAction));
}

function sqlIncrement(column: typeof schema.telegramMenuAction.attempts) {
  return sql`${column} + 1`;
}
