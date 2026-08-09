import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { addProductToCart, confirmarPedido, processAutoExpiredOrders } from "@/server/ecommerce/service";
import { getCommerceSettings, saveCommerceSettings } from "@/server/ecommerce/settings";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim();
}

const db = getDb();
const organizationId = newId("organization");
const categoryId = newId("category");
const productId = newId("product");
const contactId = newId("contact");
const conversationId = newId("conversation");

describe("ecommerce order auto-expiration feature", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: organizationId, name: "Expiration Test Org" });
    await db.insert(schema.category).values({ id: categoryId, organizationId, name: "Vinos" });
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      channel: "telegram",
      externalAddress: "123456789",
      name: "Juan Pérez",
    });
    await db.insert(schema.conversation).values({ id: conversationId, organizationId, contactId });
    await db.insert(schema.product).values({
      id: productId,
      organizationId,
      categoryId,
      name: "Vino Reserva",
      description: "750 ml",
      price: 5000,
      stock: 10,
    });
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  });

  it("defaults to 36 hours for auto-expiration and allows updating settings", async () => {
    const settings = await getCommerceSettings(organizationId);
    expect(settings.autoExpirationHours).toBe(36);

    const updated = await saveCommerceSettings(organizationId, { autoExpirationHours: 48 });
    expect(updated.autoExpirationHours).toBe(48);

    // Reset back to 36
    await saveCommerceSettings(organizationId, { autoExpirationHours: 36 });
  });

  it("auto-expires orders older than configured hours, returns stock, marks reason and enqueues Telegram message", async () => {
    // 1. Create order
    await addProductToCart({ organizationId, conversationId, productId, quantity: 3 });
    const orderResult = await confirmarPedido({ organizationId, conversationId });
    expect(orderResult.ok).toBe(true);
    if (!orderResult.ok) return;

    const orderId = orderResult.order.id;

    // Verify initial stock was deducted (10 - 3 = 7)
    const productBefore = await db.select().from(schema.product).where(eq(schema.product.id, productId)).limit(1);
    expect(productBefore[0]?.stock).toBe(7);

    // 2. Simulate aging the order to 37 hours ago (> 36 hours threshold)
    const thirtySevenHoursAgo = new Date(Date.now() - 37 * 60 * 60 * 1000);
    await db.update(schema.order)
      .set({ createdAt: thirtySevenHoursAgo })
      .where(and(eq(schema.order.organizationId, organizationId), eq(schema.order.id, orderId)));

    // 3. Process auto expiration
    const cancelledIds = await processAutoExpiredOrders(organizationId);
    expect(cancelledIds).toContain(orderId);

    // 4. Verify order in DB
    const updatedOrder = await db.select().from(schema.order).where(eq(schema.order.id, orderId)).limit(1);
    expect(updatedOrder[0]?.status).toBe("cancelled");
    expect(updatedOrder[0]?.cancellationReason).toBe("auto_expiration");

    // 5. Verify stock was restored back to 10
    const productAfter = await db.select().from(schema.product).where(eq(schema.product.id, productId)).limit(1);
    expect(productAfter[0]?.stock).toBe(10);

    // 6. Verify polite Telegram message was enqueued in outbox
    const outboxRows = await db.select().from(schema.telegramOutbox).where(and(
      eq(schema.telegramOutbox.organizationId, organizationId),
      eq(schema.telegramOutbox.idempotencyKey, `auto-expire-${orderId}`)
    ));
    expect(outboxRows.length).toBe(1);
    const outboxMessage = outboxRows[0];
    expect(outboxMessage).toBeDefined();
    expect(outboxMessage?.payload).toMatchObject({
      method: "sendMessage",
      text: expect.stringContaining("Te pedimos disculpas"),
    });
    expect(outboxMessage?.payload).toMatchObject({
      text: expect.stringContaining("cancelado automáticamente al haber transcurrido 36 horas"),
    });
  });
});
