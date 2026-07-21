import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRagContext,
  cosineSimilarity,
  searchVectorKb,
} from "@/server/ai/rag/rag-builder";

const mockGenerateEmbedding = vi.fn();

vi.mock("@/server/ai/rag/embeddings", () => ({
  generateEmbedding: (text: string, opts?: unknown) => mockGenerateEmbedding(text, opts),
}));

const mockKbEntries: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Object.assign(Promise.resolve([...mockKbEntries]), {
            limit: () => Promise.resolve([...mockKbEntries]),
          }),
          // Si no llama a orderBy/limit en fallback
          then: (resolve: (rows: unknown[]) => unknown) => resolve([...mockKbEntries]),
        }),
      }),
    }),
  }),
  schema: {
    kbEntry: {
      organizationId: "organization_id",
      embedding: "embedding",
      createdAt: "created_at",
    },
  },
}));

describe("Búsqueda Vectorial por Similitud Coseno (Paso 3.2)", () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockKbEntries.length = 0;
  });

  it("cosineSimilarity calcula la precisión trigonométrica entre vectores de 1536 dimensiones", () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);

    const vecC = [0, 1, 0];
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0); // Ortogonales

    const vecD = [-1, 0, 0];
    expect(cosineSimilarity(vecA, vecD)).toBeCloseTo(-1.0); // Opuestos
  });

  it("searchVectorKb filtra y ordena por similitud coseno recuperando solo el top-K afín", async () => {
    mockKbEntries.push(
      {
        id: "kb_1_urgencias",
        organizationId: "org_dental",
        kind: "qa",
        question: "¿Tienen urgencias dentales?",
        answer: "Sí, atendemos urgencias 24/7 en la clínica central.",
        embedding: [1, 0, 0],
      },
      {
        id: "kb_2_blanqueamiento",
        organizationId: "org_dental",
        kind: "qa",
        question: "¿Cuánto cuesta el blanqueamiento?",
        answer: "El blanqueamiento láser cuesta $120.000 y toma 1 hora.",
        embedding: [0.9, 0.4, 0],
      },
      {
        id: "kb_3_servidores",
        organizationId: "org_dental",
        kind: "block",
        content: "Mantenimiento de servidores Linux y bases de datos PostgreSQL.",
        embedding: [0, 0, 1], // Completamente ortogonal (cero similitud)
      }
    );

    // Consulta del usuario simulada afín al blanqueamiento/urgencias
    mockGenerateEmbedding.mockResolvedValueOnce([0.95, 0.3, 0]);

    const results = await searchVectorKb({
      organizationId: "org_dental",
      query: "Quiero saber el precio del tratamiento de dientes blancos",
      topK: 2,
      minSimilarity: 0.65,
    });

    expect(results.length).toBe(2);
    // El primero o segundo deben ser blanqueamiento y urgencias, nunca servidores
    expect(results.map((r) => r.entry.id)).not.toContain("kb_3_servidores");
    expect(results[0]!.similarity).toBeGreaterThan(0.85);
  });

  it("buildRagContext retorna solo los fragmentos afines al usar búsqueda vectorial con alta similitud", async () => {
    mockKbEntries.push(
      {
        id: "kb_pizza",
        organizationId: "org_pizza",
        kind: "qa",
        question: "¿Hacen delivery?",
        answer: "Sí, enviamos pizzas calientes en 30 minutos.",
        embedding: [0.8, 0.6],
      },
      {
        id: "kb_irreg",
        organizationId: "org_pizza",
        kind: "block",
        content: "Código interno de contabilidad 9982-A",
        embedding: [0, 1],
      }
    );

    mockGenerateEmbedding.mockResolvedValueOnce([0.85, 0.5]);

    const rag = await buildRagContext({
      organizationId: "org_pizza",
      query: "¿Cuánto demoran en enviar el pedido a mi casa?",
      minSimilarity: 0.75,
    });

    expect(rag.usedVectorSearch).toBe(true);
    expect(rag.entries.length).toBe(1);
    expect(rag.entries[0]!.id).toBe("kb_pizza");
    expect(rag.contextText).toContain("P: ¿Hacen delivery?\nR: Sí, enviamos pizzas calientes");
    expect(rag.contextText).not.toContain("contabilidad");
  });

  it("buildRagContext hace fallback al KB completo si no hay consulta vectorial o no hay embeddings", async () => {
    mockKbEntries.push({
      id: "kb_general",
      organizationId: "org_general",
      kind: "block",
      content: "Información general del negocio sin vector.",
      embedding: null,
    });

    const rag = await buildRagContext({
      organizationId: "org_general",
      query: "",
    });

    expect(rag.usedVectorSearch).toBe(false);
    expect(rag.entries.length).toBe(1);
    expect(rag.contextText).toContain("Información general del negocio sin vector");
  });
});
