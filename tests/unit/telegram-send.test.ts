import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOutbound, sendTelegramText } from "@/server/inbox/send";

const mockSendMessage = vi.fn();
const mockPublish = vi.fn();

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: (opts: unknown) => mockSendMessage(opts),
  sendChatAction: vi.fn().mockResolvedValue(true),
  TelegramApiError: class TelegramApiError extends Error {
    status = 400;
    description = "test error";
    isAuthError = false;
  },
}));

vi.mock("@/server/events/bus", () => ({
  publish: (orgId: string, event: unknown) => mockPublish(orgId, event),
}));

vi.mock("@/server/telegram/credentials", () => ({
  getTelegramCredentialsByOrg: vi.fn().mockResolvedValue({ token: "tenant-token", botId: 1, botUsername: "tenant_bot", status: "connected" }),
}));

const selectRows: unknown[][] = [];
const insertedMessages: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "orderBy"]) {
      chain[m] = () => chain;
    }
    chain.limit = () => Promise.resolve(rows);
    return chain;
  }

  return {
    getDb: () => ({
      select: () => makeChain(selectRows.shift() ?? []),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedMessages.push(v);
          return {
            returning: () =>
              Promise.resolve([
                { ...v, id: "msg_telegram_out_1", createdAt: new Date() },
              ]),
          };
        },
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    }),
    schema: {
      conversation: { contactId: "contactId", id: "id" },
      contact: { id: "id" },
      message: {},
    },
  };
});

describe("Envío de Menús y Teclados de Telegram (Paso 2.1)", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockPublish.mockReset();
    selectRows.length = 0;
    insertedMessages.length = 0;
  });

  it("sendTelegramText adjunta correctamente el menú (replyMarkup) y no viola el sandbox", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_tg_real",
          organizationId: "org_1",
          isTest: false,
        },
        contact: { id: "ct_1", phone: "987654321" },
      },
    ]);

    mockSendMessage.mockResolvedValueOnce({ message_id: 555 });

    const menu = {
      inline_keyboard: [
        [{ text: "📅 Reservar cita", callback_data: "action_reserve" }],
        [{ text: "📦 Ver catálogo", callback_data: "action_catalog" }],
      ],
    };

    const res = await sendTelegramText({
      conversationId: "cv_tg_real",
      organizationId: "org_1",
      text: "Elige una opción de nuestro menú:",
      replyMarkup: menu,
    });

    expect(res.messageId).toBe("msg_telegram_out_1");
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith({
      chatId: "987654321",
      text: "Elige una opción de nuestro menú:",
      parseMode: undefined,
      replyMarkup: menu,
      token: "tenant-token",
    });

    // Validar guardado en BD
    expect(insertedMessages.length).toBe(1);
    expect(insertedMessages[0]!.waMessageId).toBe("tg_987654321_555");
    expect(insertedMessages[0]!.direction).toBe("out");

    // Validar emisión SSE
    expect(mockPublish).toHaveBeenCalledWith("org_1", expect.objectContaining({ type: "message.new" }));
  });

  it("sendOutbound enruta a Telegram cuando se envía el parámetro menu", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_tg_menu",
          organizationId: "org_1",
          isTest: false,
        },
        contact: { id: "ct_1", phone: "111222333" },
      },
    ]);

    mockSendMessage.mockResolvedValueOnce({ message_id: 777 });

    const menu = {
      inline_keyboard: [[{ text: "Ayuda", callback_data: "help" }]],
    };

    await sendOutbound({
      conversationId: "cv_tg_menu",
      organizationId: "org_1",
      text: "Ayuda rápida:",
      menu,
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "111222333",
        replyMarkup: menu,
      })
    );
  });

  it("bloquea firmemente el envío si isTest = true (sandbox_violation)", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_tg_test",
          organizationId: "org_1",
          isTest: true, // Sandbox
        },
        contact: { id: "ct_1", phone: "999999999" },
      },
    ]);

    await expect(
      sendTelegramText({
        conversationId: "cv_tg_test",
        organizationId: "org_1",
        text: "Menú en test",
        replyMarkup: { inline_keyboard: [] },
      })
    ).rejects.toMatchObject({ code: "sandbox_violation" });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
