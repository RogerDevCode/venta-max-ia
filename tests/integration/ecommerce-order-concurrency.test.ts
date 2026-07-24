import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  ACTIVE_ORDER_STATUSES,
  addProductToCart,
  cancelActiveOrder,
  clearActiveCart,
  confirmarPedido,
  editOrderAsCart,
  listActiveOrders,
  mergeLatestOrderIntoActiveCart,
} from "@/server/ecommerce/service";
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
const lifecycleProductId = newId("product");
const mergeProductId = newId("product");
const mergeLifecycleProductAId = newId("product");
const mergeLifecycleProductBId = newId("product");
const mergeLifecycleProductCId = newId("product");
const conversationIds = Array.from({ length: 8 }, () => newId("conversation"));

describe.sequential("ecommerce cart and stock concurrency", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: organizationId, name: "Ecommerce concurrency test" });
    await db.insert(schema.category).values({ id: categoryId, organizationId, name: "Test" });
    for (const [index, conversationId] of conversationIds.entries()) {
      const contactId = newId("contact");
      await db.insert(schema.contact).values({ id: contactId, organizationId, channel: "test", externalAddress: `ecom-test-${index}`, name: `Test ${index}` });
      await db.insert(schema.conversation).values({ id: conversationId, organizationId, contactId });
    }
    await db.insert(schema.product).values([
      { id: limitProductId, organizationId, categoryId, name: "Agua", description: "1 litro", price: 1000, stock: 5 },
      { id: raceProductId, organizationId, categoryId, name: "Cerveza", description: "500 ml", price: 2000, stock: 5 },
      { id: lifecycleProductId, organizationId, categoryId, name: "Jugo", description: "1 litro", price: 1500, stock: 100 },
      { id: mergeProductId, organizationId, categoryId, name: "Bebida", description: "2 litros", price: 2500, stock: 100 },
      { id: mergeLifecycleProductAId, organizationId, categoryId, name: "Producto A", description: "Caja", price: 2500, stock: 100 },
      { id: mergeLifecycleProductBId, organizationId, categoryId, name: "Producto B", description: "Bolsa", price: 1200, stock: 100 },
      { id: mergeLifecycleProductCId, organizationId, categoryId, name: "Producto C", description: "Unidad", price: 800, stock: 100 },
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

  it("limita a tres pedidos activos y edita o cancela exactamente una vez", async () => {
    const conversationId = conversationIds[5]!;
    for (let index = 0; index < 3; index += 1) {
      await expect(addProductToCart({ organizationId, conversationId, productId: lifecycleProductId, quantity: 1 }))
        .resolves.toMatchObject({ ok: true });
      await expect(confirmarPedido({ organizationId, conversationId })).resolves.toMatchObject({ ok: true });
    }
    await addProductToCart({ organizationId, conversationId, productId: lifecycleProductId, quantity: 1 });
    await expect(confirmarPedido({ organizationId, conversationId }))
      .resolves.toMatchObject({ ok: false, error: "active_order_limit", limit: 3 });

    const conversation = await db.select({ contactId: schema.conversation.contactId }).from(schema.conversation)
      .where(and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, conversationId))).limit(1);
    const activeOrders = await db.select().from(schema.order).where(and(
      eq(schema.order.organizationId, organizationId),
      eq(schema.order.contactId, conversation[0]!.contactId),
      inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
    ));
    expect(activeOrders).toHaveLength(3);

    await clearActiveCart({ organizationId, conversationId });
    const editResults = await Promise.all([
      editOrderAsCart({ organizationId, conversationId, orderId: activeOrders[0]!.id }),
      editOrderAsCart({ organizationId, conversationId, orderId: activeOrders[0]!.id }),
    ]);
    expect(editResults.filter((result) => result.ok)).toHaveLength(1);
    const reopened = await db.select().from(schema.cart).where(and(
      eq(schema.cart.organizationId, organizationId),
      eq(schema.cart.conversationId, conversationId),
      eq(schema.cart.status, "active")
    ));
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.reopenedFromOrderId).toBe(activeOrders[0]!.id);

    const cancelResults = await Promise.all([
      cancelActiveOrder({ organizationId, conversationId, orderId: activeOrders[1]!.id }),
      cancelActiveOrder({ organizationId, conversationId, orderId: activeOrders[1]!.id }),
    ]);
    expect(cancelResults.filter((result) => result.ok)).toHaveLength(1);
    const product = await db.select({ stock: schema.product.stock }).from(schema.product)
      .where(and(eq(schema.product.organizationId, organizationId), eq(schema.product.id, lifecycleProductId))).limit(1);
    expect(product[0]?.stock).toBe(99);
  });

  it("autoriza el cuarto intento consolidando repetidos una sola vez", async () => {
    const conversationId = conversationIds[6]!;
    await saveCommerceSettings(organizationId, { maxUnitsPerProduct: 3 });
    for (let index = 0; index < 3; index += 1) {
      await addProductToCart({ organizationId, conversationId, productId: mergeProductId, quantity: 1 });
      await expect(confirmarPedido({ organizationId, conversationId })).resolves.toMatchObject({ ok: true });
    }
    await addProductToCart({ organizationId, conversationId, productId: mergeProductId, quantity: 3 });
    const limited = await confirmarPedido({ organizationId, conversationId });
    expect(limited).toMatchObject({ ok: false, error: "active_order_limit", limit: 3 });
    if (limited.ok || limited.error !== "active_order_limit") throw new Error("Expected active order limit");

    const activeBefore = await db.select().from(schema.order).where(and(
      eq(schema.order.organizationId, organizationId),
      eq(schema.order.contactId, limited.candidateOrder.contactId),
      inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
    ));
    const oldest = activeBefore.find((order) => order.id !== limited.candidateOrder.id)!;
    await expect(mergeLatestOrderIntoActiveCart({
      organizationId, conversationId, candidateOrderId: oldest.id,
    })).resolves.toEqual({ ok: false, error: "merge_candidate_changed" });
    await expect(mergeLatestOrderIntoActiveCart({
      organizationId, conversationId, candidateOrderId: limited.candidateOrder.id,
    })).resolves.toMatchObject({ ok: false, error: "merge_limit_exceeded", requested: 4, limit: 3 });

    await clearActiveCart({ organizationId, conversationId });
    await addProductToCart({ organizationId, conversationId, productId: mergeProductId, quantity: 2 });
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      mergeLatestOrderIntoActiveCart({ organizationId, conversationId, candidateOrderId: limited.candidateOrder.id })
    ));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const carts = await db.select().from(schema.cart).where(and(
      eq(schema.cart.organizationId, organizationId),
      eq(schema.cart.conversationId, conversationId),
      eq(schema.cart.status, "active")
    ));
    expect(carts).toHaveLength(1);
    expect(carts[0]?.items).toEqual([
      expect.objectContaining({ productId: mergeProductId, quantity: 3, unitPrice: 2500 }),
    ]);
    const product = await db.select({ stock: schema.product.stock }).from(schema.product)
      .where(and(eq(schema.product.organizationId, organizationId), eq(schema.product.id, mergeProductId))).limit(1);
    expect(product[0]?.stock).toBe(98);
  });

  it("une íntegramente el tercer y cuarto pedido y confirma el resultado como tercer pedido activo", async () => {
    const conversationId = conversationIds[7]!;
    await saveCommerceSettings(organizationId, { maxUnitsPerProduct: 10 });
    const contact = await db.select({ contactId: schema.conversation.contactId }).from(schema.conversation)
      .where(and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, conversationId))).limit(1);

    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductAId, quantity: 1 });
    const first = await confirmarPedido({ organizationId, conversationId });
    expect(first).toMatchObject({ ok: true });

    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductBId, quantity: 1 });
    const second = await confirmarPedido({ organizationId, conversationId });
    expect(second).toMatchObject({ ok: true });

    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductAId, quantity: 2 });
    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductBId, quantity: 2 });
    const third = await confirmarPedido({ organizationId, conversationId });
    expect(third).toMatchObject({ ok: true });
    if (!third.ok) throw new Error("Expected third order");
    await db.update(schema.order).set({ createdAt: new Date(Date.now() + 1_000) })
      .where(and(eq(schema.order.organizationId, organizationId), eq(schema.order.id, third.order.id)));

    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductAId, quantity: 3 });
    await addProductToCart({ organizationId, conversationId, productId: mergeLifecycleProductCId, quantity: 2 });
    const fourthAttempt = await confirmarPedido({ organizationId, conversationId });
    expect(fourthAttempt).toMatchObject({
      ok: false,
      error: "active_order_limit",
      limit: 3,
      candidateOrder: { id: third.order.id },
    });
    if (fourthAttempt.ok || fourthAttempt.error !== "active_order_limit") {
      throw new Error("Expected fourth-order authorization");
    }

    const merged = await mergeLatestOrderIntoActiveCart({
      organizationId,
      conversationId,
      candidateOrderId: fourthAttempt.candidateOrder.id,
    });
    expect(merged).toMatchObject({
      ok: true,
      order: { id: third.order.id, status: "cancelled" },
      cart: {
        reopenedFromOrderId: third.order.id,
        status: "active",
        items: expect.arrayContaining([
          expect.objectContaining({ productId: mergeLifecycleProductAId, quantity: 5, unitPrice: 2500 }),
          expect.objectContaining({ productId: mergeLifecycleProductBId, quantity: 2, unitPrice: 1200 }),
          expect.objectContaining({ productId: mergeLifecycleProductCId, quantity: 2, unitPrice: 800 }),
        ]),
      },
    });

    const activeAfterMerge = await listActiveOrders({ organizationId, contactId: contact[0]!.contactId });
    expect(activeAfterMerge).toHaveLength(2);

    const combined = await confirmarPedido({ organizationId, conversationId });
    expect(combined).toMatchObject({
      ok: true,
      order: {
        totalAmount: 16_500,
        status: "confirmed",
        items: expect.arrayContaining([
          expect.objectContaining({ productId: mergeLifecycleProductAId, quantity: 5, unitPrice: 2500 }),
          expect.objectContaining({ productId: mergeLifecycleProductBId, quantity: 2, unitPrice: 1200 }),
          expect.objectContaining({ productId: mergeLifecycleProductCId, quantity: 2, unitPrice: 800 }),
        ]),
      },
    });

    const activeFinal = await listActiveOrders({ organizationId, contactId: contact[0]!.contactId });
    expect(activeFinal).toHaveLength(3);
    expect(activeFinal.some((order) => order.id === third.order.id)).toBe(false);
    if (!combined.ok) throw new Error("Expected combined order");
    expect(activeFinal.some((order) => order.id === combined.order.id)).toBe(true);

    const carts = await db.select().from(schema.cart).where(and(
      eq(schema.cart.organizationId, organizationId),
      eq(schema.cart.conversationId, conversationId)
    ));
    expect(carts.filter((cart) => cart.status === "active")).toHaveLength(0);
    expect(carts.filter((cart) => cart.status === "converted")).toHaveLength(4);

    const stocks = await db.select({ id: schema.product.id, stock: schema.product.stock }).from(schema.product)
      .where(and(
        eq(schema.product.organizationId, organizationId),
        inArray(schema.product.id, [mergeLifecycleProductAId, mergeLifecycleProductBId, mergeLifecycleProductCId])
      ));
    expect(Object.fromEntries(stocks.map((product) => [product.id, product.stock]))).toEqual({
      [mergeLifecycleProductAId]: 94,
      [mergeLifecycleProductBId]: 97,
      [mergeLifecycleProductCId]: 98,
    });
  });
});
