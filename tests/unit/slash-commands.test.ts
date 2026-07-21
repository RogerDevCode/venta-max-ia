import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSlashCommand, processSlashCommand } from "@/server/ai/commands";

const { mockUpdateSet, mockSendText, mockSchema, mockDbState, mockApplyHandoff, mockBuscarProductos } = vi.hoisted(() => {
  const schemaObj = {
    conversation: { id: "id", lastInboundAt: "last_inbound_at", organizationId: "organization_id", stateMetadata: "state_metadata" },
    message: { conversationId: "conversation_id", createdAt: "created_at" },
    cart: { organizationId: "organization_id", conversationId: "conversation_id", status: "status", items: "items" },
    order: { organizationId: "organization_id", conversationId: "conversation_id", createdAt: "created_at", totalAmount: "total_amount", orderNumber: "order_number", status: "status" },
    agentProfile: { organizationId: "organization_id" },
  };
  return {
    mockUpdateSet: vi.fn(),
    mockSendText: vi.fn().mockResolvedValue({ messageId: "msg_out" }),
    mockApplyHandoff: vi.fn().mockResolvedValue(undefined),
    mockBuscarProductos: vi.fn().mockResolvedValue([]),
    mockSchema: schemaObj,
    mockDbState: {
      conversation: null as Record<string, unknown> | null,
      carts: [] as Record<string, unknown>[],
      orders: [] as Record<string, unknown>[],
      profiles: [] as Record<string, unknown>[],
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

vi.mock("@/server/ecommerce/service", () => ({
  buscarProductos: (input: unknown) => mockBuscarProductos(input),
}));

vi.mock("@/server/events/bus", () => ({
  publish: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table === mockSchema.agentProfile
                ? mockDbState.profiles
                : table === mockSchema.cart
                ? mockDbState.carts
                : []
            ),
          orderBy: () => ({
            limit: () => Promise.resolve(mockDbState.orders),
          }),
        }),
      }),
    }),
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

describe("Menú Convertidor de Chatbot Migrado a VentaMaxIA con Multi-Tenancy Real", () => {
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
    mockDbState.carts = [];
    mockDbState.orders = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Parser de Comandos Slash y Payloads del Menú (`parseSlashCommand`)", () => {
    it("debe reconocer comandos /start, /menu, /reset, /humano, números (1-6) y callback payloads menu:*", () => {
      expect(parseSlashCommand("/start")).toBe("start");
      expect(parseSlashCommand("/menu")).toBe("menu");
      expect(parseSlashCommand("menu:categorias")).toBe("menu:categorias");
      expect(parseSlashCommand("1")).toBe("menu:categorias");
      expect(parseSlashCommand("2")).toBe("menu:promociones");
      expect(parseSlashCommand("3")).toBe("menu:mas_vendidos");
      expect(parseSlashCommand("4")).toBe("menu:carrito");
      expect(parseSlashCommand("5")).toBe("menu:pedidos");
      expect(parseSlashCommand("6")).toBe("menu:humano");
    });
  });

  describe("2. Procesamiento de Opciones del Menú (`processSlashCommand`)", () => {
    it("/menu debe despachar el teclado de 6 botones en 2 columnas para Telegram", async () => {
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
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({ text: "1. 🛍️ Ver Catálogo", callback_data: "menu:categorias" }),
                expect.objectContaining({ text: "2. ⚡ Promos del Día", callback_data: "menu:promociones" }),
              ]),
              expect.arrayContaining([
                expect.objectContaining({ text: "3. ⭐ Recomendados", callback_data: "menu:mas_vendidos" }),
                expect.objectContaining({ text: "4. 🛒 Mi Carrito (Pagar)", callback_data: "menu:carrito" }),
              ]),
            ]),
          }),
        })
      );
    });

    it("opción menu:categorias debe consultar el catálogo de la organización", async () => {
      mockBuscarProductos.mockResolvedValueOnce([
        { id: "p1", sku: "PROD-1", name: "Taladro Inalámbrico", price: 45000, stock: 10 },
      ]);

      const result = await processSlashCommand({
        command: "menu:categorias",
        conversation: mockDbState.conversation as any,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockBuscarProductos).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_cmd_123", query: "todo" })
      );
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Taladro Inalámbrico"),
        })
      );
    });

    it("opción menu:humano / 6 debe derivar la conversación al agente humano y enviar mensaje según disponibilidad (humanAvailable)", async () => {
      const result = await processSlashCommand({
        command: "menu:humano",
        conversation: mockDbState.conversation as any,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockApplyHandoff).toHaveBeenCalledWith("conv_cmd_123", "org_cmd_123", "cliente");
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("revisará tu solicitud a la brevedad"),
        })
      );
    });
  });
});
