import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMessage } from "@/lib/ai";

const { mockChatJson, mockBuildRagContext, mockDbState, mockSchema } = vi.hoisted(() => {
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
}));

vi.mock("@/server/ai/rag/rag-builder", () => ({
  buildRagContext: (input: unknown) => mockBuildRagContext(input),
}));

vi.mock("@/server/inbox/send", () => ({
  sendText: vi.fn().mockResolvedValue({ messageId: "msg_out" }),
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
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  }),
  schema: mockSchema,
}));

import { runAgentTurn } from "@/server/ai/pipeline";

describe("Inyección Dinámica de RAG en Pipeline del Agente (Paso 3.3)", () => {
  beforeEach(() => {
    mockChatJson.mockReset();
    mockBuildRagContext.mockReset();
    mockDbState.conversation = {
      id: "conv_rag_test",
      organizationId: "org_rag",
      handoffAt: null,
      aiEnabled: true,
      isTest: true,
    };
    mockDbState.profile = {
      name: "Asistente RAG",
      enabled: true,
    };
    mockDbState.history = [
      {
        id: "msg_in_1",
        direction: "in",
        text: "¿Cuál es la garantía del producto y los plazos de cambio?",
        createdAt: new Date(),
      },
    ];
    mockDbState.stages = [{ id: "s1", name: "Nuevo" }];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runAgentTurn invoca buildRagContext con la consulta del usuario e inyecta la evidencia en el system prompt", async () => {
    // Simulamos que el RAG recuperó una nota ultra específica con alta similitud
    mockBuildRagContext.mockResolvedValueOnce({
      contextText: "P: ¿Qué garantía tienen?\nR: Garantía total de 2 años con reemplazo inmediato en 48 hs.",
      entries: [
        {
          id: "kb_garantia",
          kind: "qa",
          question: "¿Qué garantía tienen?",
          answer: "Garantía total de 2 años con reemplazo inmediato en 48 hs.",
        }
      ],
      usedVectorSearch: true,
    });

    mockChatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Nuestros productos tienen 2 años de garantía total con reemplazo en 48 horas." },
    });

    await runAgentTurn("conv_rag_test");

    // Verificar que buildRagContext se llamó con la última pregunta entrante
    expect(mockBuildRagContext).toHaveBeenCalledWith({
      organizationId: "org_rag",
      query: "¿Cuál es la garantía del producto y los plazos de cambio?",
    });

    // Verificar que al LLM se le inyectó el System Prompt conteniendo la evidencia del RAG
    expect(mockChatJson).toHaveBeenCalledTimes(1);
    const messages = mockChatJson.mock.calls[0]![1] as ChatMessage[];
    const systemPrompt = messages.find((m) => m.role === "system")?.content || "";

    expect(systemPrompt).toContain("Eres \"Asistente RAG\"");
    expect(systemPrompt).toContain("CONOCIMIENTO DEL NEGOCIO");
    expect(systemPrompt).toContain("P: ¿Qué garantía tienen?\nR: Garantía total de 2 años con reemplazo inmediato en 48 hs.");
    expect(systemPrompt).toContain("Etapas del pipeline disponibles: Nuevo");
  });
});
