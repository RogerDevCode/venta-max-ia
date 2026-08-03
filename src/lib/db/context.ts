import { sql } from "drizzle-orm";
import {
  getDb,
  getDatabaseContext,
  runInDatabaseContext,
  type Database,
} from "@/lib/db";

const ACTORS = new Set(["user", "ingress", "job", "system"]);

export async function withTenantTransaction<T>(
  organizationId: string,
  userId: string | null,
  actorKind: "user" | "ingress" | "job" | "system",
  callback: () => Promise<T>,
): Promise<T> {
  if (!organizationId || organizationId.length > 160) {
    throw new Error("organizationId inválido");
  }
  if (!ACTORS.has(actorKind)) throw new Error("actorKind inválido");
  const current = getDatabaseContext();
  if (current) {
    if (current.organizationId !== organizationId) {
      throw new Error("No se permite cambiar de organización dentro de una transacción");
    }
    return callback();
  }

  return getDb().transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.user_id', ${userId ?? ""}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.actor_kind', ${actorKind}, true)`,
    );
    const contextualDb = transaction as unknown as Database;
    return runInDatabaseContext(
      { db: contextualDb, organizationId },
      callback,
    );
  });
}

export function withIngressTransaction<T>(
  organizationId: string,
  callback: () => Promise<T>,
): Promise<T> {
  return withTenantTransaction(organizationId, null, "ingress", callback);
}

export function withJobTransaction<T>(
  organizationId: string,
  callback: () => Promise<T>,
): Promise<T> {
  return withTenantTransaction(organizationId, null, "job", callback);
}
