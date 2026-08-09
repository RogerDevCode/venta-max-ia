import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const DEFAULT_MAX_UNITS_PER_PRODUCT = 10;
export const DEFAULT_AUTO_EXPIRATION_HOURS = 36;

export async function getCommerceSettings(organizationId: string) {
  const rows = await getDb()
    .select({
      maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct,
      autoExpirationHours: schema.commerceSettings.autoExpirationHours,
    })
    .from(schema.commerceSettings)
    .where(scoped(schema.commerceSettings.organizationId, organizationId))
    .limit(1);
  return {
    maxUnitsPerProduct: rows[0]?.maxUnitsPerProduct ?? DEFAULT_MAX_UNITS_PER_PRODUCT,
    autoExpirationHours: rows[0]?.autoExpirationHours ?? DEFAULT_AUTO_EXPIRATION_HOURS,
  };
}

export async function saveCommerceSettings(
  organizationId: string,
  input: { maxUnitsPerProduct?: number; autoExpirationHours?: number }
) {
  const current = await getCommerceSettings(organizationId);
  const maxUnits = input.maxUnitsPerProduct ?? current.maxUnitsPerProduct;
  const expirationHours = input.autoExpirationHours ?? current.autoExpirationHours;

  const rows = await getDb()
    .insert(schema.commerceSettings)
    .values({
      organizationId,
      maxUnitsPerProduct: maxUnits,
      autoExpirationHours: expirationHours,
    })
    .onConflictDoUpdate({
      target: schema.commerceSettings.organizationId,
      set: {
        maxUnitsPerProduct: maxUnits,
        autoExpirationHours: expirationHours,
        updatedAt: new Date(),
      },
    })
    .returning({
      maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct,
      autoExpirationHours: schema.commerceSettings.autoExpirationHours,
    });
  if (!rows[0]) throw new Error("No se pudo guardar la configuración comercial");
  return rows[0];
}
