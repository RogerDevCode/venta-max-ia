import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { readFileSync } from "node:fs";
import { claimTelegramReceipt } from "@/server/telegram/receipt-queue";
import { registerTelegramWebhookReceipt } from "@/server/telegram/integrations";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, index).trim()] ??= line.slice(index + 1).trim();
}

const db = getDb();
const organizationId = newId("organization");
const organizationBId = newId("organization");
const integrationA = newId("telegramIntegration");
const integrationB = newId("telegramIntegration");

describe.sequential("durable Telegram receipt recovery", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values([
      { id: organizationId, name: "Receipt recovery" },
      { id: organizationBId, name: "Receipt recovery B" },
    ]);
    await db.insert(schema.telegramIntegration).values([
      { id: integrationA, organizationId, webhookTokenHash: `hash-${integrationA}` },
      { id: integrationB, organizationId: organizationBId, webhookTokenHash: `hash-${integrationB}` },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationBId));
  });

  it("accepts the same update id on replacement integrations", async () => {
    const base = { updateId: 7, payloadHash: "same", payload: { update_id: 7 } };
    await expect(registerTelegramWebhookReceipt({ ...base, organizationId, integrationId: integrationA })).resolves.toBe("received");
    await expect(registerTelegramWebhookReceipt({ ...base, organizationId: organizationBId, integrationId: integrationB })).resolves.toBe("received");
  });

  it("reclaims a processing receipt after its lease expires", async () => {
    const receipt = await db.select().from(schema.telegramWebhookReceipt).where(and(
      eq(schema.telegramWebhookReceipt.organizationId, organizationId),
      eq(schema.telegramWebhookReceipt.integrationId, integrationA),
    )).limit(1);
    await db.update(schema.telegramWebhookReceipt).set({ status: "processing", attempts: 1, leaseExpiresAt: new Date(0) })
      .where(eq(schema.telegramWebhookReceipt.id, receipt[0]!.id));
    const claimed = await claimTelegramReceipt(organizationId, receipt[0]!.id);
    expect(claimed).toMatchObject({ status: "processing", attempts: 2 });
  });
});
