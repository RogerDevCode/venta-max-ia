import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const DEFAULT_MAX_UNITS_PER_PRODUCT = 10;

export async function getCommerceSettings(organizationId: string) {
  const rows = await getDb()
    .select({ maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct })
    .from(schema.commerceSettings)
    .where(scoped(schema.commerceSettings.organizationId, organizationId))
    .limit(1);
  return {
    maxUnitsPerProduct: rows[0]?.maxUnitsPerProduct ?? DEFAULT_MAX_UNITS_PER_PRODUCT,
  };
}

export async function saveCommerceSettings(
  organizationId: string,
  input: { maxUnitsPerProduct: number }
) {
  const rows = await getDb()
    .insert(schema.commerceSettings)
    .values({ organizationId, maxUnitsPerProduct: input.maxUnitsPerProduct })
    .onConflictDoUpdate({
      target: schema.commerceSettings.organizationId,
      set: { maxUnitsPerProduct: input.maxUnitsPerProduct, updatedAt: new Date() },
    })
    .returning({ maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct });
  if (!rows[0]) throw new Error("No se pudo guardar la configuración comercial");
  return rows[0];
}
