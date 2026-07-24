import type { CartPriceBucket } from "@/server/ecommerce/cart-normalizer";

export type PriceChange = {
  productId: string;
  name: string;
  presentation: string | null;
  source: string;
  oldPrice: number;
  newPrice: number;
  quantity: number;
  difference: number;
};

export type LockedProductPrice = {
  id: string;
  name: string;
  description: string | null;
  price: number;
};

export function repriceItems(items: CartPriceBucket[], products: Map<string, LockedProductPrice>) {
  const priceChanges: PriceChange[] = [];
  const repriced = items.map((item) => {
    const product = products.get(item.productId);
    if (!product) throw new Error(`product_not_found:${item.productId}`);
    if (item.unitPrice !== product.price) {
      priceChanges.push({
        productId: product.id,
        name: product.name,
        presentation: product.description?.trim() || null,
        source: item.source ?? "cart",
        oldPrice: item.unitPrice,
        newPrice: product.price,
        quantity: item.quantity,
        difference: (product.price - item.unitPrice) * item.quantity,
      });
    }
    return {
      ...item,
      name: product.name,
      presentation: product.description?.trim() || null,
      unitPrice: product.price,
    };
  });
  return { items: repriced, priceChanges };
}

const money = (value: number) => new Intl.NumberFormat("es-CL").format(value);

export function renderPriceDisclosure(changes: PriceChange[], total: number): string {
  const lines = changes.map((change) => {
    const presentation = change.presentation ? ` — ${change.presentation}` : "";
    const sign = change.difference >= 0 ? "+" : "−";
    return `• ${change.name}${presentation}: $${money(change.oldPrice)} → $${money(change.newPrice)} × ${change.quantity} (diferencia ${sign}$${money(Math.abs(change.difference))})`;
  });
  return [...lines, `Total definitivo: $${money(total)} CLP`].join("\n");
}
