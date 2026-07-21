import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage } from "@/lib/ai";
import { runAgentTurn } from "@/server/ai/pipeline";

const { mockChatJson, mockBuildRagContext, mockDbState, mockUpdateSet, mockSendText, mockSchema } =
  vi.hoisted(() => {
    const schemaObj = {
      conversation: { id: "id", lastInboundAt: "last_inbound_at", organizationId: "organization_id" },
      agentProfile: { organizationId: "organization_id" },
      message: { conversationId: "conversation_id", createdAt: "created_at" },
      pipelineStage: { organizationId: "organization_id", position: "position" },
      lead: { contactId: "contact_id", organizationId: "organization_id" },
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

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: (_n?: number) => {
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

describe("Acciones y Herramientas FSB en el Cerebro del Agente (Paso 4.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.conversation = {
      id: "conv_fsb",
      organizationId: "org_fsb",
      handoffAt: null,
      aiEnabled: true,
      isTest: false, // Para verificar envío con sendText
      lastInboundAt: new Date(),
      stateMetadata: { inicial: true },
    };
    mockDbState.profile = {
      name: "Asistente FSB",
      enabled: true,
    };
    mockDbState.history = [
      {
        id: "msg_in_1",
        direction: "in",
        text: "Quiero cotizar un plan empresarial para 50 personas",
        createdAt: new Date(),
      },
    ];
    mockDbState.stages = [{ id: "s1", name: "Contacto" }];
    mockBuildRagContext.mockResolvedValue({
      contextText: "KB info",
      entries: [],
      usedVectorSearch: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("actualizar_variable y enviar_menu_opciones son válidos según el esquema Zod AgentAction", async () => {
    const actualAgentAction = await vi.importActual<typeof import("@/server/ai/actions")>("@/server/ai/actions");
    const { AgentAction: RealAgentAction } = actualAgentAction;

    const actionVar = RealAgentAction.parse({
      action: "actualizar_variable",
      clave: "num_empleados",
      valor: 50,
      reply: "Entendido, 50 personas. ¿Cuál es su correo?",
    });
    expect(actionVar.action).toBe("actualizar_variable");

    const actionMenu = RealAgentAction.parse({
      action: "enviar_menu_opciones",
      titulo: "¿Qué servicio prefiere?",
      botones: [
        { texto: "Soporte Técnico", payload: "SOPORTE" },
        { texto: "Ventas / Cotización", payload: "VENTAS" },
      ],
    });
    expect(actionMenu.action).toBe("enviar_menu_opciones");
  });

  it("runAgentTurn ejecuta actualizar_variable persistiendo en stateMetadata el nuevo valor de la variable", async () => {
    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "actualizar_variable",
        clave: "intencion",
        valor: "cotizar_plan_empresarial",
        reply: "Registré su interés por el plan empresarial.",
      },
    });

    await runAgentTurn("conv_fsb");

    expect(mockUpdateSet).toHaveBeenCalledWith({
      stateMetadata: {
        inicial: true,
        intencion: "cotizar_plan_empresarial",
      },
    });

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_fsb",
        text: "Registré su interés por el plan empresarial.",
        aiGenerated: true,
      })
    );
  });

  it("runAgentTurn ejecuta enviar_menu_opciones despachando las opciones como texto estructurado al cliente", async () => {
    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "enviar_menu_opciones",
        titulo: "Seleccione una opción escribiendo el número:",
        botones: [
          { texto: "Hablar con Ejecutivo", payload: "EXEC" },
          { texto: "Ver Catálogo PDF", payload: "CATALOGO" },
        ],
      },
    });

    await runAgentTurn("conv_fsb");

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_fsb",
        text: "Seleccione una opción escribiendo el número:\n\n1. Hablar con Ejecutivo\n2. Ver Catálogo PDF",
        aiGenerated: true,
      })
    );
  });
});
