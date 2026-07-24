import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function allocateOrderNumber(tx: Transaction, organizationId: string): Promise<string> {
  const rows = await tx.insert(schema.commerceOrderCounter).values({
    organizationId,
    nextValue: 2n,
  }).onConflictDoUpdate({
    target: schema.commerceOrderCounter.organizationId,
    set: {
      nextValue: sql`${schema.commerceOrderCounter.nextValue} + 1`,
      updatedAt: new Date(),
    },
  }).returning({ nextValue: schema.commerceOrderCounter.nextValue });
  const allocated = (rows[0]?.nextValue ?? 2n) - 1n;
  return `ORD-${allocated.toString().padStart(6, "0")}`;
}
