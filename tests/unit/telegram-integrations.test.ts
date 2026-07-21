import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramWebhookToken,
  findTelegramIntegrationByWebhookToken,
  hashTelegramWebhookToken,
  registerTelegramWebhookReceipt,
} from "@/server/telegram/integrations";

const rows: Record<string, unknown>[] = [];
const inserted: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  schema: {
    telegramIntegration: { id: "id", organizationId: "organization_id", webhookTokenHash: "webhook_token_hash" },
    telegramWebhookReceipt: {
      id: "id",
      organizationId: "organization_id",
      integrationId: "integration_id",
      updateId: "update_id",
      payloadHash: "payload_hash",
      status: "status",
      receivedAt: "received_at",
    },
  },
  getDb: () => ({
    select: () => ({
      from: (table: Record<string, unknown>) => ({
        where: () => ({
          limit: () => Promise.resolve(
            table.webhookTokenHash === "webhook_token_hash"
              ? rows.filter((row) => "webhookTokenHash" in row)
              : rows.filter((row) => "updateId" in row)
          ),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const exists = rows.some(
              (row) => row.organizationId === value.organizationId && row.updateId === value.updateId
            );
            if (exists) return Promise.resolve([]);
            rows.push(value);
            inserted.push(value);
            return Promise.resolve([value]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));

describe("integraciones Telegram", () => {
  beforeEach(() => {
    rows.length = 0;
    inserted.length = 0;
    updates.length = 0;
  });

  it("crea tokens opacos y solo compara su hash", () => {
    const token = createTelegramWebhookToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(hashTelegramWebhookToken(token)).toHaveLength(64);
    expect(hashTelegramWebhookToken(token)).not.toBe(token);
  });

  it("resuelve la organización exclusivamente por el hash del token", async () => {
    const token = "token-ruta-seguro";
    rows.push({
      id: "tgi_1",
      organizationId: "org_telegram",
      webhookTokenHash: hashTelegramWebhookToken(token),
    });

    await expect(findTelegramIntegrationByWebhookToken(token)).resolves.toMatchObject({
      id: "tgi_1",
      organizationId: "org_telegram",
    });
    rows.length = 0;
    await expect(findTelegramIntegrationByWebhookToken("otro-token")).resolves.toBeNull();
  });

  it("registra una vez un update y distingue reintento de conflicto", async () => {
    const input = {
      organizationId: "org_telegram",
      integrationId: "tgi_1",
      updateId: 500,
      payloadHash: "hash_a",
    };
    await expect(registerTelegramWebhookReceipt(input)).resolves.toBe("received");
    await expect(registerTelegramWebhookReceipt(input)).resolves.toBe("duplicate");
    await expect(
      registerTelegramWebhookReceipt({ ...input, payloadHash: "hash_b" })
    ).resolves.toBe("conflict");

    expect(inserted).toHaveLength(1);
    expect(updates).toEqual([{ status: "conflict" }]);
  });
});
