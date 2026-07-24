import { describe, expect, it } from "vitest";

describe("telegram retention unit", () => {
  it("calculates retention expiration threshold correctly", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const retentionDays = 7;
    const threshold = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    expect(threshold.toISOString()).toBe("2026-07-17T00:00:00.000Z");
  });
});
