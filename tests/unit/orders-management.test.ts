import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim();
}

const db = getDb();
const orgId = newId("organization");
const contactId = newId("contact");
const orderId = newId("order");

describe("Orders queue & status management API integration", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: orgId, name: "Order Mgmt Org" });
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId: orgId,
      channel: "telegram",
      externalAddress: "880099990001",
      name: "Order Customer",
    });
    await db.insert(schema.order).values({
      id: orderId,
      organizationId: orgId,
      contactId,
      orderNumber: "ORD-999001",
      items: [{ productId: "prod1", quantity: 3, unitPrice: 2500, name: "Empanada", presentation: "Unidad" }],
      totalAmount: 7500,
      isPaid: false,
      status: "pending",
    });
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
  });

  it("stores and queries order queue with shipping statuses (pending_shipment, shipped, delivered)", async () => {
    // 1. Initial status is pending and isPaid false
    const initialRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(initialRows[0]?.status).toBe("pending");
    expect(initialRows[0]?.isPaid).toBe(false);

    // 2. Update isPaid to true
    await db.update(schema.order).set({ isPaid: true }).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    const paidRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(paidRows[0]?.isPaid).toBe(true);

    // 3. Transition to processing
    await db.update(schema.order).set({ status: "processing" }).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    const procRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(procRows[0]?.status).toBe("processing");

    // 4. Transition to pending_shipment
    await db.update(schema.order).set({ status: "pending_shipment" }).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    const pendingShipRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(pendingShipRows[0]?.status).toBe("pending_shipment");

    // 5. Transition to shipped
    await db.update(schema.order).set({ status: "shipped" }).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    const shippedRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(shippedRows[0]?.status).toBe("shipped");

    // 6. Transition to delivered
    await db.update(schema.order).set({ status: "delivered" }).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    const deliveredRows = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, orderId)));
    expect(deliveredRows[0]?.status).toBe("delivered");
  });
});
