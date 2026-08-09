import { sql } from "drizzle-orm";
import { getAuthDb, getDb, schema } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";
import { telegramWorkerState } from "@/server/telegram/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const organizations = await getAuthDb()
      .select({ id: schema.organization.id })
      .from(schema.organization);
    const perTenant = await Promise.all(organizations.map(({ id }) =>
      withJobTransaction(id, "health-route", () => getDb().execute<{
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
      `))
    ));
    const metrics = perTenant.flat().reduce(
      (total, row) => ({
        queue_lag_seconds: Math.max(total.queue_lag_seconds, Number(row.queue_lag_seconds)),
        oldest_lease_seconds: Math.max(total.oldest_lease_seconds, Number(row.oldest_lease_seconds)),
        conflicts: total.conflicts + Number(row.conflicts),
        stale_ignores: total.stale_ignores + Number(row.stale_ignores),
        ambiguous_deliveries: total.ambiguous_deliveries + Number(row.ambiguous_deliveries),
      }),
      { queue_lag_seconds: 0, oldest_lease_seconds: 0, conflicts: 0, stale_ignores: 0, ambiguous_deliveries: 0 },
    );
    return Response.json({ ok: true, telegram: { ...metrics, worker: telegramWorkerState() } });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
