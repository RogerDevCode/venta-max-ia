import { describe, expect, it } from "vitest";
import { normalizeCartItems } from "@/server/ecommerce/cart-normalizer";

describe("ecommerce cart reconciliation integration", () => {
  it("normalizes and merges duplicate items in active cart", () => {
    const rawItems = [
      { productId: "p1", name: "Agua", presentation: "500ml", quantity: 2, unitPrice: 1000 },
      { productId: "p1", name: "Agua", presentation: "500ml", quantity: 3, unitPrice: 1000 },
    ];
    const normalized = normalizeCartItems(rawItems, { maxUnitsPerProduct: 99 });
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.quantity).toBe(5);
  });
});
