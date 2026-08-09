import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({
  rows: new Map<string, { maxUnitsPerProduct: number; autoExpirationHours: number }>()
}));

vi.mock("@/lib/db", () => ({
  schema: {
    commerceSettings: {
      organizationId: "organization_id",
      maxUnitsPerProduct: "max_units_per_product",
      autoExpirationHours: "auto_expiration_hours",
    }
  },
  getDb: () => ({
    select: () => ({ from: () => ({ where: (organizationId: string) => ({
      limit: () => {
        const val = rows.get(organizationId);
        return Promise.resolve(val === undefined ? [] : [val]);
      },
    }) }) }),
    insert: () => ({ values: (value: { organizationId: string; maxUnitsPerProduct: number; autoExpirationHours: number }) => ({
      onConflictDoUpdate: () => ({ returning: () => {
        rows.set(value.organizationId, {
          maxUnitsPerProduct: value.maxUnitsPerProduct,
          autoExpirationHours: value.autoExpirationHours,
        });
        return Promise.resolve([{
          maxUnitsPerProduct: value.maxUnitsPerProduct,
          autoExpirationHours: value.autoExpirationHours,
        }]);
      } }),
    }) }),
  }),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (_column: unknown, organizationId: string) => organizationId }));

import { getCommerceSettings, saveCommerceSettings } from "@/server/ecommerce/settings";

describe("commerce settings", () => {
  beforeEach(() => rows.clear());

  it("returns default values (maxUnits: 10, autoExpirationHours: 36) when tenant has no settings", async () => {
    await expect(getCommerceSettings("org_a")).resolves.toEqual({
      maxUnitsPerProduct: 10,
      autoExpirationHours: 36,
    });
  });

  it("keeps limits and auto-expiration isolated by tenant", async () => {
    await saveCommerceSettings("org_a", { maxUnitsPerProduct: 3, autoExpirationHours: 48 });
    await expect(getCommerceSettings("org_a")).resolves.toEqual({
      maxUnitsPerProduct: 3,
      autoExpirationHours: 48,
    });
    await expect(getCommerceSettings("org_b")).resolves.toEqual({
      maxUnitsPerProduct: 10,
      autoExpirationHours: 36,
    });
  });
});
