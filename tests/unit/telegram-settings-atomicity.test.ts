import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCommerceSettings } from "@/server/ecommerce/settings";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

describe("telegram settings atomicity unit", () => {
  it("returns default commerce settings when none are configured", async () => {
    const settings = await getCommerceSettings("non_existent_org");
    expect(settings).toBeDefined();
    expect(settings.maxUnitsPerProduct).toBe(10);
  });
});
