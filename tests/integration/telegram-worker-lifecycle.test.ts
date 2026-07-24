import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startTelegramReliabilityWorker, telegramWorkerState } from "@/server/telegram/worker";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

describe("telegram worker lifecycle integration", () => {
  it("starts reliability worker and queries state without errors", async () => {
    await startTelegramReliabilityWorker();
    const state = telegramWorkerState();
    expect(state).toBeDefined();
    expect(state.lastError).toBeNull();
  });
});
