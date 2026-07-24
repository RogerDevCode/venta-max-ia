import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Script para rotar el secret del webhook de Telegram para una organización.
 * Uso: tsx scripts/rotate-telegram-webhook-secret.ts <organizationId>
 */
async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("Uso: pnpm tsx scripts/rotate-telegram-webhook-secret.ts <organizationId>");
    process.exit(1);
  }

  const db = getDb();
  const newSecret = crypto.randomBytes(32).toString("hex");

  const updated = await db.update(schema.telegramIntegration)
    .set({ webhookSecret: newSecret, updatedAt: new Date() })
    .where(scoped(schema.telegramIntegration.organizationId, orgId, eq(schema.telegramIntegration.organizationId, orgId)))
    .returning({ id: schema.telegramIntegration.id });

  if (updated.length === 0) {
    console.warn(`[WARN] No se encontró integración de Telegram activa para la organización: ${orgId}`);
  } else {
    console.log(`[OK] Webhook secret rotado exitosamente para la integración ${updated[0]!.id}`);
  }
}

main().catch((err) => {
  console.error("[-] Error rotando webhook secret:", err);
  process.exit(1);
});
