import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { addProductToCart, confirmarPedido } from "@/server/ecommerce/service";
import { saveCommerceSettings } from "@/server/ecommerce/settings";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const db = getDb();
const organizationId = newId("organization");
const categoryId = newId("category");
const limitProductId = newId("product");
const raceProductId = newId("product");
const conversationIds = Array.from({ length: 5 }, () => newId("conversation"));

describe.sequential("ecommerce cart and stock concurrency", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: organizationId, name: "Ecommerce concurrency test" });
    await db.insert(schema.category).values({ id: categoryId, organizationId, name: "Test" });
    for (const [index, conversationId] of conversationIds.entries()) {
      const contactId = newId("contact");
      await db.insert(schema.contact).values({ id: contactId, organizationId, phone: `ecom-test-${index}`, name: `Test ${index}` });
      await db.insert(schema.conversation).values({ id: conversationId, organizationId, contactId });
    }
    await db.insert(schema.product).values([
      { id: limitProductId, organizationId, categoryId, name: "Agua", description: "1 litro", price: 1000, stock: 5 },
      { id: raceProductId, organizationId, categoryId, name: "Cerveza", description: "500 ml", price: 2000, stock: 5 },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  });

  it("enforces tenant total while active carts do not reserve stock", async () => {
    await saveCommerceSettings(organizationId, { maxUnitsPerProduct: 3 });
    await expect(addProductToCart({
      organizationId, conversationId: conversationIds[0]!, productId: limitProductId, quantity: 4,
    })).resolves.toMatchObject({ ok: false, error: "tenant_limit_exceeded", limit: 3 });
    await expect(addProductToCart({
      organizationId, conversationId: conversationIds[0]!, productId: limitProductId, quantity: 2,
    })).resolves.toMatchObject({ ok: true, units: 2 });
    await expect(addProductToCart({
      organizationId, conversationId: conversationIds[0]!, productId: limitProductId, quantity: 2,
    })).resolves.toMatchObject({ ok: false, error: "tenant_limit_exceeded", limit: 3 });
    await expect(addProductToCart({
      organizationId, conversationId: conversationIds[1]!, productId: limitProductId, quantity: 3,
    })).resolves.toMatchObject({ ok: true, units: 3 });
    const product = await db.select({ stock: schema.product.stock }).from(schema.product)
      .where(and(eq(schema.product.organizationId, organizationId), eq(schema.product.id, limitProductId))).limit(1);
    expect(product[0]?.stock).toBe(5);
  });

  it("allows exactly one competing order and never oversells", async () => {
    await saveCommerceSettings(organizationId, { maxUnitsPerProduct: 10 });
    await addProductToCart({ organizationId, conversationId: conversationIds[2]!, productId: raceProductId, quantity: 4 });
    await addProductToCart({ organizationId, conversationId: conversationIds[3]!, productId: raceProductId, quantity: 4 });
    const results = await Promise.all([
      confirmarPedido({ organizationId, conversationId: conversationIds[2]! }),
      confirmarPedido({ organizationId, conversationId: conversationIds[3]! }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error === "stock_changed")).toHaveLength(1);
    const product = await db.select({ stock: schema.product.stock }).from(schema.product)
      .where(and(eq(schema.product.organizationId, organizationId), eq(schema.product.id, raceProductId))).limit(1);
    expect(product[0]?.stock).toBe(1);
    const orders = await db.select({ id: schema.order.id }).from(schema.order)
      .where(and(eq(schema.order.organizationId, organizationId), eq(schema.order.status, "confirmed")));
    expect(orders).toHaveLength(1);
  });

  it("rejects a tampered negative cart without increasing stock", async () => {
    await db.insert(schema.cart).values({
      id: newId("cart"), organizationId, conversationId: conversationIds[4]!, status: "active",
      items: [{ productId: raceProductId, name: "Cerveza", presentation: "500 ml", quantity: -5, unitPrice: 1 }],
    });
    await expect(confirmarPedido({ organizationId, conversationId: conversationIds[4]! }))
      .resolves.toEqual({ ok: false, error: "invalid_cart" });
    const product = await db.select({ stock: schema.product.stock }).from(schema.product)
      .where(and(eq(schema.product.organizationId, organizationId), eq(schema.product.id, raceProductId))).limit(1);
    expect(product[0]?.stock).toBe(1);
  });
});
