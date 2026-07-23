import { describe, expect, it } from "vitest";
import { decodeMenuCallback, encodeMenuCallback } from "@/server/telegram/menu-codec";

describe("Telegram menu callback codec", () => {
  it("round-trips a compact menu instance and option index", () => {
    const encoded = encodeMenuCallback("tgm_0123456789abcdefghij", 35);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(64);
    expect(decodeMenuCallback(encoded)).toEqual({ instanceId: "tgm_0123456789abcdefghij", optionIndex: 35 });
  });

  it.each(["", "menu:cart", "m::0", "m:tgm_bad:-1", "m:tgm_bad:💣", `m:${"a".repeat(61)}:0`])(
    "rejects malformed callback %j",
    (value) => expect(decodeMenuCallback(value)).toBeNull()
  );

  it("rejects indexes outside the supported range", () => {
    expect(() => encodeMenuCallback("tgm_0123456789abcdefghij", -1)).toThrow();
    expect(() => encodeMenuCallback("tgm_0123456789abcdefghij", 1296)).toThrow();
  });
});
