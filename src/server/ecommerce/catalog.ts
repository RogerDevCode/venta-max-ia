import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const MAX_CATEGORIES = 9;

export class CatalogError extends Error {
  constructor(
    public code:
      | "category_limit"
      | "general_protected"
      | "category_not_found"
      | "product_not_found"
      | "duplicate_category"
      | "duplicate_sku"
      | "invalid_category"
  ) {
    super(code);
  }
}

export type CategoryInput = { name: string; description?: string | null };
export type ProductInput = {
  sku?: string | null;
  name: string;
  description?: string | null;
  price: number;
  stock: number;
  active: boolean;
  categoryId: string;
};

function cleanName(name: string) {
  return name.trim().toLocaleLowerCase("es").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("es"));
}

export async function ensureGeneralCategory(organizationId: string) {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.category)
    .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.isGeneral, true)))
    .limit(1);
  if (existing[0]) return existing[0];
  try {
    const inserted = await db
      .insert(schema.category)
      .values({ id: newId("category"), organizationId, name: "General", description: "Categoría de respaldo", isGeneral: true })
      .returning();
    if (inserted[0]) return inserted[0];
  } catch {
    // Otra solicitud pudo crearla; la lectura posterior es la fuente de verdad.
  }
  const raced = await db
    .select()
    .from(schema.category)
    .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.isGeneral, true)))
    .limit(1);
  if (!raced[0]) throw new Error("No se pudo inicializar la categoría General");
  return raced[0];
}

export async function listCategories(organizationId: string) {
  await ensureGeneralCategory(organizationId);
  const db = getDb();
  return db
    .select({
      id: schema.category.id,
      name: schema.category.name,
      description: schema.category.description,
      isGeneral: schema.category.isGeneral,
    })
    .from(schema.category)
    .where(scoped(schema.category.organizationId, organizationId))
    .orderBy(desc(schema.category.isGeneral), asc(schema.category.name));
}

export async function createCategory(organizationId: string, input: CategoryInput) {
  const name = cleanName(input.name);
  if (name.toLowerCase() === "general") throw new CatalogError("general_protected");
  const db = getDb();
  await ensureGeneralCategory(organizationId);
  try {
    return await db.transaction(async (tx) => {
      const total = await tx.select({ value: count() }).from(schema.category)
        .where(scoped(schema.category.organizationId, organizationId));
      if ((total[0]?.value ?? 0) >= MAX_CATEGORIES) throw new CatalogError("category_limit");
      const rows = await tx.insert(schema.category).values({
        id: newId("category"), organizationId, name, description: input.description?.trim() || null,
      }).returning();
      if (!rows[0]) throw new Error("No se pudo crear la categoría");
      return rows[0];
    });
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    throw new CatalogError("duplicate_category");
  }
}

export async function updateCategory(organizationId: string, id: string, input: CategoryInput) {
  const db = getDb();
  const current = await db.select().from(schema.category)
    .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.id, id))).limit(1);
  if (!current[0]) throw new CatalogError("category_not_found");
  if (current[0].isGeneral) throw new CatalogError("general_protected");
  if (cleanName(input.name).toLowerCase() === "general") throw new CatalogError("general_protected");
  try {
    const rows = await db.update(schema.category).set({ name: cleanName(input.name), description: input.description?.trim() || null, updatedAt: new Date() })
      .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.id, id))).returning();
    if (!rows[0]) throw new CatalogError("category_not_found");
    return rows[0];
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    throw new CatalogError("duplicate_category");
  }
}

export async function deleteCategory(organizationId: string, id: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const current = await tx.select().from(schema.category)
      .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.id, id))).limit(1);
    if (!current[0]) throw new CatalogError("category_not_found");
    if (current[0].isGeneral) throw new CatalogError("general_protected");
    const general = await tx.select().from(schema.category)
      .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.isGeneral, true))).limit(1);
    if (!general[0]) throw new Error("La categoría General no existe");
    const moved = await tx.update(schema.product).set({ categoryId: general[0].id, updatedAt: new Date() })
      .where(scoped(schema.product.organizationId, organizationId, eq(schema.product.categoryId, id))).returning({ id: schema.product.id });
    await tx.delete(schema.category).where(scoped(schema.category.organizationId, organizationId, eq(schema.category.id, id)));
    return { movedProducts: moved.length };
  });
}

async function assertCategory(organizationId: string, categoryId: string) {
  const rows = await getDb().select({ id: schema.category.id }).from(schema.category)
    .where(scoped(schema.category.organizationId, organizationId, eq(schema.category.id, categoryId))).limit(1);
  if (!rows[0]) throw new CatalogError("invalid_category");
}

export async function listCatalogProducts(organizationId: string, categoryId?: string) {
  const db = getDb();
  const condition = categoryId ? and(eq(schema.product.categoryId, categoryId), eq(schema.product.active, true)) : undefined;
  return db.select().from(schema.product)
    .where(scoped(schema.product.organizationId, organizationId, condition)).orderBy(asc(schema.product.name));
}

export async function createProduct(organizationId: string, input: ProductInput) {
  await assertCategory(organizationId, input.categoryId);
  try {
    const rows = await getDb().insert(schema.product).values({ id: newId("product"), organizationId, ...input, description: input.description?.trim() || null, sku: input.sku?.trim() || null, name: input.name.trim() }).returning();
    if (!rows[0]) throw new Error("No se pudo crear el producto");
    return rows[0];
  } catch { throw new CatalogError("duplicate_sku"); }
}

export async function updateProduct(organizationId: string, id: string, input: ProductInput) {
  await assertCategory(organizationId, input.categoryId);
  try {
    const rows = await getDb().update(schema.product).set({ ...input, description: input.description?.trim() || null, sku: input.sku?.trim() || null, name: input.name.trim(), updatedAt: new Date() })
      .where(scoped(schema.product.organizationId, organizationId, eq(schema.product.id, id))).returning();
    if (!rows[0]) throw new CatalogError("product_not_found");
    return rows[0];
  } catch (err) { if (err instanceof CatalogError) throw err; throw new CatalogError("duplicate_sku"); }
}

export async function deleteProduct(organizationId: string, id: string) {
  const rows = await getDb().delete(schema.product).where(scoped(schema.product.organizationId, organizationId, eq(schema.product.id, id))).returning({ id: schema.product.id });
  if (!rows[0]) throw new CatalogError("product_not_found");
}
