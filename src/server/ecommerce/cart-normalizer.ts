export type CartPriceBucket = {
  productId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  presentation: string | null;
  source?: string;
};

export class CartShapeError extends Error {
  constructor(public readonly code: "invalid_product" | "invalid_quantity" | "invalid_price" | "tenant_limit_exceeded") {
    super(code);
  }
}

export function aggregateAndValidateShape(items: CartPriceBucket[]): CartPriceBucket[] {
  const buckets = new Map<string, CartPriceBucket>();
  for (const item of items) {
    if (!item.productId) throw new CartShapeError("invalid_product");
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new CartShapeError("invalid_quantity");
    if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0) throw new CartShapeError("invalid_price");
    const source = item.source ?? "cart";
    const key = `${item.productId}\u0000${item.unitPrice}\u0000${source}`;
    const current = buckets.get(key);
    const quantity = (current?.quantity ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) throw new CartShapeError("invalid_quantity");
    buckets.set(key, { ...item, source, quantity });
  }
  return [...buckets.values()].sort((a, b) =>
    a.productId.localeCompare(b.productId) || a.unitPrice - b.unitPrice || (a.source ?? "").localeCompare(b.source ?? "")
  );
}

export function validateAdmission(items: CartPriceBucket[], options: { maxUnitsPerProduct: number }): void {
  const totals = new Map<string, number>();
  for (const item of aggregateAndValidateShape(items)) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  for (const total of totals.values()) {
    if (total > options.maxUnitsPerProduct) throw new CartShapeError("tenant_limit_exceeded");
  }
}

export function normalizeCartItems(items: CartPriceBucket[], options: { maxUnitsPerProduct: number }): CartPriceBucket[] {
  const normalized = aggregateAndValidateShape(items);
  validateAdmission(normalized, options);
  return normalized;
}
