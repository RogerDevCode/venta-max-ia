import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/index";
import * as schema from "../src/lib/db/schema";
import { createHash } from "node:crypto";
import { newId } from "../src/lib/db/ids";
import { readFileSync } from "node:fs";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function loadEnv() {
  try {
    const file = readFileSync(".env", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      const separator = entry.indexOf("=");
      if (separator < 0) continue;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!process.env[key] && value) process.env[key] = value;
    }
  } catch {}
}

async function main() {
  loadEnv();
  const db = getDb();
  const orgId = "org_x3jnpp3eyk6h608shh3k";

  const plainToken = "O657BkPClI3AJe_5oc7OUIOwYf7I7A1yGUm2vibgCZM";
  const secretHeader = process.env.TELEGRAM_WEBHOOK_SECRET || "test-secret";

  const existing = await db
    .select({ id: schema.telegramIntegration.id })
    .from(schema.telegramIntegration)
    .where(eq(schema.telegramIntegration.organizationId, orgId));

  if (existing.length > 0) {
    console.log("Integración ya existe para la org; no se duplica.");
    return;
  }

  await db.insert(schema.telegramIntegration).values({
    id: newId("telegramIntegration"),
    organizationId: orgId,
    webhookTokenHash: hashToken(plainToken),
    webhookHeaderSecretHash: hashToken(secretHeader),
    status: "connected",
    botId: 555666777,
  });

  console.log("Integración Telegram de prueba creada para org Botilleria.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});