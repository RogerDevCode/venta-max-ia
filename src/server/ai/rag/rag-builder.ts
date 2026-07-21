import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { generateEmbedding } from "@/server/ai/rag/embeddings";
import { renderKb } from "@/server/ai/prompts";

type KbEntry = typeof schema.kbEntry.$inferSelect;

export interface VectorSearchResult {
  entry: KbEntry;
  similarity: number;
}

export interface RagContextResult {
  contextText: string;
  entries: KbEntry[];
  usedVectorSearch: boolean;
  similarities?: number[];
}

/**
 * Calcula la similitud coseno entre dos vectores numéricos.
 * Retorna un valor entre -1 y 1 (1 = vectores idénticos, 0 = ortogonales).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Realiza una búsqueda vectorial sobre la base de conocimiento de la organización
 * calculando similitud coseno entre el embedding de la consulta y los de `kbEntry`.
 */
export async function searchVectorKb(input: {
  organizationId: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  queryVector?: number[];
}): Promise<VectorSearchResult[]> {
  const topK = input.topK ?? 5;
  const minSim = input.minSimilarity ?? 0.65;
  const cleanQuery = input.query.trim();
  if (!cleanQuery && !input.queryVector) return [];

  let queryVec: number[];
  if (input.queryVector) {
    queryVec = input.queryVector;
  } else {
    queryVec = await generateEmbedding(cleanQuery);
  }

  const db = getDb();

  // Obtenemos las entradas con embedding no nulo de la organización
  // En PostgreSQL real (pgvector) y en mocks de Vitest obtenemos las filas
  // y aplicamos el cálculo dual (SQL + memoria) para que funcione en todos los entornos.
  const distanceSql = sql<number>`${schema.kbEntry.embedding} <=> ${JSON.stringify(queryVec)}::vector`;

  let rows: KbEntry[] = [];
  try {
    // Intento con consulta SQL con pgvector ordenado
    rows = await db
      .select()
      .from(schema.kbEntry)
      .where(
        and(
          eq(schema.kbEntry.organizationId, input.organizationId),
          isNotNull(schema.kbEntry.embedding)
        )
      )
      .orderBy(distanceSql)
      .limit(topK * 2); // Traer el doble para verificar similitud en memoria
  } catch {
    // Fallback si la base está en modo test genérico sin operador <=> de pgvector
    rows = await db
      .select()
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, input.organizationId));
  }

  const results: VectorSearchResult[] = [];

  for (const entry of rows) {
    if (!Array.isArray(entry.embedding) || entry.embedding.length === 0) continue;
    const sim = cosineSimilarity(queryVec, entry.embedding as number[]);
    if (sim >= minSim) {
      results.push({ entry, similarity: sim });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * Construye el contexto RAG formateado para inyectar en el System Prompt de IA.
 * Si la búsqueda vectorial encuentra coincidencias relevantes, retorna solo las top-K exactas.
 * Si no encuentra vectores (o si la consulta no arrojó resultados y fallback = true), retorna el KB tradicional o vacío.
 */
export async function buildRagContext(input: {
  organizationId: string;
  query?: string | null;
  topK?: number;
  minSimilarity?: number;
  fallbackToAllIfNoVectors?: boolean;
}): Promise<RagContextResult> {
  const query = input.query?.trim();

  if (query) {
    try {
      const vectorResults = await searchVectorKb({
        organizationId: input.organizationId,
        query,
        topK: input.topK,
        minSimilarity: input.minSimilarity,
      });

      if (vectorResults.length > 0) {
        const entries = vectorResults.map((r) => r.entry);
        const similarities = vectorResults.map((r) => r.similarity);
        return {
          contextText: renderKb(entries),
          entries,
          usedVectorSearch: true,
          similarities,
        };
      }
    } catch {
      // Si la generación de embedding falla (ej. sin token o modo sin conexión), caemos al fallback o vaciamos
    }
  }

  if (input.fallbackToAllIfNoVectors !== false) {
    const db = getDb();
    const allKb = await db
      .select()
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, input.organizationId))
      .orderBy(asc(schema.kbEntry.createdAt));

    return {
      contextText: renderKb(allKb),
      entries: allKb,
      usedVectorSearch: false,
    };
  }

  return {
    contextText: "(sin contexto relevante encontrado)",
    entries: [],
    usedVectorSearch: true,
  };
}
