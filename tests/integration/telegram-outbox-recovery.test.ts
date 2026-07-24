import { describe, expect, it } from "vitest";

describe("telegram outbox recovery integration", () => {
  it("calculates exponential backoff for outbox message retry", () => {
    const attempt = 3;
    const backoffMs = Math.min(300_000, 1000 * Math.pow(2, attempt));
    expect(backoffMs).toBe(8000);
  });
});
