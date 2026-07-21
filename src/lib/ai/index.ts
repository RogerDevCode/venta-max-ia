import type { z } from "zod";
import { getEnv, isAiConfigured } from "@/lib/env";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin PROVIDER_API_TOKEN configurado",
    };
  }
  const env = getEnv();
  const primaryModel =
    opts?.model ??
    (opts?.judge
      ? (env.PROVIDER_JUDGE_MODEL ?? env.OPENROUTER_JUDGE_MODEL ?? env.PROVIDER_MODEL ?? env.OPENROUTER_MODEL)
      : (env.MODEL_NAME ?? env.PROVIDER_MODEL ?? env.OPENROUTER_MODEL));
  const fallbackModel = opts?.judge
    ? (env.PROVIDER_JUDGE_FALLBACK_MODEL ?? env.OPENROUTER_JUDGE_FALLBACK_MODEL ?? env.FALLBACK_MODEL_1)
    : (env.FALLBACK_MODEL_1 ?? env.FALLBACK_MODEL_2);

  if (!primaryModel?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin PROVIDER_MODEL configurado",
    };
  }

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const currentModel = (attempt > 1 && fallbackModel?.trim()) ? fallbackModel : primaryModel;
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const raw = await callProvider(currentModel, attemptMessages, opts?.timeoutMs);
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[chatJson] intento ${attempt} (${currentModel}) falló: ${lastDetail}`);
        }
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[chatJson] intento ${attempt} (${currentModel}) falló: ${lastDetail}`);
        }
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[chatJson] intento ${attempt} (${currentModel}) falló por excepción: ${lastDetail}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<string> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const base = env.PROVIDER_BASE_URL || env.OPENROUTER_BASE_URL || "https://openrouter.ai/api";
  let baseUrl = `${base}/v1/chat/completions`;
  let apiKey = env.PROVIDER_API_TOKEN || env.PROVIDER_API_KEY || env.OPENROUTER_API_TOKEN || env.OPENROUTER_API_KEY || "";
  let targetModel = model;

  const isDeepseekModel = model.toLowerCase().includes("deepseek");
  const isGroqModel = model.toLowerCase().includes("groq");
  const isGeminiModel = model.toLowerCase().includes("gemini") && !model.toLowerCase().startsWith("openrouter/");

  if (isDeepseekModel || (base.includes("deepseek.com") && !isGroqModel && !isGeminiModel && !model.includes("/"))) {
    baseUrl = base.includes("deepseek.com") ? `${base.replace(/\/+$/, "")}/chat/completions` : "https://api.deepseek.com/chat/completions";
    if (env.DEEPSEEK_API_KEY) {
      apiKey = env.DEEPSEEK_API_KEY;
    }
    targetModel = model.replace(/^deepseek\//i, "");
  } else if (isGroqModel) {
    if (env.GROQ_API_KEY) {
      baseUrl = "https://api.groq.com/openai/v1/chat/completions";
      apiKey = env.GROQ_API_KEY;
      targetModel = model.replace(/^groq\//i, "");
    } else {
      const openRouterBase = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api";
      baseUrl = `${openRouterBase}/v1/chat/completions`;
      if (env.OPENROUTER_API_TOKEN || env.OPENROUTER_API_KEY) {
        apiKey = env.OPENROUTER_API_TOKEN || env.OPENROUTER_API_KEY || apiKey;
      }
      targetModel = model;
    }
  } else if (isGeminiModel && env.GEMINI_API_KEY) {
    baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    apiKey = env.GEMINI_API_KEY;
    targetModel = model.replace(/^(google|gemini)\//i, "");
  } else {
    baseUrl = `${base}/v1/chat/completions`;
    targetModel = model.replace(/^openrouter\//i, "");
  }

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: targetModel, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`proveedor respondió ${res.status}: ${truncate(text)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
