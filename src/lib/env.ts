import { z } from "zod";
import dns from "node:dns";
import { resolveSecret } from "@/lib/secret-file";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignorar si el runtime no soporta setDefaultResultOrder
}

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  APP_DATABASE_URL: z.string().min(1),
  AUTH_DATABASE_URL: z.string().min(1),
  INGRESS_DATABASE_URL: z.string().min(1),
  MIGRATOR_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  TELEGRAM_ADMIN_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  TELEGRAM_DURABLE_MODE: z.enum(["off", "shadow", "enforce"]).default("enforce"),
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
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(500),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  APP_DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  AUTH_DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  INGRESS_DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret-at-least-32-chars",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

let cached: Env | null = null;

const SECRET_NAMES = [
  "APP_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "INGRESS_DATABASE_URL",
  "MIGRATOR_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "ENCRYPTION_KEY",
] as const;

export function getEnvFrom(environment: Record<string, string | undefined>): Env {
  const isBuild = environment.NEXT_PHASE === "phase-production-build";
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(environment) }
    : stripEmpty(environment);
  for (const name of SECRET_NAMES) {
    const value = resolveSecret(name, environment);
    if (value !== undefined) source[name] = value;
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
  return parsed.data;
}

export function getEnv(): Env {
  if (!cached) cached = getEnvFrom(process.env);
  return cached;
}

function stripEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
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
