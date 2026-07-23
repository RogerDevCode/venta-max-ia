import { describe, expect, it } from "vitest";
import { retryDelayMs } from "@/server/telegram/menu-action-runner";

describe("Telegram menu action recovery", () => {
  it("uses bounded exponential retry backoff", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(5)).toBe(16_000);
    expect(retryDelayMs(99)).toBe(60_000);
  });
});
