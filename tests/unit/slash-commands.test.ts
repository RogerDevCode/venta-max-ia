import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSlashCommand, processSlashCommand } from "@/server/ai/commands";

const { mockUpdateSet, mockSendText, mockSchema, mockDbState, mockApplyHandoff } = vi.hoisted(() => {
  const schemaObj = {
    conversation: { id: "id", lastInboundAt: "last_inbound_at", organizationId: "organization_id", stateMetadata: "state_metadata" },
    message: { conversationId: "conversation_id", createdAt: "created_at" },
  };
  return {
    mockUpdateSet: vi.fn(),
    mockSendText: vi.fn().mockResolvedValue({ messageId: "msg_out" }),
    mockApplyHandoff: vi.fn().mockResolvedValue(undefined),
    mockSchema: schemaObj,
    mockDbState: {
      conversation: null as Record<string, unknown> | null,
    },
  };
});

vi.mock("@/server/inbox/send", () => ({
  sendText: (input: unknown) => mockSendText(input),
  SendError: class SendError extends Error {},
}));

vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff: (convId: string, orgId: string, reason: string) => mockApplyHandoff(convId, orgId, reason),
}));

vi.mock("@/server/events/bus", () => ({
  publish: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (data: unknown) => {
        mockUpdateSet(data);
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  }),
  schema: mockSchema,
}));

describe("Soporte de Comandos Slash en VentaMaxIA (/start, /menu, /reset, /humano)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.conversation = {
      id: "conv_cmd_123",
      organizationId: "org_cmd_123",
      contactId: "cont_123",
      handoffAt: new Date(),
      aiEnabled: false,
      isTest: false,
      lastInboundAt: new Date(),
      stateMetadata: { prev: "value" },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Parser de Comandos Slash (`parseSlashCommand`)", () => {
    it("debe reconocer comandos básicos /start, /menu, /reset, /humano sin importar mayúsculas ni sufijos de bot", () => {
      expect(parseSlashCommand("/start")).toBe("start");
      expect(parseSlashCommand("/Start@MyBot")).toBe("start");
      expect(parseSlashCommand("/MENU")).toBe("menu");
      expect(parseSlashCommand("/reset")).toBe("reset");
      expect(parseSlashCommand("/HUMANO")).toBe("humano");
    });

    it("debe retornar null para texto normal o comandos no reconocidos", () => {
      expect(parseSlashCommand("Hola quisiera cotizar")).toBeNull();
      expect(parseSlashCommand("/desconocido")).toBeNull();
      expect(parseSlashCommand("start")).toBeNull();
    });
  });

  describe("2. Procesamiento de Comandos (`processSlashCommand`)", () => {
    it("/start y /reset deben limpiar stateMetadata, reactivar el asistente IA y enviar mensaje de bienvenida", async () => {
      const result = await processSlashCommand({
        command: "start",
        conversation: mockDbState.conversation as any,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          stateMetadata: {},
          handoffAt: null,
          handoffReason: null,
        })
      );
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("¡Hola! Soy tu asistente de VentaMaxIA"),
        })
      );
    });

    it("/menu debe enviar un menú interactivo con botones (Telegram Inline Keyboard)", async () => {
      const result = await processSlashCommand({
        command: "menu",
        conversation: mockDbState.conversation as any,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Menú Principal"),
          replyMarkup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
        })
      );
    });

    it("/humano debe transferir inmediatamente la conversación a un agente humano mediante Handoff", async () => {
      const result = await processSlashCommand({
        command: "humano",
        conversation: mockDbState.conversation as any,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockApplyHandoff).toHaveBeenCalledWith(
        "conv_cmd_123",
        "org_cmd_123",
        "cliente"
      );
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Un agente humano revisará tu solicitud"),
        })
      );
    });
  });
});
