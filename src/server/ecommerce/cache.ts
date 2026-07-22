import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { type CartItem } from "@/server/ecommerce/service";

export type CachedCategory = {
  id: string;
  name: string;
  description: string | null;
  isGeneral: boolean;
};

export type CachedProduct = {
  id: string;
  sku: string | null;
  name: string;
  price: number;
  stock: number;
  description: string | null;
  categoryId: string;
  active: boolean;
  deletedAt: Date | null;
};

export type TenantCatalogCache = {
  categories: CachedCategory[];
  products: CachedProduct[];
  reservedStock: Map<string, number>; // SKU o ID -> cantidad reservada en carritos activos
  expiresAt: number;
  promise: Promise<TenantCatalogCache> | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const globalForCatalog = globalThis as unknown as {
  __catalogCache?: Map<string, TenantCatalogCache>;
};

export function getCatalogCacheMap(): Map<string, TenantCatalogCache> {
  if (!globalForCatalog.__catalogCache) {
    globalForCatalog.__catalogCache = new Map();
  }
  return globalForCatalog.__catalogCache;
}

/**
 * Invalida la caché en memoria de un tenant tras modificaciones del catálogo en la BD.
 */
export function invalidateCatalogCache(organizationId: string): void {
  getCatalogCacheMap().delete(organizationId);
}

/**
 * Dispara la precarga asíncrona no bloqueante del catálogo de un tenant en segundo plano.
 * Si ya hay una precarga en curso o una caché válida, no duplica el trabajo.
 */
export async function preloadCatalogCache(organizationId: string): Promise<TenantCatalogCache> {
  const map = getCatalogCacheMap();
  const existing = map.get(organizationId);

  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }
  if (existing && existing.promise) {
    return existing.promise;
  }

  const promise = (async () => {
    const db = getDb();

    // Consultas en paralelo no bloqueantes para categorías, productos activos y carritos activos
    const [categoriesRows, productsRows, activeCarts] = await Promise.all([
      db
        .select({
          id: schema.category.id,
          name: schema.category.name,
          description: schema.category.description,
          isGeneral: schema.category.isGeneral,
        })
        .from(schema.category)
        .where(scoped(schema.category.organizationId, organizationId))
        .orderBy(desc(schema.category.isGeneral), asc(schema.category.name)),

      db
        .select({
          id: schema.product.id,
          sku: schema.product.sku,
          name: schema.product.name,
          price: schema.product.price,
          stock: schema.product.stock,
          description: schema.product.description,
          categoryId: schema.product.categoryId,
          active: schema.product.active,
          deletedAt: schema.product.deletedAt,
        })
        .from(schema.product)
        .where(
          scoped(
            schema.product.organizationId,
            organizationId,
            and(eq(schema.product.active, true), isNull(schema.product.deletedAt))
          )
        )
        .orderBy(asc(schema.product.name)),

      db
        .select({
          items: schema.cart.items,
        })
        .from(schema.cart)
        .where(
          scoped(
            schema.cart.organizationId,
            organizationId,
            eq(schema.cart.status, "active")
          )
        ),
    ]);

    // Calcular stock reservado por SKUs/IDs en carritos activos
    const reservedStock = new Map<string, number>();
    for (const cartRow of activeCarts) {
      const items = (cartRow.items as CartItem[]) ?? [];
      for (const item of items) {
        if (!item.sku) continue;
        const current = reservedStock.get(item.sku) ?? 0;
        reservedStock.set(item.sku, current + (item.quantity || 1));
      }
    }

    const newEntry: TenantCatalogCache = {
      categories: categoriesRows,
      products: productsRows,
      reservedStock,
      expiresAt: Date.now() + CACHE_TTL_MS,
      promise: null,
    };

    map.set(organizationId, newEntry);
    return newEntry;
  })();

  const tempEntry: TenantCatalogCache = existing ?? {
    categories: [],
    products: [],
    reservedStock: new Map(),
    expiresAt: 0,
    promise,
  };
  tempEntry.promise = promise;
  map.set(organizationId, tempEntry);

  try {
    return await promise;
  } catch (err) {
    if (map.get(organizationId)?.promise === promise) {
      map.delete(organizationId);
    }
    throw err;
  }
}

/**
 * Obtiene la caché en memoria si está válida, o la carga instantáneamente.
 */
export async function getOrLoadCatalogCache(organizationId: string): Promise<TenantCatalogCache> {
  const existing = getCatalogCacheMap().get(organizationId);
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }
  if (existing && existing.promise) {
    return existing.promise;
  }
  return preloadCatalogCache(organizationId);
}

/**
 * Actualiza en memoria el stock reservado cuando se agrega o modifica un carrito.
 */
export function updateMemoryCartReservation(
  organizationId: string,
  skuOrId: string,
  deltaQuantity: number
): void {
  const cached = getCatalogCacheMap().get(organizationId);
  if (!cached || cached.expiresAt <= Date.now()) return;
  const current = cached.reservedStock.get(skuOrId) ?? 0;
  const next = Math.max(0, current + deltaQuantity);
  if (next === 0) {
    cached.reservedStock.delete(skuOrId);
  } else {
    cached.reservedStock.set(skuOrId, next);
  }
}

/**
 * Actualiza en memoria el stock final de un producto y libera la reserva en carrito al confirmar un pedido.
 */
export function commitMemoryOrderStock(
  organizationId: string,
  items: CartItem[]
): void {
  const cached = getCatalogCacheMap().get(organizationId);
  if (!cached || cached.expiresAt <= Date.now()) return;

  for (const item of items) {
    if (!item.sku) continue;
    // Liberar reserva del carrito
    const currentReserved = cached.reservedStock.get(item.sku) ?? 0;
    const nextReserved = Math.max(0, currentReserved - item.quantity);
    if (nextReserved === 0) {
      cached.reservedStock.delete(item.sku);
    } else {
      cached.reservedStock.set(item.sku, nextReserved);
    }

    // Descontar del stock real en memoria del producto
    const prod = cached.products.find(
      (p) => p.sku === item.sku || p.id === item.sku
    );
    if (prod) {
      prod.stock = Math.max(0, prod.stock - item.quantity);
    }
  }
}
