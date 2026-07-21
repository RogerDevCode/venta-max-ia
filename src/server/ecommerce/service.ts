import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export interface CartItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  name: string;
}

/**
 * Busca productos en el catálogo de la organización por nombre, SKU o descripción.
 */
export async function buscarProductos(input: {
  organizationId: string;
  query: string;
}) {
  const db = getDb();
  const { organizationId, query } = input;
  const qClean = query.trim();

  let condition: SQL<unknown> | undefined = scoped(
    schema.product.organizationId,
    organizationId,
    eq(schema.product.active, true)
  );

  if (qClean && qClean !== "*" && qClean.toLowerCase() !== "todo") {
    const pattern = `%${qClean}%`;
    const searchOr = or(
      ilike(schema.product.name, pattern),
      ilike(schema.product.sku, pattern),
      ilike(schema.product.description, pattern)
    );
    if (searchOr && condition) {
      condition = and(condition, searchOr);
    }
  }

  const productos = await db
    .select({
      id: schema.product.id,
      sku: schema.product.sku,
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
export async function agregarAlCarrito(input: {
  organizationId: string;
  conversationId: string;
  sku: string;
  cantidad?: number;
}) {
  const db = getDb();
  const { organizationId, conversationId, sku, cantidad = 1 } = input;

  // 1. Validar que el producto exista y esté activo en la organización
  const prodRows = await db
    .select()
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        and(eq(schema.product.sku, sku), eq(schema.product.active, true))
      )
    )
    .limit(1);

  const producto = prodRows[0];
  if (!producto) {
    return { ok: false as const, error: "producto_no_encontrado" };
  }

  // 2. Buscar si la conversación tiene un carrito activo
  const cartRows = await db
    .select()
    .from(schema.cart)
    .where(
      scoped(
        schema.cart.organizationId,
        organizationId,
        and(
          eq(schema.cart.conversationId, conversationId),
          eq(schema.cart.status, "active")
        )
      )
    )
    .limit(1);

  let carrito = cartRows[0];
  if (!carrito) {
    const nuevoId = newId("cart");
    const insertRows = await db
      .insert(schema.cart)
      .values({
        id: nuevoId,
        organizationId,
        conversationId,
        items: [],
        status: "active",
      })
      .returning();
    carrito = insertRows[0];
  }

  if (!carrito) {
    return { ok: false as const, error: "error_al_crear_carrito" };
  }

  // 3. Modificar lista de items (JSONB)
  const items = (carrito.items as CartItem[]) ?? [];
  const idx = items.findIndex((i) => i.sku === sku);
  if (idx >= 0 && items[idx]) {
    items[idx]!.quantity += cantidad;
  } else {
    items.push({
      sku: producto.sku,
      name: producto.name,
      unitPrice: producto.price,
      quantity: cantidad,
    });
  }

  // 4. Guardar carrito
  const updatedRows = await db
    .update(schema.cart)
    .set({ items, updatedAt: new Date() })
    .where(eq(schema.cart.id, carrito.id))
    .returning();

  const updatedCart = updatedRows[0] || carrito;

  return { ok: true as const, cart: updatedCart, product: producto };
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

  // 1. Buscar carrito activo
  const cartRows = await db
    .select()
    .from(schema.cart)
    .where(
      scoped(
        schema.cart.organizationId,
        organizationId,
        and(
          eq(schema.cart.conversationId, conversationId),
          eq(schema.cart.status, "active")
        )
      )
    )
    .limit(1);

  const carrito = cartRows[0];
  if (!carrito || !carrito.items || (carrito.items as CartItem[]).length === 0) {
    return { ok: false as const, error: "carrito_vacio" };
  }

  const items = carrito.items as CartItem[];
  const totalAmount = items.reduce(
    (acc, item) => acc + item.quantity * item.unitPrice,
    0
  );

  const orderNumber = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
  const orderId = newId("order");

  // 2. Crear pedido
  const orderRows = await db
    .insert(schema.order)
    .values({
      id: orderId,
      organizationId,
      conversationId,
      cartId: carrito.id,
      orderNumber,
      items,
      totalAmount,
      status: "confirmed",
    })
    .returning();

  const orderObj = orderRows[0];
  if (!orderObj) {
    return { ok: false as const, error: "error_al_crear_pedido" };
  }

  // 3. Convertir carrito
  await db
    .update(schema.cart)
    .set({ status: "converted", updatedAt: new Date() })
    .where(eq(schema.cart.id, carrito.id));

  return { ok: true as const, order: orderObj };
}
