import { describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, index).trim()] ??= line.slice(index + 1).trim();
}

describe("Telegram reliability schema", () => {
  it("has durable queues, FSM revision, semantic constraints and org-first indexes", async () => {
    const sql = getSql();
    const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }[]>`
      select table_name,column_name,is_nullable from information_schema.columns
      where table_schema='public' and table_name in ('telegram_webhook_receipt','telegram_outbox','conversation')
    `;
    const names = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
    expect(names.has("telegram_webhook_receipt.payload")).toBe(true);
    expect(names.has("telegram_webhook_receipt.lease_expires_at")).toBe(true);
    expect(names.has("telegram_outbox.idempotency_key")).toBe(true);
    expect(names.has("conversation.fsm_revision")).toBe(true);
    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname,indexdef from pg_indexes where schemaname='public'
    `;
    const receipt = indexes.find((row) => row.indexname === "telegram_receipt_integration_update_uq");
    expect(receipt?.indexdef).toContain("organization_id, integration_id, update_id");
    expect(receipt?.indexdef).toContain("UNIQUE");
    const cart = indexes.find((row) => row.indexname === "cart_org_conv_active_uq");
    expect(cart?.indexdef).toContain("WHERE (status = 'active'::text)");
  });
});
