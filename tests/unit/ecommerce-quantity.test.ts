import { describe, expect, it } from "vitest";
import { customerProductLabel, parsePositiveInteger } from "@/server/ecommerce/quantity";

describe("ecommerce quantity", () => {
  it("accepts only safe positive decimal integers", () => {
    expect(parsePositiveInteger("2")).toBe(2);
    for (const invalid of ["", "0", "-1", "+2", "2.5", "2e3", "dos", "2 unidades", "9007199254740992"]) {
      expect(parsePositiveInteger(invalid)).toBeNull();
    }
  });

  it("formats presentation without null", () => {
    expect(customerProductLabel({ name: "Agua", description: "1 litro" })).toBe("Agua — 1 litro");
    expect(customerProductLabel({ name: "Agua", description: null })).toBe("Agua");
  });
});
