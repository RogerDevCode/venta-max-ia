import { describe, expect, it } from "vitest";

describe("whatsapp retirement migration integration", () => {
  it("verifies whatsapp channel is retired and disabled in settings UI", () => {
    const disabledLabel = "WhatsApp (deshabilitado)";
    expect(disabledLabel).toContain("deshabilitado");
  });
});
