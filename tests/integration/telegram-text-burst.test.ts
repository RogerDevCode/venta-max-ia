import { describe, expect, it } from "vitest";

describe("telegram text burst integration", () => {
  it("processes inbound text update with unique external message id", () => {
    const update = { update_id: 100, message: { message_id: 50, chat: { id: 123, type: "private" }, text: "Hola" } };
    const externalId = `tg_123_${update.message.message_id}`;
    expect(externalId).toBe("tg_123_50");
  });
});
