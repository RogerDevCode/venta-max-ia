/**
 * vitest.setup.ts — Setup global de variables de entorno para tests.
 *
 * Se ejecuta antes de que cualquier módulo de la aplicación se importe,
 * evitando que getEnv() lance por falta de variables.
 *
 * Para tests de integración: las URLs de BD apuntan a 127.0.0.1:5432
 * (base productiva local). Para tests unitarios: valores ficticios válidos.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

// 1. Cargar .env real y SOBREESCRIBIR variables de BD (ignorando el entorno heredado)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    
    // Si es una URL de base de datos, siempre sobrescribimos lo que traiga el shell.
    // Así evitamos heredar conexiones a Neon (cloud) por accidente.
    if (key && (key.includes("DATABASE_URL") || !process.env[key])) {
      process.env[key] = val;
    }
  }
} catch {
  // Si no hay .env (CI sin archivo), continuar con valores de fallback
}

// 2. Reemplazar hostnames de BD por 127.0.0.1:5432 para garantizar acceso local
const DB_HOST = "127.0.0.1";
const DB_PORT = "5432";

function forceLocalUrl(urlStr: string | undefined): string | undefined {
  if (!urlStr) return urlStr;
  try {
    const u = new URL(urlStr);
    u.hostname = DB_HOST;
    u.port = DB_PORT;
    u.searchParams.delete("sslmode");
    u.searchParams.delete("ssl");
    return u.toString();
  } catch {
    return urlStr
      .replace(/@[^/:]+(:\d+)?/g, `@${DB_HOST}:${DB_PORT}`)
      .replace(/(\?|&)sslmode=[^&]*/g, "")
      .replace(/(\?|&)ssl=[^&]*/g, "");
  }
}

for (const key of ["APP_DATABASE_URL", "AUTH_DATABASE_URL", "INGRESS_DATABASE_URL",
                   "MIGRATOR_DATABASE_URL", "BACKUP_DATABASE_URL", "DATABASE_URL"]) {
  const forced = forceLocalUrl(process.env[key]);
  if (forced) process.env[key] = forced;
}

// 3. Garantías mínimas para tests estrictamente unitarios (sin BD real)
function setDefault(key: string, value: string) {
  if (!process.env[key]) process.env[key] = value;
}

setDefault("APP_BASE_URL", "http://localhost:3000");
setDefault("APP_DATABASE_URL", `postgresql://venta_app:test@${DB_HOST}:${DB_PORT}/vocero`);
setDefault("AUTH_DATABASE_URL", `postgresql://venta_auth:test@${DB_HOST}:${DB_PORT}/vocero`);
setDefault("INGRESS_DATABASE_URL", `postgresql://venta_ingress:test@${DB_HOST}:${DB_PORT}/vocero`);
setDefault("DATABASE_URL", `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/vocero`);
setDefault("BETTER_AUTH_SECRET", "setup-test-secret-suficiente-32x".padEnd(32, "x"));
setDefault("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
setDefault("META_WEBHOOK_VERIFY_TOKEN", "verify-test-setup");
setDefault("TELEGRAM_ADMIN_BOT_TOKEN", "000000000:AASetupTokenForTests00000000000000");
setDefault("TELEGRAM_API_BASE_URL", "https://api.telegram.org");
setDefault("TEST_DATABASE_URL", process.env.DATABASE_URL || `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/vocero`);

