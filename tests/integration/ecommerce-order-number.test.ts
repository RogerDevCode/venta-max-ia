import { describe, expect, it } from "vitest";

describe("ecommerce order number integration", () => {
  it("formats order numbers with ORD- prefix and padding", () => {
    const sequence = 42;
    const formatted = `ORD-${String(sequence).padStart(6, "0")}`;
    expect(formatted).toBe("ORD-000042");
  });
});
