import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { listCatalogProducts, listCategories } from "@/server/ecommerce/catalog";
import {
  commitMemoryOrderStock,
  getCatalogCacheMap,
  invalidateCatalogCache,
} from "@/server/ecommerce/cache";
import { getCommerceSettings } from "@/server/ecommerce/settings";
import { aggregateAndValidateShape, CartShapeError, normalizeCartItems, type CartPriceBucket } from "@/server/ecommerce/cart-normalizer";
import { allocateOrderNumber } from "@/server/ecommerce/order-number";
import { type PriceChange } from "@/server/ecommerce/pricing";
import { enqueueTelegramOutbox } from "@/server/telegram/outbox";

export interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  presentation: string | null;
  source?: string;
}

type LegacyCartItem = Omit<CartItem, "productId" | "presentation"> & {
  productId?: string;
  sku?: string;
  presentation?: string | null;
};

type OrderStatus = typeof schema.order.$inferSelect.status;
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "processing", "pending_shipment", "shipped", "paused"];
export const MAX_ACTIVE_ORDERS_PER_CONTACT = 3;

/**
 * Obtiene las categorías registradas en la organización.
 */
export async function listarCategorias(organizationId: string) {
  return listCategories(organizationId);
}

export { listCatalogProducts };

export async function getProductForCustomer(organizationId: string, productId: string) {
  const rows = await getDb().select({
    id: schema.product.id,
    name: schema.product.name,
    description: schema.product.description,
    price: schema.product.price,
    stock: schema.product.stock,
    categoryId: schema.product.categoryId,
  }).from(schema.product).where(scoped(
    schema.product.organizationId, organizationId,
    and(eq(schema.product.id, productId), eq(schema.product.active, true), isNull(schema.product.deletedAt))
  )).limit(1);
  return rows[0] ?? null;
}

/**
 * Busca productos por nombre o presentación. El SKU no participa en flujos de cliente.
 */
export async function buscarProductos(input: {
  organizationId: string;
  query: string;
}) {
  const { organizationId, query } = input;
  const qClean = query.trim().toLowerCase();

  const cached = getCatalogCacheMap().get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    const isAll = !qClean || qClean === "*" || qClean === "todo";
    const filtered = cached.products.filter((p) => {
      if (!p.active || p.deletedAt) return false;
      if (isAll) return true;
      return (
        p.name.toLowerCase().includes(qClean) ||
        (p.description && p.description.toLowerCase().includes(qClean))
      );
    });
    return filtered
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        description: p.description,
      }));
  }

  const db = getDb();
  let condition: SQL<unknown> | undefined = scoped(
    schema.product.organizationId,
    organizationId,
    and(eq(schema.product.active, true), isNull(schema.product.deletedAt))
  );

  if (qClean && qClean !== "*" && qClean !== "todo") {
    const pattern = `%${qClean}%`;
    const searchOr = or(
      ilike(schema.product.name, pattern),
      ilike(schema.product.description, pattern)
    );
    if (searchOr && condition) {
      condition = and(condition, searchOr);
    }
  }

  const productos = await db
    .select({
      id: schema.product.id,
      name: schema.product.name,
      price: schema.product.price,
      stock: schema.product.stock,
      description: schema.product.description,
    })
    .from(schema.product)
    .where(condition)
    .limit(10);

  return productos;
}

/**
 * Agrega o incrementa un producto en el carrito activo de la conversación.
 */
export async function addProductToCart(input: {
  organizationId: string;
  conversationId: string;
  productId: string;
  quantity: number;
}) {
  const db = getDb();
  const { organizationId, conversationId, productId, quantity } = input;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false as const, error: "invalid_quantity" as const };
  const settings = await getCommerceSettings(organizationId);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
      where ${schema.conversation.organizationId} = ${organizationId}
        and ${schema.conversation.id} = ${conversationId} for update`);
    const products = await tx.select().from(schema.product).where(scoped(
      schema.product.organizationId, organizationId,
      and(eq(schema.product.id, productId), eq(schema.product.active, true), isNull(schema.product.deletedAt))
    )).limit(1);
    const product = products[0];
    if (!product) return { ok: false as const, error: "product_not_found" as const };
    const carts = await tx.select().from(schema.cart).where(scoped(
      schema.cart.organizationId, organizationId,
      and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
    )).limit(1);
    let cart = carts[0];
    if (!cart) {
      const created = await tx.insert(schema.cart).values({
        id: newId("cart"), organizationId, conversationId, items: [], status: "active",
      }).returning();
      cart = created[0];
    }
    if (!cart) return { ok: false as const, error: "cart_create_failed" as const };
    const items = [...((cart.items ?? []) as LegacyCartItem[])];
    const source = "cart";
    const index = items.findIndex((item) => item.productId === productId && item.unitPrice === product.price && (item.source ?? "cart") === source);
    const current = index >= 0 ? items[index]!.quantity : 0;
    const total = items.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0) + quantity;
    if (total > settings.maxUnitsPerProduct) {
      return { ok: false as const, error: "tenant_limit_exceeded" as const, limit: settings.maxUnitsPerProduct };
    }
    if (total > product.stock) {
      return { ok: false as const, error: "insufficient_stock" as const, available: product.stock };
    }
    const item: CartItem = {
      productId, quantity: current + quantity, unitPrice: product.price, name: product.name,
      presentation: product.description?.trim() || null,
      source,
    };
    if (index >= 0) items[index] = item;
    else items.push(item);
    const updated = await tx.update(schema.cart).set({ items: items as CartItem[], updatedAt: new Date() })
      .where(scoped(schema.cart.organizationId, organizationId, eq(schema.cart.id, cart.id))).returning();
    const stored = updated[0] ?? { ...cart, items };
    const units = (stored.items as CartItem[]).reduce((sum, entry) => sum + entry.quantity, 0);
    const totalAmount = (stored.items as CartItem[]).reduce((sum, entry) => sum + entry.quantity * entry.unitPrice, 0);
    return { ok: true as const, cart: stored, product, units, totalAmount };
  });
}

export async function agregarAlCarrito(input: {
  organizationId: string; conversationId: string; productId: string; cantidad?: number;
}) {
  return addProductToCart({ ...input, quantity: input.cantidad ?? 1 });
}

export async function clearActiveCart(input: {
  organizationId: string;
  conversationId: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
      where ${schema.conversation.organizationId} = ${input.organizationId}
        and ${schema.conversation.id} = ${input.conversationId} for update`);
    const cleared = await tx.update(schema.cart).set({ items: [], updatedAt: new Date() })
      .where(scoped(schema.cart.organizationId, input.organizationId,
        and(eq(schema.cart.conversationId, input.conversationId), eq(schema.cart.status, "active"))))
      .returning({ id: schema.cart.id });
    return { ok: true as const, cleared: cleared.length > 0 };
  });
}

/**
 * Formaliza el carrito activo y lo convierte en un pedido en firme.
 */
export async function confirmarPedido(input: {
  organizationId: string;
  conversationId: string;
}) {
  const db = getDb();
  const { organizationId, conversationId } = input;
  const settings = await getCommerceSettings(organizationId);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
        where ${schema.conversation.organizationId} = ${organizationId}
          and ${schema.conversation.id} = ${conversationId} for update`);
      const conversations = await tx.select({ contactId: schema.conversation.contactId })
        .from(schema.conversation)
        .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
        .limit(1);
      const contactId = conversations[0]?.contactId;
      if (!contactId) return { ok: false as const, error: "conversation_not_found" as const };
      await tx.execute(sql`select ${schema.contact.id} from ${schema.contact}
        where ${schema.contact.organizationId} = ${organizationId}
          and ${schema.contact.id} = ${contactId} for update`);
      const carts = await tx.select().from(schema.cart).where(scoped(
        schema.cart.organizationId, organizationId,
        and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
      )).limit(1);
      const cart = carts[0];
      const rawItems = (cart?.items ?? []) as LegacyCartItem[];
      if (!cart || rawItems.length === 0) return { ok: false as const, error: "carrito_vacio" as const };
      const normalizedItems = normalizeCartItems(rawItems.map((item) => {
        if (!item.productId) throw new InvalidCartError();
        return { ...item, productId: item.productId, presentation: item.presentation ?? null } as CartPriceBucket;
      }), { maxUnitsPerProduct: settings.maxUnitsPerProduct });
      const activeOrders = await tx.select().from(schema.order)
        .where(scoped(schema.order.organizationId, organizationId,
          and(eq(schema.order.contactId, contactId), inArray(schema.order.status, ACTIVE_ORDER_STATUSES))))
        .orderBy(desc(schema.order.createdAt), desc(schema.order.id))
        .limit(MAX_ACTIVE_ORDERS_PER_CONTACT);
      if (activeOrders.length >= MAX_ACTIVE_ORDERS_PER_CONTACT) {
        return {
          ok: false as const,
          error: "active_order_limit" as const,
          limit: MAX_ACTIVE_ORDERS_PER_CONTACT,
          candidateOrder: activeOrders[0]!,
          cart,
        };
      }

      const resolved: CartItem[] = [];
      const priceChanges: PriceChange[] = [];
      for (const item of normalizedItems) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new InvalidCartError();
        if (item.quantity > settings.maxUnitsPerProduct) throw new CartLimitError(settings.maxUnitsPerProduct);
        const identity = eq(schema.product.id, item.productId);
        const initial = await tx.select({ id: schema.product.id }).from(schema.product)
          .where(scoped(schema.product.organizationId, organizationId, identity)).limit(1);
        if (!initial[0]) throw new StockChangedError(item.productId ?? "unknown", 0, item.quantity);
        await tx.execute(sql`select ${schema.product.id} from ${schema.product}
          where ${schema.product.organizationId} = ${organizationId}
            and ${schema.product.id} = ${initial[0].id} for update`);
        const products = await tx.select().from(schema.product).where(scoped(
          schema.product.organizationId, organizationId,
          and(eq(schema.product.id, initial[0].id), eq(schema.product.active, true), isNull(schema.product.deletedAt))
        )).limit(1);
        const product = products[0];
        if (!product || product.stock < item.quantity) {
          throw new StockChangedError(initial[0].id, product?.stock ?? 0, item.quantity);
        }
        const decremented = await tx.update(schema.product).set({
          stock: sql`${schema.product.stock} - ${item.quantity}`, updatedAt: new Date(),
        }).where(scoped(schema.product.organizationId, organizationId,
          and(eq(schema.product.id, product.id), gte(schema.product.stock, item.quantity))))
          .returning({ id: schema.product.id });
        if (!decremented[0]) throw new StockChangedError(product.id, product.stock, item.quantity);
        resolved.push({
          productId: product.id, quantity: item.quantity, unitPrice: product.price,
          name: product.name, presentation: product.description?.trim() || null,
          source: item.source ?? "cart",
        });
        if (item.unitPrice !== product.price) {
          priceChanges.push({
            productId: product.id,
            name: product.name,
            presentation: product.description?.trim() || null,
            source: item.source ?? "cart",
            oldPrice: item.unitPrice,
            newPrice: product.price,
            quantity: item.quantity,
            difference: (product.price - item.unitPrice) * item.quantity,
          });
        }
      }
      const totalAmount = resolved.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      if (!Number.isSafeInteger(totalAmount) || totalAmount < 0 || totalAmount > 2_147_483_647) {
        throw new InvalidCartError();
      }
      const orderNumber = await allocateOrderNumber(tx, organizationId);
      const orders = await tx.insert(schema.order).values({
        id: newId("order"), organizationId, conversationId, contactId, cartId: cart.id,
        orderNumber, items: resolved, totalAmount, status: "confirmed",
      }).returning();
      if (!orders[0]) throw new Error("No se pudo crear el pedido");
      await tx.update(schema.cart).set({ status: "converted", updatedAt: new Date() })
        .where(scoped(schema.cart.organizationId, organizationId, eq(schema.cart.id, cart.id)));
      return { ok: true as const, order: orders[0], items: resolved, priceChanges };
    });
    if (!result.ok) return result;
    commitMemoryOrderStock(organizationId, result.items);
    return result.priceChanges.length > 0
      ? { ok: true as const, order: result.order, priceChanges: result.priceChanges }
      : { ok: true as const, order: result.order };
  } catch (error) {
    if (error instanceof StockChangedError) {
      return { ok: false as const, error: "stock_changed" as const,
        productId: error.productId, available: error.available, requested: error.requested };
    }
    if (error instanceof CartLimitError) {
      return { ok: false as const, error: "tenant_limit_exceeded" as const, limit: error.limit };
    }
    if (error instanceof InvalidCartError) return { ok: false as const, error: "invalid_cart" as const };
    if (error instanceof CartShapeError) {
      if (error.code === "tenant_limit_exceeded") {
        return { ok: false as const, error: "tenant_limit_exceeded" as const, limit: settings.maxUnitsPerProduct };
      }
      return { ok: false as const, error: "invalid_cart" as const };
    }
    throw error;
  }
}

export async function listActiveOrders(input: {
  organizationId: string;
  contactId: string;
}) {
  return getDb().select().from(schema.order).where(scoped(
    schema.order.organizationId,
    input.organizationId,
    and(
      eq(schema.order.contactId, input.contactId),
      inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
    )
  )).orderBy(desc(schema.order.createdAt)).limit(MAX_ACTIVE_ORDERS_PER_CONTACT);
}

export async function getOrderForCustomer(input: {
  organizationId: string;
  contactId: string;
  orderId: string;
}) {
  const rows = await getDb().select().from(schema.order).where(scoped(
    schema.order.organizationId,
    input.organizationId,
    and(eq(schema.order.contactId, input.contactId), eq(schema.order.id, input.orderId))
  )).limit(1);
  return rows[0] ?? null;
}

async function restoreOrderStock(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  items: CartItem[]
): Promise<void> {
  const sorted = [...items].sort((left, right) => left.productId.localeCompare(right.productId));
  for (const item of sorted) {
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new InvalidCartError();
    }
    await tx.execute(sql`select ${schema.product.id} from ${schema.product}
      where ${schema.product.organizationId} = ${organizationId}
        and ${schema.product.id} = ${item.productId} for update`);
    const restored = await tx.update(schema.product).set({
      stock: sql`${schema.product.stock} + ${item.quantity}`,
      updatedAt: new Date(),
    }).where(scoped(schema.product.organizationId, organizationId, eq(schema.product.id, item.productId)))
      .returning({ id: schema.product.id });
    if (!restored[0]) throw new Error("Order product missing while restoring stock");
  }
}

async function lockCustomerContext(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  conversationId: string
): Promise<string | null> {
  await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
    where ${schema.conversation.organizationId} = ${organizationId}
      and ${schema.conversation.id} = ${conversationId} for update`);
  const conversations = await tx.select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  const contactId = conversations[0]?.contactId;
  if (!contactId) return null;
  await tx.execute(sql`select ${schema.contact.id} from ${schema.contact}
    where ${schema.contact.organizationId} = ${organizationId}
      and ${schema.contact.id} = ${contactId} for update`);
  return contactId;
}

export async function mergeLatestOrderIntoActiveCart(input: {
  organizationId: string;
  conversationId: string;
  candidateOrderId: string;
}) {
  const db = getDb();
  const settings = await getCommerceSettings(input.organizationId);
  const result = await db.transaction(async (tx) => {
    const contactId = await lockCustomerContext(tx, input.organizationId, input.conversationId);
    if (!contactId) return { ok: false as const, error: "merge_candidate_changed" as const };
    await tx.execute(sql`select ${schema.cart.id} from ${schema.cart}
      where ${schema.cart.organizationId} = ${input.organizationId}
        and ${schema.cart.conversationId} = ${input.conversationId}
        and ${schema.cart.status} = 'active' for update`);
    const carts = await tx.select().from(schema.cart).where(scoped(
      schema.cart.organizationId,
      input.organizationId,
      and(eq(schema.cart.conversationId, input.conversationId), eq(schema.cart.status, "active"))
    )).limit(1);
    const cart = carts[0];
    if (!cart || ((cart.items ?? []) as CartItem[]).length === 0) {
      return { ok: false as const, error: "active_cart_missing" as const };
    }

    await tx.execute(sql`select ${schema.order.id} from ${schema.order}
      where ${schema.order.organizationId} = ${input.organizationId}
        and ${schema.order.contactId} = ${contactId}
        and ${schema.order.status} in ('pending', 'confirmed', 'processing')
      order by ${schema.order.createdAt} desc, ${schema.order.id} desc for update`);
    const activeOrders = await tx.select().from(schema.order).where(scoped(
      schema.order.organizationId,
      input.organizationId,
      and(eq(schema.order.contactId, contactId), inArray(schema.order.status, ACTIVE_ORDER_STATUSES))
    )).orderBy(desc(schema.order.createdAt), desc(schema.order.id)).limit(MAX_ACTIVE_ORDERS_PER_CONTACT);
    const candidate = activeOrders[0];
    if (activeOrders.length < MAX_ACTIVE_ORDERS_PER_CONTACT || !candidate || candidate.id !== input.candidateOrderId) {
      return { ok: false as const, error: "merge_candidate_changed" as const };
    }

    const orderItems = candidate.items as CartItem[];
    const cartItems = cart.items as CartItem[];
    const quantities = new Map<string, { order: number; cart: number }>();
    for (const [source, items] of [["order", orderItems], ["cart", cartItems]] as const) {
      for (const item of items) {
        if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return { ok: false as const, error: "invalid_order_items" as const };
        }
        const current = quantities.get(item.productId) ?? { order: 0, cart: 0 };
        current[source] += item.quantity;
        quantities.set(item.productId, current);
      }
    }

    const mergedItems: CartItem[] = [];
    for (const productId of [...quantities.keys()].sort()) {
      const quantity = quantities.get(productId)!;
      const requested = quantity.order + quantity.cart;
      if (requested > settings.maxUnitsPerProduct) {
        return {
          ok: false as const,
          error: "merge_limit_exceeded" as const,
          productId,
          requested,
          limit: settings.maxUnitsPerProduct,
        };
      }
      await tx.execute(sql`select ${schema.product.id} from ${schema.product}
        where ${schema.product.organizationId} = ${input.organizationId}
          and ${schema.product.id} = ${productId} for update`);
      const products = await tx.select().from(schema.product).where(scoped(
        schema.product.organizationId,
        input.organizationId,
        and(eq(schema.product.id, productId), eq(schema.product.active, true), isNull(schema.product.deletedAt))
      )).limit(1);
      const product = products[0];
      if (!product) return { ok: false as const, error: "invalid_order_items" as const };
      const effectiveStock = product.stock + quantity.order;
      if (requested > effectiveStock) {
        return {
          ok: false as const,
          error: "merge_stock_changed" as const,
          productId,
          productName: product.name,
          available: effectiveStock,
          requested,
        };
      }
      for (const [source, sourceItems] of [[`order:${candidate.id}`, orderItems], ["cart", cartItems]] as const) {
        for (const item of sourceItems.filter((entry) => entry.productId === productId)) {
          mergedItems.push({
            ...item,
            name: product.name,
            presentation: product.description?.trim() || null,
            source: item.source ?? source,
          });
        }
      }
    }

    const cancelled = await tx.update(schema.order).set({ status: "cancelled", updatedAt: new Date() })
      .where(scoped(schema.order.organizationId, input.organizationId,
        and(
          eq(schema.order.id, candidate.id),
          eq(schema.order.contactId, contactId),
          inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
        )))
      .returning({ id: schema.order.id });
    if (!cancelled[0]) return { ok: false as const, error: "merge_candidate_changed" as const };

    for (const item of orderItems) {
      await tx.update(schema.product).set({
        stock: sql`${schema.product.stock} + ${item.quantity}`,
        updatedAt: new Date(),
      }).where(scoped(schema.product.organizationId, input.organizationId, eq(schema.product.id, item.productId)));
    }
    const updated = await tx.update(schema.cart).set({
      items: aggregateAndValidateShape(mergedItems),
      reopenedFromOrderId: candidate.id,
      updatedAt: new Date(),
    }).where(scoped(schema.cart.organizationId, input.organizationId,
      and(eq(schema.cart.id, cart.id), eq(schema.cart.status, "active"))))
      .returning();
    if (!updated[0]) throw new Error("Active cart disappeared during order merge");
    return { ok: true as const, order: { ...candidate, status: "cancelled" as const }, cart: updated[0] };
  });
  if (result.ok) invalidateCatalogCache(input.organizationId);
  return result;
}

export async function editOrderAsCart(input: {
  organizationId: string;
  conversationId: string;
  orderId: string;
}) {
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const contactId = await lockCustomerContext(tx, input.organizationId, input.conversationId);
      if (!contactId) return { ok: false as const, error: "conversation_not_found" as const };
      await tx.execute(sql`select ${schema.order.id} from ${schema.order}
        where ${schema.order.organizationId} = ${input.organizationId}
          and ${schema.order.contactId} = ${contactId}
          and ${schema.order.id} = ${input.orderId} for update`);
      const orders = await tx.select().from(schema.order).where(scoped(
        schema.order.organizationId,
        input.organizationId,
        and(
          eq(schema.order.id, input.orderId),
          eq(schema.order.contactId, contactId),
          inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
        )
      )).limit(1);
      const order = orders[0];
      if (!order) return { ok: false as const, error: "order_not_active" as const };

      const activeCarts = await tx.select().from(schema.cart).where(scoped(
        schema.cart.organizationId,
        input.organizationId,
        and(eq(schema.cart.conversationId, input.conversationId), eq(schema.cart.status, "active"))
      ));
      if (activeCarts.some((cart) => ((cart.items ?? []) as CartItem[]).length > 0)) {
        return { ok: false as const, error: "active_cart_not_empty" as const };
      }

      const cancelled = await tx.update(schema.order).set({ status: "cancelled", updatedAt: new Date() })
        .where(scoped(schema.order.organizationId, input.organizationId,
          and(
            eq(schema.order.id, order.id),
            eq(schema.order.contactId, contactId),
            inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
          )))
        .returning({ id: schema.order.id });
      if (!cancelled[0]) return { ok: false as const, error: "order_not_active" as const };

      const items = order.items as CartItem[];
      await restoreOrderStock(tx, input.organizationId, items);
      if (activeCarts.length > 0) {
        await tx.update(schema.cart).set({ status: "abandoned", updatedAt: new Date() })
          .where(scoped(schema.cart.organizationId, input.organizationId,
            and(eq(schema.cart.conversationId, input.conversationId), eq(schema.cart.status, "active"))));
      }
      const carts = await tx.insert(schema.cart).values({
        id: newId("cart"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        reopenedFromOrderId: order.id,
        items,
        status: "active",
      }).returning();
      if (!carts[0]) throw new Error("No se pudo reabrir el pedido como carrito");
      return { ok: true as const, order: { ...order, status: "cancelled" as const }, cart: carts[0] };
    });
    if (result.ok) invalidateCatalogCache(input.organizationId);
    return result;
  } catch (error) {
    if (error instanceof InvalidCartError) return { ok: false as const, error: "invalid_order" as const };
    throw error;
  }
}

export async function cancelActiveOrder(input: {
  organizationId: string;
  conversationId: string;
  orderId: string;
}) {
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const contactId = await lockCustomerContext(tx, input.organizationId, input.conversationId);
      if (!contactId) return { ok: false as const, error: "conversation_not_found" as const };
      await tx.execute(sql`select ${schema.order.id} from ${schema.order}
        where ${schema.order.organizationId} = ${input.organizationId}
          and ${schema.order.contactId} = ${contactId}
          and ${schema.order.id} = ${input.orderId} for update`);
      const orders = await tx.select().from(schema.order).where(scoped(
        schema.order.organizationId,
        input.organizationId,
        and(
          eq(schema.order.id, input.orderId),
          eq(schema.order.contactId, contactId),
          inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
        )
      )).limit(1);
      const order = orders[0];
      if (!order) return { ok: false as const, error: "order_not_active" as const };
      const cancelled = await tx.update(schema.order).set({ status: "cancelled", updatedAt: new Date() })
        .where(scoped(schema.order.organizationId, input.organizationId,
          and(
            eq(schema.order.id, order.id),
            eq(schema.order.contactId, contactId),
            inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
          )))
        .returning({ id: schema.order.id });
      if (!cancelled[0]) return { ok: false as const, error: "order_not_active" as const };
      await restoreOrderStock(tx, input.organizationId, order.items as CartItem[]);
      return { ok: true as const, order: { ...order, status: "cancelled" as const } };
    });
    if (result.ok) invalidateCatalogCache(input.organizationId);
    return result;
  } catch (error) {
    if (error instanceof InvalidCartError) return { ok: false as const, error: "invalid_order" as const };
    throw error;
  }
}

export async function processAutoExpiredOrders(organizationId: string): Promise<string[]> {
  const settings = await getCommerceSettings(organizationId);
  const autoExpirationHours = settings.autoExpirationHours;
  const cutoff = new Date(Date.now() - autoExpirationHours * 60 * 60 * 1000);

  const expiredOrders = await getDb()
    .select({
      id: schema.order.id,
      orderNumber: schema.order.orderNumber,
      contactId: schema.order.contactId,
      conversationId: schema.order.conversationId,
      items: schema.order.items,
      createdAt: schema.order.createdAt,
    })
    .from(schema.order)
    .where(
      scoped(
        schema.order.organizationId,
        organizationId,
        and(
          inArray(schema.order.status, ACTIVE_ORDER_STATUSES),
          lt(schema.order.createdAt, cutoff)
        )
      )
    );

  if (expiredOrders.length === 0) return [];

  const cancelledOrderIds: string[] = [];

  for (const expOrder of expiredOrders) {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.order)
        .set({
          status: "cancelled",
          cancellationReason: "auto_expiration",
          updatedAt: new Date(),
        })
        .where(
          scoped(
            schema.order.organizationId,
            organizationId,
            and(
              eq(schema.order.id, expOrder.id),
              inArray(schema.order.status, ACTIVE_ORDER_STATUSES)
            )
          )
        )
        .returning({ id: schema.order.id });

      if (!updated[0]) return false;

      await restoreOrderStock(tx, organizationId, expOrder.items as CartItem[]);

      const contactRows = await tx
        .select({
          id: schema.contact.id,
          channel: schema.contact.channel,
          externalAddress: schema.contact.externalAddress,
          name: schema.contact.name,
        })
        .from(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            eq(schema.contact.id, expOrder.contactId)
          )
        )
        .limit(1);

      const contact = contactRows[0];
      if (contact && (contact.channel === "telegram" || contact.channel === "test")) {
        const integrationRows = await tx.select({ id: schema.telegramIntegration.id })
          .from(schema.telegramIntegration)
          .where(scoped(schema.telegramIntegration.organizationId, organizationId))
          .limit(1);

        let integrationId = integrationRows[0]?.id;
        if (!integrationId) {
          integrationId = newId("telegramIntegration");
          await tx.insert(schema.telegramIntegration).values({
            id: integrationId,
            organizationId,
            webhookTokenHash: "auto_expire_placeholder_hash",
            status: "pending",
          }).onConflictDoNothing();
        }

        const contactName = contact.name || "estimado/a cliente";
        const messageText = `Hola ${contactName} 🙏 Te pedimos disculpas. Tu pedido #${expOrder.orderNumber} ha sido cancelado automáticamente al haber transcurrido ${autoExpirationHours} horas sin confirmación final. Si deseas retomar tu compra o tienes cualquier duda, con gusto te atenderemos. ¡Gracias por tu comprensión!`;

        let fsmRevision = 1;
        if (expOrder.conversationId) {
          const convRows = await tx.select({ fsmRevision: schema.conversation.fsmRevision })
            .from(schema.conversation)
            .where(eq(schema.conversation.id, expOrder.conversationId))
            .limit(1);
          if (convRows[0]?.fsmRevision != null) {
            fsmRevision = convRows[0].fsmRevision;
          }
        }

        const seqRows = expOrder.conversationId
          ? await tx.select({ value: sql<number>`coalesce(max(${schema.telegramOutbox.sequence}),0)+1` })
              .from(schema.telegramOutbox).where(eq(schema.telegramOutbox.conversationId, expOrder.conversationId))
          : [{ value: 1 }];
        const sequence = Number(seqRows[0]?.value ?? 1);

        await enqueueTelegramOutbox(tx, {
          organizationId,
          integrationId,
          conversationId: expOrder.conversationId ?? contact.id,
          idempotencyKey: `auto-expire-${expOrder.id}`,
          kind: "message",
          sequence,
          fsmRevision,
          text: messageText,
          payload: { method: "sendMessage", chatId: contact.externalAddress, text: messageText },
        });
      }

      return true;
    });

    if (result) {
      cancelledOrderIds.push(expOrder.id);
    }
  }

  if (cancelledOrderIds.length > 0) {
    invalidateCatalogCache(organizationId);
  }

  return cancelledOrderIds;
}

class InvalidCartError extends Error {}
class CartLimitError extends Error {
  constructor(public limit: number) { super("tenant_limit_exceeded"); }
}

class StockChangedError extends Error {
  constructor(public productId: string, public available: number, public requested: number) {
    super("stock_changed");
  }
}
