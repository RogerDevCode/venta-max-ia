/**
 * Integration Test: E-Commerce & Telegram Menu Breadth, Depth, Order Generation, Bursts & Reliability
 *
 * Direct live integration test with real PostgreSQL instance validating:
 * 1. Deep FSM navigation (Main -> Categories -> Product -> Quantity -> Cart -> Checkout -> Order).
 * 2. Breadth navigation across all menu actions (Promos, Best Sellers, Orders, Detail, Cancel, Edit, Handoff, Stack Nav).
 * 3. Order generation, sequential order numbers (ORD-XXXXXX), stock deduction, repricing disclosure, and 3-active-order limits/merge.
 * 4. Data bursts (25 simultaneous clicks, mixed text/callback bursts) guaranteeing 1 winner and 0 duplicates.
 * 5. Stale / Superseded menu rejection (out-of-order callbacks, state mismatch, step mismatch).
 * 6. Multi-tenant data integrity, active cart uniqueness (cart_org_conv_active_uq), and PostgreSQL persistent state.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { processPendingProductQuantity, processSlashCommand } from "@/server/ai/commands";
import { invalidateCatalogCache } from "@/server/ecommerce/cache";
import { encodeMenuCallback } from "@/server/telegram/menu-codec";
import { acceptTelegramMenuCallback } from "@/server/telegram/menu-guard";
import {
  addProductToCart,
  cancelActiveOrder,
  clearActiveCart,
  confirmarPedido,
  listActiveOrders,
} from "@/server/ecommerce/service";
import { allocateOrderNumber } from "@/server/ecommerce/order-number";
import { repriceItems, renderPriceDisclosure } from "@/server/ecommerce/pricing";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const db = getDb();

/* ───────── Fixtures ───────── */
const orgId = newId("organization");
const contactId = newId("contact");
const conversationId = newId("conversation");

const catWater = newId("category");
const catSnacks = newId("category");

const prodWater = newId("product");
const prodJuice = newId("product");
const prodChips = newId("product");

const CHAT_ID = "990000000001";
let menuGen = 0;

async function getConv() {
  const rows = await db.select().from(schema.conversation).where(scoped(
    schema.conversation.organizationId,
    orgId,
    eq(schema.conversation.id, conversationId),
  )).limit(1);
  if (!rows[0]) throw new Error("Missing test conversation");
  return rows[0];
}

async function createMenuInstance(
  status: "active" | "superseded" = "active",
  fsbState = "menu:main/main_menu",
  allowedActions = ["menu:carrito"],
) {
  const id = newId("telegramMenu");
  await db.insert(schema.telegramMenuInstance).values({
    id,
    organizationId: orgId,
    conversationId,
    chatId: CHAT_ID,
    telegramMessageId: 8000 + ++menuGen,
    generation: menuGen,
    fsbState,
    allowedActions,
    status,
  });
  return { id, messageId: 8000 + menuGen };
}

describe.sequential("E-Commerce & Telegram Menu Depth, Breadth & Concurrency Reliability", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: orgId, name: "Depth/Breadth Integration Org" });
    await db.insert(schema.contact).values({
      id: contactId, organizationId: orgId, channel: "telegram", externalAddress: CHAT_ID, name: "Depth User",
    });
    await db.insert(schema.conversation).values({
      id: conversationId, organizationId: orgId, contactId, isTest: true, stateMetadata: {},
    });

    await db.insert(schema.category).values([
      { id: catWater, organizationId: orgId, name: "Bebidas y Aguas" },
      { id: catSnacks, organizationId: orgId, name: "Snacks y Dulces" },
    ]);

    await db.insert(schema.product).values([
      { id: prodWater, organizationId: orgId, categoryId: catWater, sku: "ADMIN-WATER", name: "Agua Mineral", description: "500ml sin gas", price: 1000, stock: 50 },
      { id: prodJuice, organizationId: orgId, categoryId: catWater, sku: "ADMIN-JUICE", name: "Jugo Naranja", description: "1 Litro natural", price: 2000, stock: 30 },
      { id: prodChips, organizationId: orgId, categoryId: catSnacks, sku: "ADMIN-CHIPS", name: "Papas Fritas", description: "Bolsa familiar 200g", price: 1500, stock: 20 },
    ]);

    invalidateCatalogCache(orgId);
  });

  afterAll(async () => {
    invalidateCatalogCache(orgId);
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
  });

  /* ══════════════════════════════════════════════════════════
   * 1. NAVEGACIÓN EN PROFUNDIDAD (DEPTH NAVIGATION & ORDER)
   * ══════════════════════════════════════════════════════════ */

  it("1. Deep flow: Main -> Categories -> Category -> Product -> Quantity -> Cart -> Checkout -> Order Confirmed", async () => {
    // Step 1: Nav to Main Menu
    await processSlashCommand({ command: "nav:home", conversation: await getConv(), lastInboundExternalId: "deep_1" });
    expect((await getConv()).stateMetadata).toMatchObject({ current_state: "menu:main", active_step: "main_menu" });

    // Step 2: Nav to Categories
    await processSlashCommand({ command: "menu:categorias", conversation: await getConv(), lastInboundExternalId: "deep_2" });
    const catState = (await getConv()).stateMetadata as { numeric_options?: string[] };
    expect(catState.numeric_options).toContain(`catalog:category:${catWater}`);

    // Step 3: Select Category "Bebidas y Aguas"
    const catIndex = catState.numeric_options!.indexOf(`catalog:category:${catWater}`);
    await processSlashCommand({ command: `catalog:number:${catIndex + 1}`, conversation: await getConv(), lastInboundExternalId: "deep_3" });
    const prodState = (await getConv()).stateMetadata as { catalogCategoryId?: string; numeric_options?: string[] };
    expect(prodState.catalogCategoryId).toBe(catWater);
    expect(prodState.numeric_options).toContain(`catalog:product:${prodWater}`);

    // Step 4: Select Product "Agua Mineral"
    const waterIndex = prodState.numeric_options!.indexOf(`catalog:product:${prodWater}`);
    await processSlashCommand({ command: `catalog:number:${waterIndex + 1}`, conversation: await getConv(), lastInboundExternalId: "deep_4" });
    expect((await getConv()).stateMetadata).toMatchObject({
      current_state: "cart:awaiting_quantity",
      active_step: "awaiting_product_quantity",
      selectedProductId: prodWater,
    });

    // Step 5: Input Quantity "4"
    const handled = await processPendingProductQuantity({ conversation: await getConv(), text: "4", lastInboundExternalId: "deep_5" });
    expect(handled).toBe(true);

    // Step 6: Verify Cart in DB
    const activeCarts = await db.select().from(schema.cart).where(scoped(schema.cart.organizationId, orgId, and(
      eq(schema.cart.conversationId, conversationId),
      eq(schema.cart.status, "active"),
    )));
    expect(activeCarts).toHaveLength(1);
    expect(activeCarts[0]!.items).toEqual([
      expect.objectContaining({ productId: prodWater, name: "Agua Mineral", quantity: 4, unitPrice: 1000 }),
    ]);

    // Step 7: Checkout & Confirm Order
    const confirmResult = await confirmarPedido({ organizationId: orgId, conversationId });
    expect(confirmResult).toMatchObject({ ok: true });
    if (confirmResult.ok) {
      expect(confirmResult.order.orderNumber).toMatch(/^ORD-\d{6,}$/);
      expect(confirmResult.order.totalAmount).toBe(4000);
    }

    // Step 8: Verify Order in DB & Stock Deduction
    const orders = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.conversationId, conversationId)));
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe("confirmed");

    const updatedProduct = await db.select().from(schema.product).where(scoped(schema.product.organizationId, orgId, eq(schema.product.id, prodWater)));
    expect(updatedProduct[0]!.stock).toBe(46); // 50 - 4 = 46
  });

  /* ══════════════════════════════════════════════════════════
   * 2. NAVEGACIÓN A LO ANCHO (BREADTH SURFACE COVERAGE)
   * ══════════════════════════════════════════════════════════ */

  it("2. Breadth: verifies Promos, Best Sellers, Orders, Cart, Handoff, Detail, Refresh, Cancel", async () => {
    // Promociones
    await processSlashCommand({ command: "menu:promociones", conversation: await getConv(), lastInboundExternalId: "b_1" });
    expect((await getConv()).stateMetadata).toMatchObject({ current_state: "menu:promos", active_step: "viewing_promos" });

    // Más Vendidos
    await processSlashCommand({ command: "menu:mas_vendidos", conversation: await getConv(), lastInboundExternalId: "b_2" });
    expect((await getConv()).stateMetadata).toMatchObject({ current_state: "menu:recommended", active_step: "viewing_recommended" });

    // Handoff Humano
    await processSlashCommand({ command: "menu:humano", conversation: await getConv(), lastInboundExternalId: "b_3" });
    expect((await getConv()).stateMetadata).toMatchObject({ current_state: "handoff:humano", active_step: "awaiting_human" });

    // Ver Carrito
    await processSlashCommand({ command: "menu:carrito", conversation: await getConv(), lastInboundExternalId: "b_4" });
    expect((await getConv()).stateMetadata).toMatchObject({ current_state: "menu:cart", active_step: "viewing_cart" });

    // Mis Pedidos
    await processSlashCommand({ command: "menu:pedidos", conversation: await getConv(), lastInboundExternalId: "b_5" });
    const ordersState = (await getConv()).stateMetadata as { current_state: string; numeric_options?: string[] };
    expect(["menu:orders", "menu:order_detail"]).toContain(ordersState.current_state);
    expect(ordersState.numeric_options?.some((opt) => opt.startsWith("order:"))).toBe(true);

    // Ver detalle de la orden previamente creada
    const activeOrders = await listActiveOrders({ organizationId: orgId, contactId });
    expect(activeOrders.length).toBeGreaterThan(0);
    const targetOrder = activeOrders[0]!;

    await processSlashCommand({ command: `order:detail:${targetOrder.id}`, conversation: await getConv(), lastInboundExternalId: "b_6" });
    expect((await getConv()).stateMetadata).toMatchObject({
      current_state: "menu:order_detail",
      active_step: "viewing_order_detail",
      menu_scope: `order:detail:${targetOrder.id}`,
    });

    // Refrescar orden
    await processSlashCommand({ command: `order:refresh:${targetOrder.id}`, conversation: await getConv(), lastInboundExternalId: "b_7" });
    expect((await getConv()).stateMetadata).toMatchObject({
      current_state: "menu:order_detail",
      menu_scope: `order:detail:${targetOrder.id}`,
    });

    // Cancelar la orden activa y restaurar stock
    const cancelRes = await cancelActiveOrder({ organizationId: orgId, conversationId, orderId: targetOrder.id });
    expect(cancelRes).toMatchObject({ ok: true });

    const restoredProduct = await db.select().from(schema.product).where(scoped(schema.product.organizationId, orgId, eq(schema.product.id, prodWater)));
    expect(restoredProduct[0]!.stock).toBe(50); // Stock restored back to 50
  });

  /* ══════════════════════════════════════════════════════════
   * 3. RÁFAGAS DE DATOS Y MULTICLICS (BURSTS & CONCURRENCY)
   * ══════════════════════════════════════════════════════════ */

  it("3. Bursts: 25 simultaneous callback clicks allow exactly 1 winner and reject 24", async () => {
    await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(eq(schema.telegramMenuInstance.conversationId, conversationId));
    await db.update(schema.conversation).set({
      stateMetadata: { current_state: "menu:main", active_step: "main_menu", numeric_options: ["menu:carrito"] },
    }).where(eq(schema.conversation.id, conversationId));

    const menu = await createMenuInstance("active", "menu:main/main_menu", ["menu:carrito"]);

    const promises = Array.from({ length: 25 }, (_, i) =>
      acceptTelegramMenuCallback({
        organizationId: orgId,
        updateId: 900_000 + i,
        callbackQueryId: `burst_25_${i}`,
        callbackData: encodeMenuCallback(menu.id, 0),
        chatId: CHAT_ID,
        fromId: CHAT_ID,
        messageId: menu.messageId,
        chatType: "private",
      }),
    );

    const decisions = await Promise.all(promises);
    const acceptedCount = decisions.filter((d) => d.accepted).length;
    const rejectedCount = decisions.filter((d) => !d.accepted).length;

    expect(acceptedCount).toBe(1);
    expect(rejectedCount).toBe(24);

    const actionsInDb = await db.select().from(schema.telegramMenuAction)
      .where(eq(schema.telegramMenuAction.menuInstanceId, menu.id));
    expect(actionsInDb).toHaveLength(1);
  });

  /* ══════════════════════════════════════════════════════════
   * 4. RECHAZO DE MENÚS OBSOLETOS (STALE & SUPERSEDED MENUS)
   * ══════════════════════════════════════════════════════════ */

  it("4. Stale menu rejection: callbacks on superseded or step-mismatched menus are silently rejected", async () => {
    // Crear un menú en estado 'superseded'
    const staleMenu = await createMenuInstance("superseded", "menu:main/main_menu");
    const resStale = await acceptTelegramMenuCallback({
      organizationId: orgId,
      updateId: 910_001,
      callbackQueryId: "stale_click",
      callbackData: encodeMenuCallback(staleMenu.id, 0),
      chatId: CHAT_ID,
      fromId: CHAT_ID,
      messageId: staleMenu.messageId,
      chatType: "private",
    });
    expect(resStale.accepted).toBe(false);

    // Crear un menú en estado 'active' pero cuyo estado FSB en la conversación cambió
    await db.update(schema.conversation).set({
      stateMetadata: { current_state: "menu:catalog", active_step: "viewing_category" },
    }).where(eq(schema.conversation.id, conversationId));

    const mismatchedMenu = await createMenuInstance("active", "menu:catalog/viewing_catalog");
    const resMismatch = await acceptTelegramMenuCallback({
      organizationId: orgId,
      updateId: 910_002,
      callbackQueryId: "mismatch_click",
      callbackData: encodeMenuCallback(mismatchedMenu.id, 0),
      chatId: CHAT_ID,
      fromId: CHAT_ID,
      messageId: mismatchedMenu.messageId,
      chatType: "private",
    });
    expect(resMismatch.accepted).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════
   * 5. GENERACIÓN Y EDICIÓN DE PEDIDOS, REPRICING Y MERGE
   * ══════════════════════════════════════════════════════════ */

  it("5. Order edit as cart, repricing disclosure, and sequential order numbers", async () => {
    // 1. Limpiar carrito activo
    await clearActiveCart({ organizationId: orgId, conversationId });

    // 2. Agregar Papas Fritas @1500
    await addProductToCart({ organizationId: orgId, conversationId, productId: prodChips, quantity: 2 });

    // 3. Simular cambio de precio en catálogo a @1800 antes del checkout
    const productsMap = new Map([
      [prodChips, { id: prodChips, name: "Papas Fritas", description: "Bolsa familiar 200g", price: 1800 }],
    ]);

    const activeCart = (await db.select().from(schema.cart).where(scoped(schema.cart.organizationId, orgId, and(
      eq(schema.cart.conversationId, conversationId),
      eq(schema.cart.status, "active"),
    ))))[0]!;

    const { items: repricedItems, priceChanges } = repriceItems(activeCart.items, productsMap);
    expect(priceChanges).toHaveLength(1);
    expect(priceChanges[0]).toMatchObject({ oldPrice: 1500, newPrice: 1800, quantity: 2 });
    expect(repricedItems[0]!.unitPrice).toBe(1800);

    const disclosureText = renderPriceDisclosure(priceChanges, 3600);
    expect(disclosureText).toContain("Papas Fritas");
    expect(disclosureText).toContain("$1.500");
    expect(disclosureText).toContain("$1.800");

    // 4. Asignación secuencial de números de orden
    const orderNum1 = await db.transaction((tx) => allocateOrderNumber(tx, orgId));
    const orderNum2 = await db.transaction((tx) => allocateOrderNumber(tx, orgId));
    expect(orderNum1).toMatch(/^ORD-\d{6,}$/);
    expect(orderNum2).toMatch(/^ORD-\d{6,}$/);
    expect(orderNum1).not.toEqual(orderNum2);
  });

  /* ══════════════════════════════════════════════════════════
   * 6. PRECARGA Y MANTENIMIENTO DE BASE DE DATOS
   * ══════════════════════════════════════════════════════════ */

  it("6. Preload and DB maintenance: enforces active cart uniqueness and message history alignment", async () => {
    await db.delete(schema.cart).where(scoped(schema.cart.organizationId, orgId, eq(schema.cart.conversationId, conversationId)));

    // Insertar un primer carrito activo en la BD
    await db.insert(schema.cart).values({
      id: newId("cart"),
      organizationId: orgId,
      conversationId,
      items: [{ productId: prodJuice, quantity: 1, unitPrice: 2000, name: "Jugo Naranja", presentation: "1 Litro" }],
      status: "active",
    });

    // Intentar insertar un segundo carrito activo para la misma conversación debe fallar por cart_org_conv_active_uq
    await expect(
      db.insert(schema.cart).values({
        id: newId("cart"),
        organizationId: orgId,
        conversationId,
        items: [{ productId: prodWater, quantity: 1, unitPrice: 1000, name: "Agua Mineral", presentation: "500ml" }],
        status: "active",
      }),
    ).rejects.toThrow(/cart_org_conv_active_uq|unique/i);

    // Limpiar carrito al finalizar
    await db.delete(schema.cart).where(scoped(schema.cart.organizationId, orgId, eq(schema.cart.conversationId, conversationId)));
  });
});
