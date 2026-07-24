import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Telegram-only runtime surface", () => {
  it("removes WhatsApp and template API routes", () => {
    for (const path of [
      "src/app/api/webhooks/wa/[webhookToken]/route.ts",
      "src/app/api/settings/whatsapp/route.ts",
      "src/app/api/templates/route.ts",
      "src/app/api/conversations/[id]/messages/template/route.ts",
      "src/server/whatsapp/connect.ts",
      "src/lib/meta/client.ts",
    ]) expect(existsSync(path)).toBe(false);
  });

  it("keeps only the static disabled notice in WhatsApp settings", () => {
    const source = readFileSync("src/app/(app)/settings/whatsapp/page.tsx", "utf8");
    expect(source).toContain("WhatsApp (deshabilitado)");
    expect(source).not.toMatch(/fetch\(|<button|<input|<form/i);
  });
});
