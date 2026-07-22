import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage } from "@/lib/ai";
import { runAgentTurn } from "@/server/ai/pipeline";
import * as ecommerceService from "@/server/ecommerce/service";

const { mockChatJson, mockBuildRagContext, mockDbState, mockUpdateSet, mockSendText, mockSchema } =
  vi.hoisted(() => {
    const schemaObj = {
      conversation: { id: "id", lastInboundAt: "last_inbound_at", organizationId: "organization_id" },
      agentProfile: { organizationId: "organization_id" },
      message: { conversationId: "conversation_id", createdAt: "created_at" },
      pipelineStage: { organizationId: "organization_id", position: "position" },
      lead: { contactId: "contact_id", organizationId: "organization_id" },
      cart: { id: "id", organizationId: "organization_id" },
      order: { id: "id", organizationId: "organization_id" },
    };
    return {
      mockChatJson: vi.fn(),
      mockBuildRagContext: vi.fn(),
      mockUpdateSet: vi.fn(),
      mockSendText: vi.fn().mockResolvedValue({ messageId: "msg_out" }),
      mockSchema: schemaObj,
      mockDbState: {
        conversation: null as Record<string, unknown> | null,
        profile: null as Record<string, unknown> | null,
        history: [] as Record<string, unknown>[],
        stages: [] as Record<string, unknown>[],
        leadUpdates: [] as Record<string, unknown>[],
      },
    };
  });

vi.mock("@/lib/env", () => ({
  isAiConfigured: () => true,
  getEnv: () => ({}),
}));

vi.mock("@/lib/ai", () => ({
  chatJson: (schema: unknown, messages: ChatMessage[]) => mockChatJson(schema, messages),
  AgentAction: vi.importActual("@/server/ai/actions").then((m: Record<string, unknown>) => m["AgentAction"]),
}));

vi.mock("@/server/ai/rag/rag-builder", () => ({
  buildRagContext: (input: unknown) => mockBuildRagContext(input),
}));

vi.mock("@/server/inbox/send", () => ({
  sendText: (input: unknown) => mockSendText(input),
  SendError: class SendError extends Error {},
}));

vi.mock("@/server/events/bus", () => ({
  publish: vi.fn(),
}));

vi.mock("@/server/ecommerce/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ecommerce/service")>();
  return {
    ...actual,
    buscarProductos: vi.fn(),
    agregarAlCarrito: vi.fn(),
    confirmarPedido: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === mockSchema.conversation) {
              return Promise.resolve(mockDbState.conversation ? [mockDbState.conversation] : []);
            }
            if (table === mockSchema.agentProfile) {
              return Promise.resolve(mockDbState.profile ? [mockDbState.profile] : []);
            }
            return Promise.resolve([...mockDbState.history]);
          },
          orderBy: () => ({
            limit: () => Promise.resolve([...mockDbState.history]),
            then: (resolve: (rows: unknown[]) => unknown) => resolve([...mockDbState.stages]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "msg_test_out" }]),
      }),
    }),
    update: (table: unknown) => ({
      set: (data: unknown) => {
        if (table === mockSchema.lead) {
          mockDbState.leadUpdates.push(data as Record<string, unknown>);
        } else {
          mockUpdateSet(data);
        }
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  }),
  schema: mockSchema,
}));

describe("Simulación E2E de Compra en E-Commerce con IA (Paso 5.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.conversation = {
      id: "conv_ecom",
      organizationId: "org_ecom",
      contactId: "ct_cliente",
      handoffAt: null,
      aiEnabled: true,
      isTest: false,
      lastInboundAt: new Date(),
      stateMetadata: {},
    };
    mockDbState.profile = {
      name: "Vendedor Bot",
      enabled: true,
    };
    mockDbState.history = [
      {
        id: "msg_in_1",
        direction: "in",
        text: "Quiero comprar 2 unidades del servicio dental de urgencia (SKU-DEN-01) y confirmar",
        createdAt: new Date(),
      },
    ];
    mockDbState.stages = [
      { id: "stg_1", name: "Contacto Inicial" },
      { id: "stg_pedido", name: "Interesado / Pedido" },
    ];
    mockDbState.leadUpdates = [];
    mockBuildRagContext.mockResolvedValue({
      contextText: "KB ecom",
      entries: [],
      usedVectorSearch: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. buscar_producto consulta el catálogo por SKU o nombre y responde con la lista al cliente", async () => {
    vi.mocked(ecommerceService.buscarProductos).mockResolvedValueOnce([
      {
        id: "prd_1",
        sku: "SKU-DEN-01",
        name: "Servicio Dental Urgencia",
        price: 3500000,
        stock: 10,
        description: "Atención inmediata 24/7",
      },
    ]);

    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "buscar_producto",
        query: "dental",
      },
    });

    await runAgentTurn("conv_ecom");

    expect(ecommerceService.buscarProductos).toHaveBeenCalledWith({
      organizationId: "org_ecom",
      query: "dental",
    });
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_ecom",
        text: expect.stringContaining("Servicio Dental Urgencia"),
        aiGenerated: true,
      })
    );
  });

  it("2. agregar_al_carrito añade el producto y responde confirmación de carrito", async () => {
    vi.mocked(ecommerceService.agregarAlCarrito).mockResolvedValueOnce({
      ok: true,
      cart: {
        id: "crt_1",
        organizationId: "org_ecom",
        conversationId: "conv_ecom",
        items: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      product: {
        id: "prd_1",
        organizationId: "org_ecom",
        categoryId: "cat_general",
        sku: "SKU-DEN-01",
        name: "Servicio Dental Urgencia",
        description: null,
        price: 3500000,
        stock: 10,
        active: true,
        metadata: {},
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "agregar_al_carrito",
        sku: "SKU-DEN-01",
        cantidad: 2,
        reply: "He añadido 2 unidades del Servicio Dental de Urgencia al carrito.",
      },
    });

    await runAgentTurn("conv_ecom");

    expect(ecommerceService.agregarAlCarrito).toHaveBeenCalledWith({
      organizationId: "org_ecom",
      conversationId: "conv_ecom",
      sku: "SKU-DEN-01",
      cantidad: 2,
    });
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_ecom",
        text: "He añadido 2 unidades del Servicio Dental de Urgencia al carrito.",
      })
    );
  });

  it("3. confirmar_pedido crea la orden formal en BD y ¡mueve automáticamente el lead a la etapa 'Interesado / Pedido' en el Kanban!", async () => {
    vi.mocked(ecommerceService.confirmarPedido).mockResolvedValueOnce({
      ok: true,
      order: {
        id: "ord_abc",
        organizationId: "org_ecom",
        conversationId: "conv_ecom",
        cartId: "crt_1",
        orderNumber: "ORD-777888",
        items: [],
        totalAmount: 7000000,
        status: "confirmed",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "confirmar_pedido",
        reply: "¡Pedido ORD-777888 confirmado! Nuestro equipo lo contactará.",
      },
    });

    await runAgentTurn("conv_ecom");

    expect(ecommerceService.confirmarPedido).toHaveBeenCalledWith({
      organizationId: "org_ecom",
      conversationId: "conv_ecom",
    });

    // Constatar que la tarjeta del Kanban se movió automáticamente a "Interesado / Pedido" (stg_pedido)
    expect(mockDbState.leadUpdates.length).toBeGreaterThan(0);
    expect(mockDbState.leadUpdates[0]!.stageId).toBe("stg_pedido");

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_ecom",
        text: "¡Pedido ORD-777888 confirmado! Nuestro equipo lo contactará.",
      })
    );
  });
});
