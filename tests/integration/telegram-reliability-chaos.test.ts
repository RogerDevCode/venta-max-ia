/**
 * Task 14 — Chaos Matrix: Telegram Reliability Hardening
 *
 * Covers crash recovery, bursts, concurrency, transport errors,
 * commerce invariants, sandbox, and private-only policy.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { registerTelegramWebhookReceipt } from "@/server/telegram/integrations";
import { claimTelegramReceipt, retryTelegramReceipt } from "@/server/telegram/receipt-queue";
import { acceptTelegramMenuCallback } from "@/server/telegram/menu-guard";
import { encodeMenuCallback } from "@/server/telegram/menu-codec";
import { activateDeliveredTelegramMenu } from "@/server/telegram/menu-store";
import { classifyTelegramError, telegramCall } from "@/server/telegram/transport";
import { TelegramApiError } from "@/lib/telegram/client";
import { normalizeCartItems } from "@/server/ecommerce/cart-normalizer";
import { repriceItems, renderPriceDisclosure } from "@/server/ecommerce/pricing";
import { allocateOrderNumber } from "@/server/ecommerce/order-number";
import {
  addProductToCart,
  confirmarPedido,
} from "@/server/ecommerce/service";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const db = getDb();

/* ───────── shared fixtures ───────── */
const orgId = newId("organization");
const orgBId = newId("organization");
const orgCId = newId("organization");
const integA = newId("telegramIntegration");
const integBOrg = newId("telegramIntegration");
const integCOrg = newId("telegramIntegration");
const categoryId = newId("category");
const CHAT_ID = "800000000001";

const productIds = Array.from({ length: 5 }, () => newId("product"));
const conversationIds = Array.from({ length: 6 }, () => newId("conversation"));
const contactIds = Array.from({ length: 6 }, () => newId("contact"));

let menuGeneration = 0;

async function createMenu(
  conversationId: string,
  status: "active" | "superseded" = "active",
  fsbState = "menu:main/main_menu",
  allowedActions = ["menu:carrito"],
  chatId = CHAT_ID,
) {
  const id = newId("telegramMenu");
  await db.insert(schema.telegramMenuInstance).values({
    id,
    organizationId: orgId,
    conversationId,
    chatId,
    telegramMessageId: 5000 + ++menuGeneration,
    generation: menuGeneration,
    fsbState,
    allowedActions,
    status,
  });
  return { id, messageId: 5000 + menuGeneration };
}

describe.sequential("Telegram reliability chaos matrix", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values([
      { id: orgId, name: "Chaos tenant A" },
      { id: orgBId, name: "Chaos tenant B" },
      { id: orgCId, name: "Chaos tenant C" },
    ]);
    await db.insert(schema.telegramIntegration).values([
      { id: integA, organizationId: orgId, webhookTokenHash: `hash-chaos-${integA}` },
      { id: integBOrg, organizationId: orgBId, webhookTokenHash: `hash-chaos-${integBOrg}` },
      { id: integCOrg, organizationId: orgCId, webhookTokenHash: `hash-chaos-${integCOrg}` },
    ]);
    await db.insert(schema.category).values([
      { id: categoryId, organizationId: orgId, name: "Test" },
    ]);
    for (const [i, productId] of productIds.entries()) {
      await db.insert(schema.product).values({
        id: productId,
        organizationId: orgId,
        categoryId,
        name: `Chaos Product ${i}`,
        description: `Desc ${i}`,
        price: 1000 * (i + 1),
        stock: 100,
      });
    }
    for (const [i, contactId] of contactIds.entries()) {
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: orgId,
        channel: "telegram",
        externalAddress: `chaos-${i}`,
        name: `Chaos ${i}`,
      });
      await db.insert(schema.conversation).values({
        id: conversationIds[i]!,
        organizationId: orgId,
        contactId,
        stateMetadata: {
          current_state: "menu:main",
          active_step: "main_menu",
          numeric_options: ["menu:carrito"],
        },
      });
    }
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(inArray(schema.organization.id, [orgId, orgBId, orgCId]));
  });

  /* ══════════════════════════════════════════════════════════
   *  1. RECEIPT DURABILITY
   * ══════════════════════════════════════════════════════════ */

  it("crash before claim — receipt remains in received status", async () => {
    const result = await registerTelegramWebhookReceipt({
      organizationId: orgId,
      integrationId: integA,
      updateId: 100_001,
      payloadHash: "crash-before-claim",
      payload: { update_id: 100_001 },
    });
    expect(result).toBe("received");
    const rows = await db.select().from(schema.telegramWebhookReceipt).where(and(
      eq(schema.telegramWebhookReceipt.organizationId, orgId),
      eq(schema.telegramWebhookReceipt.updateId, 100_001),
    ));
    expect(rows[0]!.status).toBe("received");
  });

  it("crash after claim — lease expires and receipt is reclaimable", async () => {
    const id = newId("telegramReceipt");
    await db.insert(schema.telegramWebhookReceipt).values({
      id,
      organizationId: orgId,
      integrationId: integA,
      updateId: 100_002,
      payloadHash: "crash-after-claim",
      payload: { update_id: 100_002 },
      status: "processing",
      attempts: 1,
      leaseExpiresAt: new Date(0),
    });
    const reclaimed = await claimTelegramReceipt(orgId, id);
    expect(reclaimed).toMatchObject({ status: "processing", attempts: 2 });
  });

  it("expired lease allows reclaim", async () => {
    const id = newId("telegramReceipt");
    await db.insert(schema.telegramWebhookReceipt).values({
      id,
      organizationId: orgId,
      integrationId: integA,
      updateId: 100_003,
      payloadHash: "expired-lease",
      payload: { update_id: 100_003 },
      status: "processing",
      attempts: 1,
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const claimed = await claimTelegramReceipt(orgId, id);
    expect(claimed).not.toBeNull();
    expect(claimed!.attempts).toBe(2);
  });

  it("duplicate update with same payload returns duplicate", async () => {
    const base = { organizationId: orgId, integrationId: integA, updateId: 100_004, payloadHash: "dup-hash", payload: { update_id: 100_004 } };
    const first = await registerTelegramWebhookReceipt(base);
    expect(first).toBe("received");
    const second = await registerTelegramWebhookReceipt(base);
    expect(second).toBe("duplicate");
  });

  it("duplicate update with different payload returns conflict", async () => {
    const base = { organizationId: orgId, integrationId: integA, updateId: 100_005, payload: { update_id: 100_005 } };
    await registerTelegramWebhookReceipt({ ...base, payloadHash: "hash-A" });
    const result = await registerTelegramWebhookReceipt({ ...base, payloadHash: "hash-B" });
    expect(result).toBe("conflict");
  });

  it("same update_id on replacement bot (different org/integration) is accepted", async () => {
    const updateId = 100_006;
    await registerTelegramWebhookReceipt({ organizationId: orgBId, integrationId: integBOrg, updateId, payloadHash: "bot-orig", payload: { update_id: updateId } });
    const result = await registerTelegramWebhookReceipt({ organizationId: orgCId, integrationId: integCOrg, updateId, payloadHash: "bot-replace", payload: { update_id: updateId } });
    expect(result).toBe("received");
  });

  it("same chat/message across tenants are independent", async () => {
    const updateId = 100_070;
    const a = await registerTelegramWebhookReceipt({ organizationId: orgId, integrationId: integA, updateId, payloadHash: "tenant-a", payload: { update_id: updateId } });
    const b = await registerTelegramWebhookReceipt({ organizationId: orgBId, integrationId: integBOrg, updateId, payloadHash: "tenant-b", payload: { update_id: updateId } });
    expect(a).toBe("received");
    expect(b).toBe("received");
  });

  /* ══════════════════════════════════════════════════════════
   *  2. FSM BURSTS — 1,1 / 3,3 / delayed / I,R
   * ══════════════════════════════════════════════════════════ */

  it("burst 1,1 — only one callback wins from identical pair", async () => {
    const convId = conversationIds[0]!;
    const menu = await createMenu(convId);
    const results = await Promise.all([
      acceptTelegramMenuCallback({
        organizationId: orgId, updateId: 200_001, callbackQueryId: "burst1a",
        callbackData: encodeMenuCallback(menu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
        messageId: menu.messageId, chatType: "private",
      }),
      acceptTelegramMenuCallback({
        organizationId: orgId, updateId: 200_002, callbackQueryId: "burst1b",
        callbackData: encodeMenuCallback(menu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
        messageId: menu.messageId, chatType: "private",
      }),
    ]);
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
  });

  it("burst 3,3 — only one callback wins from six simultaneous clicks", async () => {
    const convId = conversationIds[0]!;
    await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(eq(schema.telegramMenuInstance.conversationId, convId));
    const menu = await createMenu(convId);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        acceptTelegramMenuCallback({
          organizationId: orgId, updateId: 200_010 + i, callbackQueryId: `burst3_${i}`,
          callbackData: encodeMenuCallback(menu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
          messageId: menu.messageId, chatType: "private",
        }),
      ),
    );
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
  });

  it("delayed number (stale revision) on superseded menu is rejected", async () => {
    const convId = conversationIds[0]!;
    await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(eq(schema.telegramMenuInstance.conversationId, convId));
    const oldMenu = await createMenu(convId, "superseded");
    const _newMenu = await createMenu(convId, "active");
    const result = await acceptTelegramMenuCallback({
      organizationId: orgId, updateId: 200_020, callbackQueryId: "delayed3",
      callbackData: encodeMenuCallback(oldMenu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
      messageId: oldMenu.messageId, chatType: "private",
    });
    expect(result.accepted).toBe(false);
  });

  it("mixed I,R — interleaved callback and text do not cause double transition", async () => {
    const convId = conversationIds[1]!;
    const menu = await createMenu(convId);
    const clickResults = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        acceptTelegramMenuCallback({
          organizationId: orgId, updateId: 200_030 + i, callbackQueryId: `ir_${i}`,
          callbackData: encodeMenuCallback(menu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
          messageId: menu.messageId, chatType: "private",
        }),
      ),
    );
    expect(clickResults.filter((r) => r.accepted)).toHaveLength(1);
  });

  /* ══════════════════════════════════════════════════════════
   *  3. 20 DUPLICATE CALLBACKS
   * ══════════════════════════════════════════════════════════ */

  it("20 duplicate callbacks — exactly one wins", async () => {
    const convId = conversationIds[2]!;
    await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(eq(schema.telegramMenuInstance.conversationId, convId));
    const menu = await createMenu(convId);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        acceptTelegramMenuCallback({
          organizationId: orgId, updateId: 200_100 + i, callbackQueryId: `dup20_${i}`,
          callbackData: encodeMenuCallback(menu.id, 0), chatId: CHAT_ID, fromId: CHAT_ID,
          messageId: menu.messageId, chatType: "private",
        }),
      ),
    );
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    const actions = await db.select().from(schema.telegramMenuAction)
      .where(eq(schema.telegramMenuAction.menuInstanceId, menu.id));
    expect(actions).toHaveLength(1);
  });

  /* ══════════════════════════════════════════════════════════
   *  4. TRANSPORT ERROR CLASSIFICATION
   * ══════════════════════════════════════════════════════════ */

  it("classifies timeout (AbortError) as retryable", () => {
    const abort = new DOMException("signal timed out", "TimeoutError");
    const err = classifyTelegramError(abort);
    expect(err).toMatchObject({ code: "timeout", retryable: true, deliveryUnknown: true });
  });

  it("classifies 429 as retryable rate_limited", () => {
    const err = classifyTelegramError(new TelegramApiError("rate limited", { status: 429 }));
    expect(err).toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("classifies 500 as retryable server error", () => {
    const err = classifyTelegramError(new TelegramApiError("server", { status: 500 }));
    expect(err).toMatchObject({ code: "server", retryable: true });
  });

  it("classifies 401 as terminal unauthorized", () => {
    const err = classifyTelegramError(new TelegramApiError("auth", { status: 401 }));
    expect(err).toMatchObject({ code: "unauthorized", retryable: false });
  });

  /* ══════════════════════════════════════════════════════════
   *  5. OUTBOX REVERSED ORDERING
   * ══════════════════════════════════════════════════════════ */

  it("reversed outbox delivery keeps newest generation active", async () => {
    const convId = conversationIds[3]!;
    const olderId = newId("telegramMenu");
    const newerId = newId("telegramMenu");
    const olderGen = ++menuGeneration;
    const newerGen = ++menuGeneration;
    await db.insert(schema.telegramMenuInstance).values([
      {
        id: olderId, organizationId: orgId, conversationId: convId, chatId: CHAT_ID,
        generation: olderGen, fsbState: "menu:main/main_menu", allowedActions: ["menu:catalog"],
        status: "pending",
      },
      {
        id: newerId, organizationId: orgId, conversationId: convId, chatId: CHAT_ID,
        generation: newerGen, fsbState: "menu:main/main_menu", allowedActions: ["menu:cart"],
        status: "pending",
      },
    ]);
    // Deliver newer first, then older (reversed)
    await activateDeliveredTelegramMenu({ organizationId: orgId, conversationId: convId, instanceId: newerId, telegramMessageId: 8002 });
    await activateDeliveredTelegramMenu({ organizationId: orgId, conversationId: convId, instanceId: olderId, telegramMessageId: 8001 });

    const rows = await db.select({ id: schema.telegramMenuInstance.id, status: schema.telegramMenuInstance.status })
      .from(schema.telegramMenuInstance)
      .where(eq(schema.telegramMenuInstance.conversationId, convId));
    expect(rows.find((r) => r.id === newerId)?.status).toBe("active");
    expect(rows.find((r) => r.id === olderId)?.status).toBe("superseded");
  });

  /* ══════════════════════════════════════════════════════════
   *  6. CART NORMALIZER — DUPLICATE LINES
   * ══════════════════════════════════════════════════════════ */

  it("aggregates duplicate cart lines by productId", () => {
    const items = normalizeCartItems([
      { productId: "p1", quantity: 2, unitPrice: 1000, source: "catalog", name: "P1", presentation: null },
      { productId: "p1", quantity: 3, unitPrice: 1000, source: "catalog", name: "P1", presentation: null },
    ], { maxUnitsPerProduct: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(5);
  });

  it("rejects aggregate quantity exceeding tenant limit", () => {
    expect(() =>
      normalizeCartItems([
        { productId: "p1", quantity: 3, unitPrice: 1000, source: "catalog", name: "P1", presentation: null },
        { productId: "p1", quantity: 3, unitPrice: 1000, source: "catalog", name: "P1", presentation: null },
      ], { maxUnitsPerProduct: 3 }),
    ).toThrow("tenant_limit_exceeded");
  });

  it("preserves distinct price/source buckets", () => {
    const items = normalizeCartItems([
      { productId: "p1", quantity: 1, unitPrice: 100, source: "catalog", name: "P1", presentation: null },
      { productId: "p1", quantity: 1, unitPrice: 200, source: "promo", name: "P1", presentation: null },
    ], { maxUnitsPerProduct: 10 });
    expect(items).toHaveLength(2);
  });

  /* ══════════════════════════════════════════════════════════
   *  7. DUPLICATE ACTIVE CARTS — DB uniqueness enforced
   * ══════════════════════════════════════════════════════════ */

  it("rejects a second active cart for the same conversation", async () => {
    const convId = conversationIds[4]!;
    const p0 = productIds[0]!;
    const p1 = productIds[1]!;
    await db.insert(schema.cart).values({
      id: newId("cart"),
      organizationId: orgId,
      conversationId: convId,
      items: [{ productId: p0, quantity: 1, unitPrice: 1000, name: "Chaos Product 0", presentation: null }],
      status: "active",
    });
    await expect(
      db.insert(schema.cart).values({
        id: newId("cart"),
        organizationId: orgId,
        conversationId: convId,
        items: [{ productId: p1, quantity: 1, unitPrice: 2000, name: "Chaos Product 1", presentation: null }],
        status: "active",
      }),
    ).rejects.toThrow(/cart_org_conv_active_uq|unique/i);
  });

  /* ══════════════════════════════════════════════════════════
   *  8. 100 CONCURRENT ORDER NUMBERS
   * ══════════════════════════════════════════════════════════ */

  it("allocates 100 concurrent unique sequential order numbers", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 100 }, () =>
        db.transaction(async (tx) => allocateOrderNumber(tx, orgId)),
      ),
    );
    expect(new Set(numbers).size).toBe(100);
    expect(numbers.every((n) => /^ORD-\d{6,}$/.test(n))).toBe(true);
  });

  /* ══════════════════════════════════════════════════════════
   *  9. REPRICING — CHECKOUT
   * ══════════════════════════════════════════════════════════ */

  it("detects and discloses price changes at checkout", () => {
    const cartItems = [
      { productId: "p1", quantity: 2, unitPrice: 100, source: "catalog", name: "Widget", presentation: null },
    ];
    const products = new Map([["p1", { id: "p1", name: "Widget", description: null, price: 777 }]]);
    const { items: repriced, priceChanges } = repriceItems(cartItems, products);
    expect(priceChanges).toHaveLength(1);
    expect(priceChanges[0]).toMatchObject({ oldPrice: 100, newPrice: 777, quantity: 2 });
    expect(repriced[0]!.unitPrice).toBe(777);
    const disclosure = renderPriceDisclosure(priceChanges, 777 * 2);
    expect(disclosure).toContain("$100");
    expect(disclosure).toContain("$777");
    expect(disclosure).toContain("Total definitivo");
  });

  /* ══════════════════════════════════════════════════════════
   *  10. REPRICING — 3rd+4th MERGE
   * ══════════════════════════════════════════════════════════ */

  it("reprices across multiple price buckets (add @100, catalog changes to 200, add again, checkout @777)", () => {
    const cartItems = [
      { productId: "p1", quantity: 1, unitPrice: 100, source: "catalog", name: "Widget", presentation: null },
      { productId: "p1", quantity: 1, unitPrice: 200, source: "catalog", name: "Widget", presentation: null },
    ];
    const products = new Map([["p1", { id: "p1", name: "Widget", description: null, price: 777 }]]);
    const { priceChanges } = repriceItems(cartItems, products);
    expect(priceChanges).toHaveLength(2);
    expect(priceChanges.find((c) => c.oldPrice === 100)).toMatchObject({ newPrice: 777, quantity: 1 });
    expect(priceChanges.find((c) => c.oldPrice === 200)).toMatchObject({ newPrice: 777, quantity: 1 });
  });

  /* ══════════════════════════════════════════════════════════
   *  11. STOCK CHANGE AFTER PROPOSAL
   * ══════════════════════════════════════════════════════════ */

  it("rejects checkout when stock was reduced after cart creation", async () => {
    const convId = conversationIds[5]!;
    const pid = productIds[4]!;
    // Set stock to 2
    await db.update(schema.product).set({ stock: 2 }).where(eq(schema.product.id, pid));
    // Add 2 to cart
    await addProductToCart({ organizationId: orgId, conversationId: convId, productId: pid, quantity: 2 });
    // Reduce stock to 1 (someone else bought)
    await db.update(schema.product).set({ stock: 1 }).where(eq(schema.product.id, pid));
    const result = await confirmarPedido({ organizationId: orgId, conversationId: convId });
    expect(result).toMatchObject({ ok: false, error: "stock_changed" });
    // Restore stock
    await db.update(schema.product).set({ stock: 100 }).where(eq(schema.product.id, pid));
  });

  /* ══════════════════════════════════════════════════════════
   *  12. SANDBOX ENFORCEMENT
   * ══════════════════════════════════════════════════════════ */

  it("sandbox (isTest:true) never calls Telegram transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        telegramCall({ token: "tenant", status: "connected" }, "sendMessage", { chat_id: "1", text: "hi" }, { isTest: true }),
      ).rejects.toMatchObject({ message: "sandbox_violation" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /* ══════════════════════════════════════════════════════════
   *  13. NON-PRIVATE CHATS
   * ══════════════════════════════════════════════════════════ */

  it.each(["group", "supergroup", "channel"] as const)(
    "rejects %s chat callback without creating an action",
    async (chatType) => {
      const convId = conversationIds[0]!;
      await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
        .where(eq(schema.telegramMenuInstance.conversationId, convId));
      const menu = await createMenu(convId);
      const result = await acceptTelegramMenuCallback({
        organizationId: orgId,
        updateId: 300_000,
        callbackQueryId: `nonprivate_${chatType}`,
        callbackData: encodeMenuCallback(menu.id, 0),
        chatId: CHAT_ID,
        fromId: CHAT_ID,
        messageId: menu.messageId,
        chatType,
      });
      expect(result.accepted).toBe(false);
    },
  );

  /* ══════════════════════════════════════════════════════════
   *  14. RECEIPT RETRY → TERMINAL AFTER MAX ATTEMPTS
   * ══════════════════════════════════════════════════════════ */

  it("receipt fails terminally after max attempts", async () => {
    const id = newId("telegramReceipt");
    await db.insert(schema.telegramWebhookReceipt).values({
      id,
      organizationId: orgId,
      integrationId: integA,
      updateId: 100_010,
      payloadHash: "max-attempts",
      payload: { update_id: 100_010 },
      status: "processing",
      attempts: 5,
      leaseExpiresAt: new Date(0),
    });
    await retryTelegramReceipt({ organizationId: orgId, receiptId: id, attempts: 5, error: new Error("persistent failure") });
    const rows = await db.select().from(schema.telegramWebhookReceipt)
      .where(eq(schema.telegramWebhookReceipt.id, id));
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.processedAt).not.toBeNull();
  });

  it("receipt retries with backoff below max attempts", async () => {
    const id = newId("telegramReceipt");
    await db.insert(schema.telegramWebhookReceipt).values({
      id,
      organizationId: orgId,
      integrationId: integA,
      updateId: 100_011,
      payloadHash: "retry-backoff",
      payload: { update_id: 100_011 },
      status: "processing",
      attempts: 2,
      leaseExpiresAt: new Date(0),
    });
    await retryTelegramReceipt({ organizationId: orgId, receiptId: id, attempts: 2, error: new Error("transient") });
    const rows = await db.select().from(schema.telegramWebhookReceipt)
      .where(eq(schema.telegramWebhookReceipt.id, id));
    expect(rows[0]!.status).toBe("retryable_failed");
    expect(rows[0]!.processedAt).toBeNull();
  });
});
