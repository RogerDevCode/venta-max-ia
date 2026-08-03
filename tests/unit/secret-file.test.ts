import { mkdtempSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSecret } from "@/lib/secret-file";

describe("resolveSecret", () => {
  it("rechaza doble fuente", () => {
    expect(() => resolveSecret("TOKEN", { TOKEN: "inline", TOKEN_FILE: "/tmp/x" }))
      .toThrow(/solo una fuente/);
  });

  it("rechaza archivos expuestos y enlaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "venta-secret-"));
    const secret = join(dir, "secret");
    writeFileSync(secret, "value\n", { mode: 0o600 });
    chmodSync(secret, 0o640);
    expect(() => resolveSecret("TOKEN", { TOKEN_FILE: secret })).toThrow(/0600/);
    chmodSync(secret, 0o600);
    const link = join(dir, "link");
    symlinkSync(secret, link);
    expect(() => resolveSecret("TOKEN", { TOKEN_FILE: link })).toThrow(/enlace/);
  });

  it("lee un archivo privado", () => {
    const dir = mkdtempSync(join(tmpdir(), "venta-secret-"));
    const secret = join(dir, "secret");
    writeFileSync(secret, "value\n", { mode: 0o600 });
    expect(resolveSecret("TOKEN", { TOKEN_FILE: secret })).toBe("value");
  });
});
