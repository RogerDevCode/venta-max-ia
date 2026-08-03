import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isValidTelegramWebhookToken,
  processTelegramUpdate,
  type TelegramUpdate,
} from "@/server/inbox/telegram-webhook";

const insertedMessages: Record<string, unknown>[] = [];
const updatedConversations: Record<string, unknown>[] = [];
const mockPublish = vi.fn();
const { mockAcceptMenuCallback, mockRunMenuAction } = vi.hoisted(() => ({
  mockAcceptMenuCallback: vi.fn().mockResolvedValue({ accepted: true, action: "action_reserve", actionId: "tma_1" }),
  mockRunMenuAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/server/events/bus", () => ({
  publish: (orgId: string, event: unknown) => mockPublish(orgId, event),
}));

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/telegram/credentials", () => ({
  getTelegramCredentialsByOrg: vi.fn().mockResolvedValue({ token: "tenant-token", status: "connected" }),
}));

vi.mock("@/server/telegram/menu-guard", () => ({
  acceptTelegramMenuCallback: (...args: unknown[]) => mockAcceptMenuCallback(...args),
}));

vi.mock("@/server/telegram/menu-action-runner", () => ({
  runTelegramMenuAction: (...args: unknown[]) => mockRunMenuAction(...args),
}));

vi.mock("@/lib/telegram/client", () => ({
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
  sendChatAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/db", () => {
  const mockContact = { id: "cont_telegram_1", channel: "telegram", externalAddress: "123456789", name: "Juan Telegram" };
  const mockConversation = { id: "conv_telegram_1", contactId: "cont_telegram_1", organizationId: "org_1" };

  return {
    getDb: () => ({
      insert: (_table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          // Si es un message
          if ("externalMessageId" in v) {
            if (insertedMessages.some((m) => m.externalMessageId === v.externalMessageId)) {
              return {
                onConflictDoNothing: () => ({
                  returning: () => Promise.resolve([]),
                }),
              };
            }
            insertedMessages.push(v);
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([v]),
              }),
            };
          }
          // Si es contact o conversation
          if ("externalAddress" in v) {
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([mockContact]),
              }),
            };
          }
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([mockConversation]),
            }),
          };
        },
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            const resolveResults = () =>
              Promise.resolve(
                "externalAddress" in (table as Record<string, unknown>)
                  ? [mockContact]
                  : "position" in (table as Record<string, unknown>)
                    ? [{ id: "stage_1" }] // pipelineStage
                    : "contactId" in (table as Record<string, unknown>) && !("unreadCount" in (table as Record<string, unknown>))
                      ? [] // lead (vacío en este test para probar creación)
                      : [mockConversation]
              );
            return {
              limit: resolveResults,
              orderBy: () => ({ limit: resolveResults }),
            };
          },
        }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          updatedConversations.push(v);
          return {
            where: () => Promise.resolve(),
          };
        },
      }),
    }),
    schema: {
      contact: { organizationId: "org_id", channel: "channel", externalAddress: "external_address" },
      conversation: { organizationId: "org_id", contactId: "contact_id", isTest: "is_test", unreadCount: "unread_count" },
      message: { organizationId: "organization_id", integrationId: "integration_id", externalMessageId: "external_message_id" },
      lead: { id: "id", contactId: "contact_id", organizationId: "organization_id", lastInteractionAt: "last_interaction_at" },
      pipelineStage: { id: "id", organizationId: "organization_id", position: "position" },
    },
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-suficiente-para-tests".padEnd(32, "x");
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  mockAcceptMenuCallback.mockResolvedValue({ accepted: true, action: "action_reserve", actionId: "tma_1" });
  mockRunMenuAction.mockClear();
});

describe("Telegram Webhook Handler (Paso 1.2)", () => {
  it("valida el token en la ruta contra el secreto configurado", () => {
    expect(isValidTelegramWebhookToken("secret_token_abc", "secret_token_abc")).toBe(true);
    expect(isValidTelegramWebhookToken("token_equivocado", "secret_token_abc")).toBe(false);
    expect(isValidTelegramWebhookToken("", "secret_token_abc")).toBe(false);
    expect(isValidTelegramWebhookToken("secret_token_abc", undefined)).toBe(false);
  });

  it("procesa un Update de Telegram e inserta el mensaje idempotentemente en la BD", async () => {
    const update: TelegramUpdate = {
      update_id: 1001,
      message: {
        message_id: 888,
        from: {
          id: 123456789,
          is_bot: false,
          first_name: "Juan",
          last_name: "Telegram",
          username: "juantg",
        },
        chat: {
          id: 123456789,
          type: "private",
          first_name: "Juan",
          last_name: "Telegram",
        },
        date: 1780000000,
        text: "Hola, necesito información de sus servicios",
      },
    };

    await processTelegramUpdate({
      organizationId: "org_1", integrationId: "tgi_1",
      update,
    });

    expect(insertedMessages.length).toBe(1);
    const msg = insertedMessages[0]!;
    expect(msg.organizationId).toBe("org_1");
    expect(msg.conversationId).toBe("conv_telegram_1");
    expect(msg.externalMessageId).toBe("message:123456789:888");
    expect(msg.direction).toBe("in");
    expect(msg.type).toBe("text");
    expect(msg.text).toBe("Hola, necesito información de sus servicios");

    // Verificar que se publicó por el bus de eventos
    expect(mockPublish).toHaveBeenCalledWith("org_1", expect.objectContaining({ type: "message.new" }));
  });

  it("garantiza idempotencia si el mismo mensaje entra por duplicado", async () => {
    const updateDup: TelegramUpdate = {
      update_id: 1002,
      message: {
        message_id: 888, // Mismo message_id del test anterior
        chat: { id: 123456789, type: "private" },
        date: 1780000001,
        text: "Hola, necesito información de sus servicios",
      },
    };

    const countBefore = insertedMessages.length;
    await processTelegramUpdate({
      organizationId: "org_1", integrationId: "tgi_1",
      update: updateDup,
    });

    // No se inserta un segundo mensaje por idempotencia en tg_123456789_888
    expect(insertedMessages.length).toBe(countBefore);
  });

  it("acepta un callback vigente y entrega la acción durable al runner", async () => {
    const updateCb: TelegramUpdate = {
      update_id: 1003,
      callback_query: {
        id: "cb_query_999",
        from: {
          id: 123456789,
          is_bot: false,
          first_name: "Juan",
          last_name: "Telegram",
        },
        message: {
          message_id: 888,
          chat: { id: 123456789, type: "private" },
          date: 1780000010,
        },
        data: "m:tgm_0123456789abcdefghij:0",
      },
    };

    await processTelegramUpdate({
      organizationId: "org_1", integrationId: "tgi_1",
      update: updateCb,
    });

    expect(mockAcceptMenuCallback).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1", callbackQueryId: "cb_query_999", messageId: 888,
    }));
    expect(mockRunMenuAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: "tma_1" }));
  });

  it("ignora silenciosamente un callback viejo sin ejecutar efectos", async () => {
    mockAcceptMenuCallback.mockResolvedValueOnce({ accepted: false });
    await processTelegramUpdate({
      organizationId: "org_1", integrationId: "tgi_1",
      update: {
        update_id: 1004,
        callback_query: {
          id: "cb_stale",
          from: { id: 123456789, is_bot: false, first_name: "Juan" },
          message: { message_id: 700, chat: { id: 123456789, type: "private" }, date: 1780000020 },
          data: "m:tgm_0123456789abcdefghij:0",
        },
      },
    });
    expect(mockRunMenuAction).not.toHaveBeenCalled();
  });
});
