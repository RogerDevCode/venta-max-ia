/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { verifySchema } from "./verify-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "..", "drizzle");

async function requireDestructiveConsent(sql) {
  const file = readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(file);
  const entry = journal.entries.find((item) => String(item.tag).startsWith("0014_"));
  if (!entry) return;
  const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
  if (!existsSync(migrationPath)) throw new Error(`Missing destructive migration ${migrationPath}`);
  const contents = readFileSync(migrationPath);
  const hash = createHash("sha256").update(contents).digest("hex");
  const applied = await sql.unsafe(`select to_regclass('drizzle.__drizzle_migrations') as table_name`);
  if (applied[0]?.table_name) {
    const rows = await sql.unsafe(`select 1 from drizzle.__drizzle_migrations where hash=$1 limit 1`, [hash]);
    if (rows[0]) return;
  }
  const expected = `0014:${hash}`;
  if (process.env.CONFIRM_DROP_WHATSAPP_DATA !== expected) {
    throw new Error(`Migration 0014 requires CONFIRM_DROP_WHATSAPP_DATA=${expected}`);
  }
  const manifestPath = process.env.WHATSAPP_BACKUP_MANIFEST;
  if (!manifestPath || !existsSync(manifestPath)) {
    throw new Error("Migration 0014 requires WHATSAPP_BACKUP_MANIFEST from a verified external restore drill");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.restoreDrill !== true || !manifest.backupFile || !manifest.sha256 || !existsSync(manifest.backupFile)) {
    throw new Error("Invalid WhatsApp backup manifest");
  }
  const backupHash = createHash("sha256").update(readFileSync(manifest.backupFile)).digest("hex");
  if (backupHash !== manifest.sha256) throw new Error("WhatsApp backup checksum mismatch");
  const counts = await sql.unsafe(`select (select count(*)::int from meta_credentials) meta_credentials, (select count(*)::int from template) template`);
  if (Number(manifest.counts?.metaCredentials) !== counts[0]?.meta_credentials || Number(manifest.counts?.templates) !== counts[0]?.template) {
    throw new Error("WhatsApp backup manifest row counts do not match the source database");
  }
}

export async function runMigrations() {
  let url = process.env.DATABASE_URL;
  if (!url || url.includes("neon")) {
    url = "postgresql://postgres:postgres@127.0.0.1:5432/vocero";
  }
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await requireDestructiveConsent(sql);
      await migrate(drizzle(sql), { migrationsFolder });
      await verifySchema(sql);
      console.log("[migrate] migraciones aplicadas y verificadas");
      await sql.end();
      return;
    } catch (err) {
      await sql.end().catch(() => {});
      if (attempt === maxAttempts) throw err;
      console.error(`[migrate] intento ${attempt}/${maxAttempts} falló:`, err);
      console.log("[migrate] reintento en 2s…");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runMigrations().catch((error) => { console.error("[migrate] falló:", error); process.exitCode = 1; });
}
