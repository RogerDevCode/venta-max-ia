import { describe, expect, it } from "vitest";
import { repriceItems, renderPriceDisclosure } from "@/server/ecommerce/pricing";

describe("ecommerce repricing integration", () => {
  it("detects catalog price changes and generates customer disclosure", () => {
    const cartItems = [{ productId: "p1", name: "Agua", presentation: null, quantity: 2, unitPrice: 1000 }];
    const catalogMap = new Map([["p1", { id: "p1", name: "Agua", description: null, price: 1200 }]]);

    const { items, priceChanges } = repriceItems(cartItems, catalogMap);
    expect(items[0]!.unitPrice).toBe(1200);
    expect(priceChanges).toHaveLength(1);

    const disclosure = renderPriceDisclosure(priceChanges, 2400);
    expect(disclosure).toContain("Agua");
    expect(disclosure).toContain("$1.000");
    expect(disclosure).toContain("$1.200");
  });
});
