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
const bundledMigrationsFolder = path.join(here, "drizzle");
const sourceMigrationsFolder = path.join(here, "..", "drizzle");
const migrationsFolder = process.env.MIGRATIONS_DIR ?? (
  existsSync(bundledMigrationsFolder) ? bundledMigrationsFolder : sourceMigrationsFolder
);

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
  const legacySchema = await sql.unsafe(`
    select
      to_regclass('public.meta_credentials') as meta_credentials,
      to_regclass('public.template') as template
  `);
  const hasMetaCredentials = legacySchema[0]?.meta_credentials !== null;
  const hasTemplates = legacySchema[0]?.template !== null;

  // En un bootstrap vacío las migraciones anteriores todavía no han creado
  // estas tablas. El journal completo las crea y luego 0014 las retira en la
  // misma secuencia, sin datos de cliente que respaldar. En cambio, una base
  // parcialmente migrada debe detenerse: intentar adivinar su estado puede
  // convertir una recuperación en pérdida de datos.
  if (!hasMetaCredentials && !hasTemplates) return;
  if (!hasMetaCredentials || !hasTemplates) {
    throw new Error(
      "Migration 0014 found a partial legacy WhatsApp schema; restore a verified backup before continuing"
    );
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

export async function runMigrations({ databaseUrl } = {}) {
  const url = databaseUrl ?? process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL es requerida");
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe("set role venta_owner");
      // pgvector forma parte del esquema versionado. Garantizar la extensión
      // antes del journal hace que un volumen nuevo sea reproducible y evita
      // que una migración falle a mitad de la inicialización por no reconocer
      // el tipo `vector`.
      await sql.unsafe("create extension if not exists vector");
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
