import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("whatsapp retirement migration integration", () => {
  it("allows a clean bootstrap but rejects a partial legacy schema", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts", "migrate.mjs"), "utf8");
    expect(source).toContain("if (!hasMetaCredentials && !hasTemplates) return;");
    expect(source).toContain("partial legacy WhatsApp schema");
    expect(source).toContain("create extension if not exists vector");
  });
});
