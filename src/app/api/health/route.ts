import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { telegramWorkerState } from "@/server/telegram/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const rows = await db.execute<{
      queue_lag_seconds: number;
      oldest_lease_seconds: number;
      conflicts: number;
      stale_ignores: number;
      ambiguous_deliveries: number;
    }>(sql`
      select
        coalesce(extract(epoch from clock_timestamp() - min(available_at) filter
          (where status in ('received','retryable_failed'))), 0)::int as queue_lag_seconds,
        coalesce(extract(epoch from clock_timestamp() - min(lease_expires_at) filter
          (where status = 'processing' and lease_expires_at < clock_timestamp())), 0)::int as oldest_lease_seconds,
        count(*) filter (where status = 'conflict')::int as conflicts,
        count(*) filter (where status = 'ignored' and ignored_reason = 'stale_revision')::int as stale_ignores,
        (select count(*)::int from telegram_outbox where status = 'delivery_unknown') as ambiguous_deliveries
      from telegram_webhook_receipt
    `);
    return Response.json({ ok: true, telegram: { ...(rows[0] ?? {}), worker: telegramWorkerState() } });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
