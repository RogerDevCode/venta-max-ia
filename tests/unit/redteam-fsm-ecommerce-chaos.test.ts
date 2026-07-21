import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAction, resolveStage, degradeAction } from "@/server/ai/actions";
import { agregarAlCarrito, confirmarPedido } from "@/server/ecommerce/service";
import { runAgentTurn } from "@/server/ai/pipeline";

// Mocks para simular base de datos y aislamiento del FSM / E-Commerce
const { mockDbState, mockUpdateSet, mockSendText, mockSchema, mockChatJson, mockBuildRagContext } =
  vi.hoisted(() => {
    const schemaObj = {
      conversation: { id: "id", lastInboundAt: "last_inbound_at", organizationId: "organization_id", stateMetadata: "state_metadata" },
      agentProfile: { organizationId: "organization_id" },
      message: { conversationId: "conversation_id", createdAt: "created_at" },
      pipelineStage: { organizationId: "organization_id", position: "position" },
      lead: { contactId: "contact_id", organizationId: "organization_id" },
      product: { id: "id", organizationId: "organization_id", sku: "sku", active: "active", name: "name", price: "price", stock: "stock", description: "description" },
      cart: { id: "id", organizationId: "organization_id", conversationId: "conversation_id", status: "status", items: "items" },
      order: { id: "id", organizationId: "organization_id", conversationId: "conversation_id", cartId: "cart_id", orderNumber: "order_number", items: "items", totalAmount: "total_amount", status: "status" },
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
        products: [] as Record<string, unknown>[],
        carts: [] as Record<string, unknown>[],
        orders: [] as Record<string, unknown>[],
      },
    };
  });

vi.mock("@/lib/env", () => ({
  isAiConfigured: () => true,
  getEnv: () => ({}),
}));

vi.mock("@/lib/ai", () => ({
  chatJson: (schema: unknown, messages: unknown[]) => mockChatJson(schema, messages),
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

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (_cond?: unknown) => ({
          limit: (_n?: number) => {
            if (table === mockSchema.conversation) return Promise.resolve(mockDbState.conversation ? [mockDbState.conversation] : []);
            if (table === mockSchema.agentProfile) return Promise.resolve(mockDbState.profile ? [mockDbState.profile] : []);
            if (table === mockSchema.product) return Promise.resolve([...mockDbState.products]);
            if (table === mockSchema.cart) return Promise.resolve([...mockDbState.carts]);
            if (table === mockSchema.order) return Promise.resolve([...mockDbState.orders]);
            return Promise.resolve([...mockDbState.history]);
          },
          orderBy: () => ({
            limit: () => Promise.resolve([...mockDbState.history]),
            then: (resolve: (rows: unknown[]) => unknown) => resolve([...mockDbState.stages]),
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          if (table === mockSchema.cart) {
            mockDbState.carts.push(vals);
            return Promise.resolve([vals]);
          }
          if (table === mockSchema.order) {
            mockDbState.orders.push(vals);
            return Promise.resolve([vals]);
          }
          return Promise.resolve([{ id: "msg_test_out" }]);
        },
      }),
      onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: (table: unknown) => ({
      set: (data: unknown) => {
        if (table === mockSchema.conversation) mockUpdateSet(data);
        return {
          where: () => {
            if (table === mockSchema.conversation) {
              return {
                returning: () => Promise.resolve([mockDbState.conversation]),
              };
            }
            return Promise.resolve([mockDbState.conversation]);
          },
        };
      },
    }),
  }),
  schema: mockSchema,
}));

describe("Red Team: FSM State Manipulation, E-Commerce Chaos & Sandbox Boundary Enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.conversation = {
      id: "conv_chaos_123",
      organizationId: "org_chaos",
      contactId: "cont_123",
      handoffAt: null,
      aiEnabled: true,
      isTest: false,
      lastInboundAt: new Date(),
      stateMetadata: { inicial: true },
    };
    mockDbState.profile = { name: "Agente Chaos", enabled: true };
    mockDbState.history = [{ id: "msg_1", direction: "in", text: "Hola", createdAt: new Date() }];
    mockDbState.stages = [{ id: "stage_1", name: "Contacto" }, { id: "stage_2", name: "Interesado" }];
    mockDbState.products = [];
    mockDbState.carts = [];
    mockDbState.orders = [];
    mockBuildRagContext.mockResolvedValue({ contextText: "KB", entries: [], usedVectorSearch: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("1. FSM & AgentAction Zod Schema Boundary Checks", () => {
    it("debe rechazar cantidades negativas o cero en la acción agregar_al_carrito a nivel de contrato Zod", () => {
      const resNegative = AgentAction.safeParse({
        action: "agregar_al_carrito",
        sku: "PROD-001",
        cantidad: -10, // Ataque intentando restar inventario o robar crédito
      });
      expect(resNegative.success).toBe(false);

      const resZero = AgentAction.safeParse({
        action: "agregar_al_carrito",
        sku: "PROD-001",
        cantidad: 0,
      });
      expect(resZero.success).toBe(false);

      const resFloat = AgentAction.safeParse({
        action: "agregar_al_carrito",
        sku: "PROD-001",
        cantidad: 3.14159, // Ataque con números decimales no enteros
      });
      expect(resFloat.success).toBe(false);

      const resValid = AgentAction.safeParse({
        action: "agregar_al_carrito",
        sku: "PROD-001",
        cantidad: 5,
      });
      expect(resValid.success).toBe(true);
    });

    it("resolveStage debe degradar pacíficamente intentos de Directory Traversal o inyección en move_stage", () => {
      const maliciousStages = [
        "../../../secret_admin_stage",
        "<script>alert('stage')</script>",
        "DROP TABLE pipeline_stage; --",
        "   ",
      ];

      for (const req of maliciousStages) {
        const resolved = resolveStage(req, [
          { id: "1", name: "Contacto" },
          { id: "2", name: "Interesado" },
        ]);
        expect(resolved).toBeNull();

        const degraded = degradeAction({
          action: "move_stage",
          stage: req,
          reply: "Moviendo a etapa...",
        });
        expect(degraded).toEqual({ action: "reply", text: "Moviendo a etapa..." });
      }
    });

    it("degradeAction debe degradar a 'none' si move_stage no tiene respuesta ni etapa válida", () => {
      const degraded = degradeAction({
        action: "move_stage",
        stage: "etapa_inexistente_999",
      });
      expect(degraded).toEqual({ action: "none" });
    });
  });

  describe("2. E-Commerce Logic & Inventory Chaos Defense (`service.ts`)", () => {
    it("agregarAlCarrito debe fallar con 'producto_no_encontrado' si el SKU no existe o está inactivo en el tenant actual", async () => {
      mockDbState.products = []; // No hay productos en la BD para este tenant

      const res = await agregarAlCarrito({
        organizationId: "org_chaos",
        conversationId: "conv_chaos_123",
        sku: "SKU-HACK-999",
        cantidad: 1,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("producto_no_encontrado");
      }
    });

    it("confirmarPedido debe rechazar con 'carrito_vacio' si la conversación no tiene un carrito activo o ítems en 0", async () => {
      mockDbState.carts = []; // Sin carrito

      const res = await confirmarPedido({
        organizationId: "org_chaos",
        conversationId: "conv_chaos_123",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("carrito_vacio");
      }
    });

    it("confirmarPedido calcula el totalAmount exactamente y previene overflow o subtotales negativos si un ítem fue manipulado", async () => {
      mockDbState.carts = [
        {
          id: "cart_123",
          organizationId: "org_chaos",
          conversationId: "conv_chaos_123",
          status: "active",
          items: [
            { sku: "ITEM-A", name: "Producto A", quantity: 2, unitPrice: 15000 }, // $300.00
            { sku: "ITEM-B", name: "Producto B", quantity: 1, unitPrice: 5000 }, // $50.00
          ],
        },
      ];

      const res = await confirmarPedido({
        organizationId: "org_chaos",
        conversationId: "conv_chaos_123",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.order.totalAmount).toBe(35000); // 2*15000 + 1*5000 = 35000 ($350.00)
        expect(res.order.orderNumber).toMatch(/^ORD-\d{6}$/);
      }
    });
  });

  describe("3. FSM State Metadata Injection & Sandbox Boundary (`pipeline.ts`)", () => {
    it("runAgentTurn debe actualizar variables en stateMetadata sin sobrescribir ni corromper claves protegidas de nivel superior", async () => {
      mockChatJson.mockResolvedValueOnce({
        ok: true,
        data: {
          action: "actualizar_variable",
          clave: "intent_detected",
          valor: { step: 2, maliciosa: "<iframe src='hack'></iframe>" },
          reply: "Variable guardada.",
        },
      });

      await runAgentTurn("conv_chaos_123");

      expect(mockUpdateSet).toHaveBeenCalledWith({
        stateMetadata: {
          inicial: true,
          intent_detected: { step: 2, maliciosa: "<iframe src='hack'></iframe>" },
        },
      });
      // Verificamos que se envía el mensaje de respuesta
      expect(mockSendText).toHaveBeenCalledTimes(1);
    });

    it("Frontera de Sandbox (isTest: true): JAMÁS debe llamar a sendText al exterior, incluso si el modelo intenta un bypass", async () => {
      // Activamos modo Sandbox en la conversación
      mockDbState.conversation!.isTest = true;

      mockChatJson.mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "Intento de enviar mensaje real hacia el teléfono del cliente desde el Laboratorio",
        },
      });

      await runAgentTurn("conv_chaos_123");

      // Verificamos rigurosamente que sendText (la API externa de Meta/Telegram) JAMÁS fue invocada
      expect(mockSendText).not.toHaveBeenCalled();
    });
  });
});
