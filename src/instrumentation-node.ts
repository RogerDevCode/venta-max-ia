import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { drainTelegramMenuActions } from "@/server/telegram/menu-action-runner";

const workerGlobal = globalThis as unknown as { __telegramMenuRecoveryTimer?: NodeJS.Timeout };

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
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

export async function startTelegramMenuRecovery(): Promise<void> {
  await drainTelegramMenuActions().catch((error) =>
    console.error("[boot] recuperación de acciones Telegram falló:", error)
  );
  if (workerGlobal.__telegramMenuRecoveryTimer) return;
  const timer = setInterval(() => {
    void drainTelegramMenuActions().catch((error) =>
      console.error("[telegram] recuperación de acciones falló:", error)
    );
  }, 5_000);
  timer.unref();
  workerGlobal.__telegramMenuRecoveryTimer = timer;
}
