import dns from "node:dns";
import { eq } from "drizzle-orm";
import { getAuthDb, getDb, schema } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";
import { startTelegramReliabilityWorker, startDailySummaryWorker } from "@/server/telegram/worker";

try {
  dns.setDefaultResultOrder("ipv4first");
  const origLookup = dns.lookup;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dns.lookup = ((domain: any, options: any, callback: any) => {
    if (typeof options === "object" && options !== null) {
      if (!options.family) options.family = 4;
    } else if (typeof options === "function") {
      callback = options;
      options = { family: 4 };
    }
    return origLookup(domain, options, callback);
  }) as typeof dns.lookup;
} catch {
  // Ignorar si falla
}

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const organizations = await getAuthDb().select({ id: schema.organization.id }).from(schema.organization);
    const updated = (
      await Promise.all(
        organizations.map(({ id }) =>
          withJobTransaction(id, "cleanup-orphan", () =>
            getDb()
              .update(schema.agentTestRun)
              .set({
                status: "failed",
                error: "Interrumpida por un reinicio del servidor",
                finishedAt: new Date(),
              })
              .where(eq(schema.agentTestRun.status, "running"))
              .returning({ id: schema.agentTestRun.id }),
          ),
        ),
      )
    ).flat();
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

export async function startTelegramReliabilityRecovery(): Promise<void> {
  await startTelegramReliabilityWorker();
  startDailySummaryWorker();
}
