import { describe, expect, it } from "vitest";
import { normalizeCartItems } from "@/server/ecommerce/cart-normalizer";

const item = (productId: string, quantity: number, unitPrice = 100, source = "cart") => ({
  productId, quantity, unitPrice, source, name: productId, presentation: null,
});

describe("cart normalization", () => {
  it("aggregates equal buckets but preserves distinct price snapshots", () => {
    expect(normalizeCartItems([item("p1", 1), item("p1", 2), item("p1", 1, 200)], { maxUnitsPerProduct: 4 }))
      .toEqual([item("p1", 3), item("p1", 1, 200)]);
  });

  it("rejects a tenant limit bypass split over duplicated lines", () => {
    expect(() => normalizeCartItems([item("p1", 3), item("p1", 3)], { maxUnitsPerProduct: 3 }))
      .toThrow("tenant_limit_exceeded");
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid quantity %s", (quantity) => {
    expect(() => normalizeCartItems([item("p1", quantity)], { maxUnitsPerProduct: 10 })).toThrow();
  });
});
