import { and, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
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

export interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  presentation: string | null;
}

type LegacyCartItem = Omit<CartItem, "productId" | "presentation"> & {
  productId?: string;
  sku?: string;
  presentation?: string | null;
};

type OrderStatus = typeof schema.order.$inferSelect.status;
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "processing"];
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
    const index = items.findIndex((item) => item.productId === productId);
    const current = index >= 0 ? items[index]!.quantity : 0;
    const total = current + quantity;
    if (total > settings.maxUnitsPerProduct) {
      return { ok: false as const, error: "tenant_limit_exceeded" as const, limit: settings.maxUnitsPerProduct };
    }
    if (total > product.stock) {
      return { ok: false as const, error: "insufficient_stock" as const, available: product.stock };
    }
    const item: CartItem = {
      productId, quantity: total, unitPrice: product.price, name: product.name,
      presentation: product.description?.trim() || null,
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
  const orderNumber = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
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
      const activeOrderCount = await tx.select({ count: sql<number>`count(*)::int` })
        .from(schema.order)
        .where(scoped(schema.order.organizationId, organizationId,
          and(eq(schema.order.contactId, contactId), inArray(schema.order.status, ACTIVE_ORDER_STATUSES))));
      if ((activeOrderCount[0]?.count ?? 0) >= MAX_ACTIVE_ORDERS_PER_CONTACT) {
        return { ok: false as const, error: "active_order_limit" as const, limit: MAX_ACTIVE_ORDERS_PER_CONTACT };
      }
      const carts = await tx.select().from(schema.cart).where(scoped(
        schema.cart.organizationId, organizationId,
        and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
      )).limit(1);
      const cart = carts[0];
      const rawItems = (cart?.items ?? []) as LegacyCartItem[];
      if (!cart || rawItems.length === 0) return { ok: false as const, error: "carrito_vacio" as const };

      const resolved: CartItem[] = [];
      for (const item of [...rawItems].sort((a, b) => (a.productId ?? a.sku ?? "").localeCompare(b.productId ?? b.sku ?? ""))) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new InvalidCartError();
        if (item.quantity > settings.maxUnitsPerProduct) throw new CartLimitError(settings.maxUnitsPerProduct);
        const identity = item.productId
          ? eq(schema.product.id, item.productId)
          : item.sku ? eq(schema.product.sku, item.sku) : eq(schema.product.id, "");
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
        });
      }
      const totalAmount = resolved.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      if (!Number.isSafeInteger(totalAmount) || totalAmount < 0 || totalAmount > 2_147_483_647) {
        throw new InvalidCartError();
      }
      const orders = await tx.insert(schema.order).values({
        id: newId("order"), organizationId, conversationId, contactId, cartId: cart.id,
        orderNumber, items: resolved, totalAmount, status: "confirmed",
      }).returning();
      if (!orders[0]) throw new Error("No se pudo crear el pedido");
      await tx.update(schema.cart).set({ status: "converted", updatedAt: new Date() })
        .where(scoped(schema.cart.organizationId, organizationId, eq(schema.cart.id, cart.id)));
      return { ok: true as const, order: orders[0], items: resolved };
    });
    if (!result.ok) return result;
    commitMemoryOrderStock(organizationId, result.items);
    return { ok: true as const, order: result.order };
  } catch (error) {
    if (error instanceof StockChangedError) {
      return { ok: false as const, error: "stock_changed" as const,
        productId: error.productId, available: error.available, requested: error.requested };
    }
    if (error instanceof CartLimitError) {
      return { ok: false as const, error: "tenant_limit_exceeded" as const, limit: error.limit };
    }
    if (error instanceof InvalidCartError) return { ok: false as const, error: "invalid_cart" as const };
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

class InvalidCartError extends Error {}
class CartLimitError extends Error {
  constructor(public limit: number) { super("tenant_limit_exceeded"); }
}

class StockChangedError extends Error {
  constructor(public productId: string, public available: number, public requested: number) {
    super("stock_changed");
  }
}
