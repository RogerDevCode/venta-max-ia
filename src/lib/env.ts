import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  TELEGRAM_ADMIN_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
  PROVIDER_API_TOKEN: z.string().optional(),
  PROVIDER_API_KEY: z.string().optional(),
  PROVIDER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  PROVIDER_MODEL: z.string().optional(),
  PROVIDER_JUDGE_MODEL: z.string().optional(),
  PROVIDER_JUDGE_FALLBACK_MODEL: z.string().optional(),
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_FALLBACK_MODEL: z.string().optional(),
  MODEL_NAME: z.string().optional(),
  MODEL_DISPLAY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_THINKING: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  FALLBACK_MODEL_1: z.string().optional(),
  FALLBACK_MODEL_2: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_FALLBACK_MODEL: z.string().optional(),
  EMBEDDING_FALLBACK_PROVIDER: z.string().optional(),
  ALLOW_SIGNUP: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(1500),
  WA_MOCK_ENABLED: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

import { readFileSync } from "node:fs";

function loadLocalEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const file = readFileSync(".env", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (k && v !== undefined && v !== "") out[k] = v;
      }
    }
  } catch {}
  return out;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);

  // Si el shell inyectó una URL externa de neondb en dev/local (no en test/build), priorizamos DATABASE_URL del .env local
  if (!isBuild && process.env.NODE_ENV !== "test" && source.DATABASE_URL?.includes("neon")) {
    const localDb = loadLocalEnvFile().DATABASE_URL;
    if (localDb) source.DATABASE_URL = localDb;
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/** true si hay proveedor de IA configurado (token presente y no vacío). */
export function isAiConfigured(): boolean {
  const token =
    process.env.PROVIDER_API_TOKEN ||
    process.env.PROVIDER_API_KEY ||
    process.env.OPENROUTER_API_TOKEN ||
    process.env.OPENROUTER_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.NVIDIA_API_KEY;
  return typeof token === "string" && token.trim().length > 0;
}
