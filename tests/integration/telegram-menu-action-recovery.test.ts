import { describe, expect, it } from "vitest";
import { decodeMenuCallback, encodeMenuCallback } from "@/server/telegram/menu-codec";

describe("telegram menu action recovery integration", () => {
  it("encodes and parses menu action callbacks with format integrity", () => {
    const instanceId = "tgm_12345678901234567890";
    const encoded = encodeMenuCallback(instanceId, 3);
    const parsed = decodeMenuCallback(encoded);
    expect(parsed).toEqual({ instanceId, optionIndex: 3 });
  });

  it("handles malformed or invalid callback strings gracefully", () => {
    expect(decodeMenuCallback("invalid_callback")).toBeNull();
    expect(decodeMenuCallback("")).toBeNull();
  });
});
