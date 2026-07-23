import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSlashCommand, processPendingProductQuantity, processSlashCommand } from "@/server/ai/commands";

const { mockUpdateSet, mockSendText, mockSchema, mockDbState, mockApplyHandoff, mockBuscarProductos, mockListarCategorias, mockListCatalogProducts, mockGetProduct, mockAddProduct } = vi.hoisted(() => {
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
    mockListarCategorias: vi.fn().mockResolvedValue([]),
    mockListCatalogProducts: vi.fn().mockResolvedValue([]),
    mockGetProduct: vi.fn().mockResolvedValue(null),
    mockAddProduct: vi.fn(),
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
  listarCategorias: (...args: unknown[]) => mockListarCategorias(...args),
  listCatalogProducts: (...args: unknown[]) => mockListCatalogProducts(...args),
  getProductForCustomer: (...args: unknown[]) => mockGetProduct(...args),
  addProductToCart: (...args: unknown[]) => mockAddProduct(...args),
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
      expect(parseSlashCommand("1")).toBe("catalog:number:1");
      expect(parseSlashCommand("2")).toBe("catalog:number:2");
      expect(parseSlashCommand("3")).toBe("catalog:number:3");
      expect(parseSlashCommand("4")).toBe("catalog:number:4");
      expect(parseSlashCommand("5")).toBe("catalog:number:5");
      expect(parseSlashCommand("6")).toBe("catalog:number:6");
      expect(parseSlashCommand("catalog:product:prod_1")).toBe("catalog:product:prod_1");
    });
  });

  describe("2. Procesamiento de Opciones del Menú (`processSlashCommand`)", () => {
    it("/menu debe despachar el teclado de 6 botones en 2 columnas para Telegram", async () => {
      const result = await processSlashCommand({
        command: "menu",
        conversation: mockDbState.conversation as never,
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
      mockListarCategorias.mockResolvedValueOnce([
        { id: "cat_1", name: "Herramientas", description: null, isGeneral: false },
      ]);

      const result = await processSlashCommand({
        command: "menu:categorias",
        conversation: mockDbState.conversation as never,
        lastInboundWaId: "tg_12345",
      });

      expect(result.handled).toBe(true);
      expect(mockListarCategorias).toHaveBeenCalledWith("org_cmd_123");
      expect(mockSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Herramientas"),
        })
      );
    });

    it("enumera productos con presentación y botones sin exponer SKU ni null", async () => {
      mockListCatalogProducts.mockResolvedValueOnce([
        { id: "prod_1", name: "Coca-Cola", description: "2 litros", price: 2500, stock: 5, sku: "SKU-ADMIN" },
        { id: "prod_2", name: "Agua", description: null, price: 1000, stock: 4, sku: null },
      ]);
      await processSlashCommand({
        command: "catalog:category:cat_1",
        conversation: mockDbState.conversation as never,
        lastInboundWaId: "tg_12345",
      });
      const call = mockSendText.mock.calls.at(-1)?.[0] as { text: string; replyMarkup: unknown };
      expect(call.text).toContain("1. Coca-Cola — 2 litros — $2.500 CLP");
      expect(call.text).toContain("2. Agua — $1.000 CLP");
      expect(JSON.stringify(call)).not.toContain("SKU-ADMIN");
      expect(JSON.stringify(call)).not.toContain("null");
      expect(call.replyMarkup).toEqual({ inline_keyboard: [
        [{ text: "1. Coca-Cola — 2 litros", callback_data: "catalog:product:prod_1" }],
        [{ text: "2. Agua", callback_data: "catalog:product:prod_2" }],
        [{ text: "↩ Retornar", callback_data: "catalog:return" }, { text: "⌂ Inicio", callback_data: "catalog:home" }],
      ] });
    });

    it("selecciona por productId y solicita una cantidad escrita", async () => {
      mockGetProduct.mockResolvedValueOnce({
        id: "prod_1", categoryId: "cat_1", name: "Coca-Cola", description: "2 litros", price: 2500, stock: 5,
      });
      await processSlashCommand({
        command: "catalog:product:prod_1", conversation: mockDbState.conversation as never,
        lastInboundWaId: "tg_12345",
      });
      expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
        stateMetadata: expect.objectContaining({ current_state: "cart:awaiting_quantity", selectedProductId: "prod_1" }),
      }));
      expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
        text: "¿Cuántas unidades de Coca-Cola — 2 litros deseas agregar? Escribe un número.",
      }));
    });

    it("valida la cantidad y confirma el carrito", async () => {
      mockDbState.conversation!.stateMetadata = {
        current_state: "cart:awaiting_quantity", selectedProductId: "prod_1", catalogCategoryId: "cat_1",
      };
      mockAddProduct.mockResolvedValueOnce({
        ok: true, product: { name: "Coca-Cola", description: "2 litros" }, units: 2, totalAmount: 5000,
      });
      await expect(processPendingProductQuantity({
        conversation: mockDbState.conversation as never, text: "2", lastInboundWaId: "tg_12345",
      })).resolves.toBe(true);
      expect(mockAddProduct).toHaveBeenCalledWith(expect.objectContaining({ productId: "prod_1", quantity: 2 }));
      expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining("Agregamos Coca-Cola — 2 litros, cantidad 2"),
      }));
    });

    it("opción menu:humano / 6 debe derivar la conversación al agente humano y enviar mensaje según disponibilidad (humanAvailable)", async () => {
      const result = await processSlashCommand({
        command: "menu:humano",
        conversation: mockDbState.conversation as never,
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
