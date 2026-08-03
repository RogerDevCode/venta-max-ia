/**
 * CLI del seed demo: `pnpm seed:demo` (local) o `node seed-demo.mjs` dentro
 * del contenedor. Acepta --force para recargar aunque haya datos.
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { getAuthDb, getDb, schema } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";
import { seedDemo, isDomainEmpty } from "@/server/seed/demo";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trim().startsWith("#")) {
      const key = line.slice(0, index).trim();
      if (!process.env[key]) process.env[key] = line.slice(index + 1).trim();
    }
  }
} catch {
  // En el contenedor las variables llegan por el entorno y no existe .env.
}

const orgs = await getAuthDb().select().from(schema.organization).limit(1);
const org = orgs[0];
if (!org) {
  console.error(
    "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
  );
  process.exit(1);
}

const force = process.argv.includes("--force");
const result = await withJobTransaction(org.id, async () => {
  const db = getDb();
  if (!force && !(await isDomainEmpty(db, org.id))) {
    throw new Error("La organización ya tiene datos. Usa --force para recargar la demo.");
  }
  return seedDemo(db, org.id);
});
if (!result) {
  console.error(
    "[seed] La organización ya tiene datos. Usa --force para recargar la demo."
  );
  process.exit(1);
}
console.log(
  `[seed] Ferretería El Martillo cargada: ${result.contacts} contactos, ${result.kbEntries} entradas de KB, 1 corrida de ejemplo`
);
process.exit(0);
