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

    const [categoriesRows, productsRows] = await Promise.all([
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
    ]);

    const newEntry: TenantCatalogCache = {
      categories: categoriesRows,
      products: productsRows,
      expiresAt: Date.now() + CACHE_TTL_MS,
      promise: null,
    };

    map.set(organizationId, newEntry);
    return newEntry;
  })();

  const tempEntry: TenantCatalogCache = existing ?? {
    categories: [],
    products: [],
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
 * Actualiza en memoria el stock final después de confirmar un pedido.
 */
export function commitMemoryOrderStock(
  organizationId: string,
  items: CartItem[]
): void {
  const cached = getCatalogCacheMap().get(organizationId);
  if (!cached || cached.expiresAt <= Date.now()) return;

  for (const item of items) {
    const prod = cached.products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock = Math.max(0, prod.stock - item.quantity);
    }
  }
}
