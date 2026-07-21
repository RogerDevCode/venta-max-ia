import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Servicio de Generación y Chunking de Embeddings para RAG (Paso 3.1).
 */

export class EmbeddingError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Divide un texto en fragmentos (chunks) con superposición (overlap) para no perder
 * contexto semántico en las transiciones de párrafo/frase.
 */
export function chunkText(
  text: string,
  maxChars = 800,
  overlap = 150
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = start + maxChars;

    if (end < clean.length) {
      // Buscar punto, salto de línea o espacio hacia atrás para no cortar palabras
      const lastPeriod = clean.lastIndexOf(".", end);
      const lastNewline = clean.lastIndexOf("\n", end);
      const lastSpace = clean.lastIndexOf(" ", end);

      const splitPoint = Math.max(lastPeriod, lastNewline);
      if (splitPoint > start + maxChars * 0.5) {
        end = splitPoint + 1;
      } else if (lastSpace > start + maxChars * 0.5) {
        end = lastSpace;
      }
    }

    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

/**
 * Obtiene el vector de 1536 dimensiones del texto vía API (OpenRouter/OpenAI compatible).
 */
export async function generateEmbedding(
  text: string,
  opts?: { model?: string; token?: string; provider?: string }
): Promise<number[]> {
  const clean = text.trim();
  if (!clean) {
    throw new EmbeddingError("No se puede generar embedding de un texto vacío");
  }

  const env = getEnv();
  const explicitModel = opts?.model ?? env.EMBEDDING_MODEL;
  const explicitToken = opts?.token;
  const targetProvider = (opts?.provider || env.EMBEDDING_PROVIDER || "").toLowerCase();

  let url = "";
  let token = "";
  let model = "";
  let bodyPayload: unknown = {};
  let isGeminiNative = false;

  // 1. Google Gemini como principal por defecto (o si EMBEDDING_PROVIDER=gemini / EMBEDDING_MODEL es Gemini)
  if (
    (!explicitModel && !explicitToken && (!targetProvider || targetProvider === "gemini") && env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== "") ||
    targetProvider === "gemini" ||
    explicitModel?.toLowerCase().includes("gemini") ||
    explicitModel?.toLowerCase().includes("embedding-004") ||
    explicitModel?.toLowerCase().includes("embedding-2")
  ) {
    token = explicitToken ?? env.GEMINI_API_KEY ?? "";
    model = explicitModel ?? "gemini-embedding-2";
    const targetModel = model.startsWith("models/") ? model : `models/${model}`;
    url = `https://generativelanguage.googleapis.com/v1beta/${targetModel}:embedContent?key=${token}`;
    bodyPayload = {
      model: targetModel,
      content: { parts: [{ text: clean }] },
    };
    isGeminiNative = true;
  }
  // 2. NVIDIA NIM como fallback principal o si se solicita específicamente en variables de entorno
  else if (
    (!explicitModel && !explicitToken && targetProvider === "nvidia" && env.NVIDIA_API_KEY && env.NVIDIA_API_KEY.trim() !== "") ||
    targetProvider === "nvidia" ||
    explicitModel?.toLowerCase().includes("nvidia") ||
    explicitModel?.toLowerCase().includes("bge") ||
    explicitModel?.toLowerCase().includes("nv-embed")
  ) {
    url = "https://integrate.api.nvidia.com/v1/embeddings";
    token = explicitToken ?? env.NVIDIA_API_KEY ?? "";
    model = explicitModel ?? env.EMBEDDING_FALLBACK_MODEL ?? "nvidia/nv-embedqa-e5-v5";
    bodyPayload = { model, input: [clean], input_type: "query" };
  }
  // 3. Fallback genérico a OpenRouter / compatible
  else {
    token = explicitToken ?? env.PROVIDER_API_TOKEN ?? env.PROVIDER_API_KEY ?? env.OPENROUTER_API_TOKEN ?? env.OPENROUTER_API_KEY ?? "";
    if (!token) {
      throw new EmbeddingError("Sin token configurado para generación de embeddings");
    }
    model = explicitModel ?? "text-embedding-3-small";
    const rawBase = env.PROVIDER_BASE_URL || env.OPENROUTER_BASE_URL || "https://openrouter.ai/api";
    const baseUrl = rawBase.includes("deepseek.com") ? "https://openrouter.ai/api" : rawBase;
    url = `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
    bodyPayload = { model, input: clean };
  }

  let res: Response;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!isGeminiNative) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
    });
    // Si Gemini nativo (opción 1) falló en modo auto y hay key de NVIDIA, fallback automático a NVIDIA NIM
    if (!res.ok && !opts?.model && !opts?.token && isGeminiNative && env.NVIDIA_API_KEY && env.NVIDIA_API_KEY.trim() !== "") {
      url = "https://integrate.api.nvidia.com/v1/embeddings";
      token = env.NVIDIA_API_KEY;
      model = env.EMBEDDING_FALLBACK_MODEL ?? "nvidia/nv-embedqa-e5-v5";
      bodyPayload = { model, input: [clean], input_type: "query" };
      isGeminiNative = false;
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bodyPayload),
      });
    }
  } catch (cause) {
    throw new EmbeddingError("Error de red al contactar servicio de embeddings", cause);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new EmbeddingError(`El servicio respondió ${res.status}: ${errText}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw new EmbeddingError("Respuesta no-JSON al generar embeddings", cause);
  }

  const payload = json as {
    embedding?: { values?: number[] };
    data?: { embedding?: number[] }[];
  } | null;

  const rawEmbedding = payload?.embedding?.values ?? payload?.data?.[0]?.embedding;
  if (!Array.isArray(rawEmbedding) || rawEmbedding.length === 0) {
    throw new EmbeddingError("El payload del proveedor no contenía un vector válido");
  }

  // Alinear a 1536 dimensiones para compatibilidad pgvector intacta (corte o zero-padding conservan similitud coseno)
  const targetDims = 1536;
  const embedding = rawEmbedding.slice(0, targetDims);
  if (embedding.length < targetDims) {
    embedding.push(...Array(targetDims - embedding.length).fill(0));
  }

  return embedding;
}

/**
 * Guarda una entrada en el KB generando su vector de forma automática o recibiéndolo listo.
 */
export async function ingestKbEntryWithEmbedding(input: {
  organizationId: string;
  kind: "qa" | "block";
  question?: string | null;
  answer?: string | null;
  content?: string | null;
  embedding?: number[] | null;
}): Promise<{ id: string; embedding: number[] | null }> {
  const db = getDb();

  let embedding = input.embedding;
  if (embedding === undefined) {
    const textToEmbed =
      input.kind === "qa"
        ? `Pregunta: ${input.question}\nRespuesta: ${input.answer}`
        : input.content || "";
    try {
      if (textToEmbed.trim()) {
        embedding = await generateEmbedding(textToEmbed);
      } else {
        embedding = null;
      }
    } catch {
      // Si el proveedor no está disponible al guardar en un wizard/mock, permitimos null
      embedding = null;
    }
  }

  const id = newId("kbEntry");
  await db.insert(schema.kbEntry).values({
    id,
    organizationId: input.organizationId,
    kind: input.kind,
    question: input.question ?? null,
    answer: input.answer ?? null,
    content: input.content ?? null,
    embedding: embedding ?? null,
  });

  return { id, embedding: embedding ?? null };
}

/**
 * Fragmenta un texto largo e ingesta todos los chunks en el KB como bloques ("block")
 * calculando el vector para cada uno.
 */
export async function ingestLongTextAsBlocks(input: {
  organizationId: string;
  text: string;
  maxChars?: number;
  overlap?: number;
}): Promise<{ ids: string[]; chunks: string[] }> {
  const chunks = chunkText(input.text, input.maxChars, input.overlap);
  const ids: string[] = [];

  for (const chunk of chunks) {
    const res = await ingestKbEntryWithEmbedding({
      organizationId: input.organizationId,
      kind: "block",
      content: chunk,
    });
    ids.push(res.id);
  }

  return { ids, chunks };
}
