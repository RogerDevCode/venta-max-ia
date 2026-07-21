import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit corre fuera de Next: carga .env manualmente si hace falta.
function loadDatabaseUrl(): string {
  try {
    const env = readFileSync(".env", "utf8");
    const line = env
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("DATABASE_URL="));
    if (line) return line.trim().slice("DATABASE_URL=".length).trim();
  } catch {}
  return process.env.DATABASE_URL || "";
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: loadDatabaseUrl(),
  },
});
