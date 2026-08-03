import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Cliente de BD único por proceso. En dev, Next recarga módulos: se cachea en
 * globalThis para no agotar conexiones.
 */
const globalForDb = globalThis as unknown as {
  __ventaMaxIaSql?: ReturnType<typeof postgres>;
  __ventaMaxIaAuthSql?: ReturnType<typeof postgres>;
  __ventaMaxIaIngressSql?: ReturnType<typeof postgres>;
};

function createClient(databaseUrl: string, max: number) {
  return postgres(databaseUrl, {
    max,
    onnotice: () => {},
  });
}

export function getSql() {
  if (!globalForDb.__ventaMaxIaSql) {
    // Las suites de integración administran fixtures transitorios y requieren
    // una conexión explícita distinta del rol de producción. Nunca se acepta
    // este escape fuera de NODE_ENV=test.
    const testUrl = process.env.NODE_ENV === "test"
      ? process.env.TEST_DATABASE_URL
      : undefined;
    globalForDb.__ventaMaxIaSql = createClient(testUrl ?? getEnv().APP_DATABASE_URL, 10);
  }
  return globalForDb.__ventaMaxIaSql;
}

export function getAuthSql() {
  if (!globalForDb.__ventaMaxIaAuthSql) {
    globalForDb.__ventaMaxIaAuthSql = createClient(getEnv().AUTH_DATABASE_URL, 5);
  }
  return globalForDb.__ventaMaxIaAuthSql;
}

export function getIngressSql() {
  if (!globalForDb.__ventaMaxIaIngressSql) {
    globalForDb.__ventaMaxIaIngressSql = createClient(getEnv().INGRESS_DATABASE_URL, 5);
  }
  return globalForDb.__ventaMaxIaIngressSql;
}

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export type Database = ReturnType<typeof drizzle<typeof schema>>;
type DatabaseContext = { db: Database; organizationId: string };
const databaseContext = new AsyncLocalStorage<DatabaseContext>();

export function getDb() {
  const contextual = databaseContext.getStore();
  if (contextual) return contextual.db;
  if (!cachedDb) cachedDb = drizzle(getSql(), { schema });
  return cachedDb;
}

export function runInDatabaseContext<T>(
  context: DatabaseContext,
  callback: () => Promise<T>,
): Promise<T> {
  return databaseContext.run(context, callback);
}

export function getDatabaseContext(): DatabaseContext | undefined {
  return databaseContext.getStore();
}

let cachedAuthDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function getAuthDb() {
  if (!cachedAuthDb) cachedAuthDb = drizzle(getAuthSql(), { schema });
  return cachedAuthDb;
}

export { schema };
