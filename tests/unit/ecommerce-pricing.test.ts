import { describe, expect, it } from "vitest";
import { renderPriceDisclosure, repriceItems } from "@/server/ecommerce/pricing";

describe("automatic repricing", () => {
  it("discloses every historical price/source bucket", () => {
    const result = repriceItems([
      { productId: "p1", name: "Producto", presentation: "Caja", quantity: 2, unitPrice: 100, source: "cart:first" },
      { productId: "p1", name: "Producto", presentation: "Caja", quantity: 1, unitPrice: 200, source: "cart:second" },
    ], new Map([["p1", { id: "p1", name: "Producto", description: "Caja", price: 777 }]]));
    expect(result.priceChanges).toEqual([
      expect.objectContaining({ oldPrice: 100, newPrice: 777, quantity: 2, difference: 1354 }),
      expect.objectContaining({ oldPrice: 200, newPrice: 777, quantity: 1, difference: 577 }),
    ]);
    expect(renderPriceDisclosure(result.priceChanges, 2331)).toContain("Total definitivo: $2.331 CLP");
  });
});
