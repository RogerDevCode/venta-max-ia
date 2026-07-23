import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: new Map<string, number>() }));

vi.mock("@/lib/db", () => ({
  schema: { commerceSettings: { organizationId: "organization_id", maxUnitsPerProduct: "max_units_per_product" } },
  getDb: () => ({
    select: () => ({ from: () => ({ where: (organizationId: string) => ({
      limit: () => {
        const value = rows.get(organizationId);
        return Promise.resolve(value === undefined ? [] : [{ maxUnitsPerProduct: value }]);
      },
    }) }) }),
    insert: () => ({ values: (value: { organizationId: string; maxUnitsPerProduct: number }) => ({
      onConflictDoUpdate: () => ({ returning: () => {
        rows.set(value.organizationId, value.maxUnitsPerProduct);
        return Promise.resolve([{ maxUnitsPerProduct: value.maxUnitsPerProduct }]);
      } }),
    }) }),
  }),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (_column: unknown, organizationId: string) => organizationId }));

import { getCommerceSettings, saveCommerceSettings } from "@/server/ecommerce/settings";

describe("commerce settings", () => {
  beforeEach(() => rows.clear());

  it("returns 10 when the tenant has no settings", async () => {
    await expect(getCommerceSettings("org_a")).resolves.toEqual({ maxUnitsPerProduct: 10 });
  });

  it("keeps limits isolated by tenant", async () => {
    await saveCommerceSettings("org_a", { maxUnitsPerProduct: 3 });
    await expect(getCommerceSettings("org_a")).resolves.toEqual({ maxUnitsPerProduct: 3 });
    await expect(getCommerceSettings("org_b")).resolves.toEqual({ maxUnitsPerProduct: 10 });
  });
});
