import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

describe("whatsapp backup restore integration", () => {
  it("binds the destructive consent to the exact migration content", () => {
    const migration = path.join(process.cwd(), "drizzle", "0014_dear_zodiak.sql");
    const hash = createHash("sha256").update(readFileSync(migration)).digest("hex");
    expect(`0014:${hash}`).toMatch(/^0014:[a-f0-9]{64}$/);
  });

  it("requires an external restore manifest before retiring legacy WhatsApp data", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts", "migrate.mjs"), "utf8");
    expect(source).toContain("WHATSAPP_BACKUP_MANIFEST");
    expect(source).toContain("restoreDrill !== true");
    expect(source).toContain("WhatsApp backup checksum mismatch");
  });
});
