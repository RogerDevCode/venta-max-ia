export function parsePositiveInteger(text: string): number | null {
  const clean = text.trim();
  if (!/^[1-9][0-9]*$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isSafeInteger(value) ? value : null;
}

export function customerProductLabel(product: { name: string; description: string | null }) {
  return [product.name.trim(), product.description?.trim()].filter(Boolean).join(" — ");
}
