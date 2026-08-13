import { describe, expect, it, vi, beforeEach } from "vitest";
import { formatSummaryMessage } from "@/server/telegram/daily-summary";
import { getMsUntilNextSummary } from "@/server/telegram/worker";

// We only want to test logic without actually connecting to the DB
vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    telegramIntegration: {},
    organization: {},
    conversation: {},
    contact: {},
    lead: {},
    order: {},
  }
}));

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: vi.fn()
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn(() => "decrypted-token")
}));

import { sendDailySummaryToAll } from "@/server/telegram/daily-summary";
import { getDb } from "@/lib/db";
import { sendMessage } from "@/lib/telegram/client";

describe("Daily Summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test_formatSummaryMessage_contains_org_name", () => {
    const msg = formatSummaryMessage({
      dateStr: "12 de agosto",
      businessName: "Super Empresa Limitada",
      conversations: 0,
      contacts: 0,
      activeLeads: 0,
      newOrders: 0
    });
    expect(msg).toContain("Super Empresa Limitada");
  });

  it("test_formatSummaryMessage_contains_metrics", () => {
    const msg = formatSummaryMessage({
      dateStr: "12 de agosto",
      businessName: "Empresa",
      conversations: 5,
      contacts: 10,
      activeLeads: 15,
      newOrders: 20
    });
    expect(msg).toContain("Conversaciones nuevas: 5");
    expect(msg).toContain("Contactos nuevos: 10");
    expect(msg).toContain("Leads activos (total): 15");
    expect(msg).toContain("Pedidos nuevos: 20");
  });

  it("test_getMsUntilNextSummary_is_positive", () => {
    const ms = getMsUntilNextSummary(8);
    expect(ms).toBeGreaterThan(0);
  });

  it("test_getMsUntilNextSummary_less_than_24h", () => {
    const ms = getMsUntilNextSummary(8);
    expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  it("test_sendDailySummaryToAll_skips_no_chat_id", async () => {
    const dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          notificationChatId: null,
          tokenCipher: "c",
          tokenIv: "i",
          tokenTag: "t",
          organizationId: "org-1"
        }
      ]),
      limit: vi.fn().mockResolvedValue([{ name: "Org 1" }]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getDb as any).mockReturnValue(dbMock);

    await sendDailySummaryToAll();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("test_sendDailySummaryToAll_error_does_not_throw", async () => {
    const dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((_condition) => {
        const result = [
          {
            notificationChatId: "123",
            tokenCipher: "c",
            tokenIv: "i",
            tokenTag: "t",
            organizationId: "org-1",
            count: 0
          }
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any).limit = vi.fn().mockResolvedValue([{ name: "Org 1" }]);
        return result;
      }),
      limit: vi.fn().mockResolvedValue([{ name: "Org 1" }]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getDb as any).mockReturnValue(dbMock);

    // Make sendMessage throw an error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sendMessage as any).mockRejectedValue(new Error("Telegram API Error"));

    // Should resolve without throwing
    await expect(sendDailySummaryToAll()).resolves.toBeUndefined();
  });
});
