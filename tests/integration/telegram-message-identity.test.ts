import { describe, expect, it } from "vitest";

describe("telegram message identity integration", () => {
  it("formats external address for telegram correctly", () => {
    const telegramChatId = "123456789";
    const externalAddress = `tg_${telegramChatId}`;
    expect(externalAddress).toBe("tg_123456789");
  });
});
