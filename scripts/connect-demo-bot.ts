import { getDb } from "../src/lib/db/index";
import * as schema from "../src/lib/db/schema";
import { encryptSecret } from "../src/lib/crypto";
import { withTenantTransaction } from "../src/lib/db/context";
import { eq } from "drizzle-orm";
import "./enforce-ipv4";
import { readFileSync } from "node:fs";

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
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN no está en .env");

  const enc = encryptSecret(botToken);
  const botId = Number(process.env.TELEGRAM_BOT_ID ?? 8813112776);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "ventamaxiabot";
  const db = getDb();

  const existing = await db
    .select({ id: schema.telegramIntegration.id })
    .from(schema.telegramIntegration)
    .where(eq(schema.telegramIntegration.organizationId, "org_x3jnpp3eyk6h608shh3k"))
    .limit(1);

  if (existing.length > 0) {
    await db.update(schema.telegramIntegration)
      .set({
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        botId,
        botUsername,
        status: "connected",
        updatedAt: new Date(),
      })
      .where(eq(schema.telegramIntegration.id, existing[0].id));
    console.log(`Credenciales de @${botUsername} (id ${botId}) guardadas cifradas.`);
  } else {
    throw new Error("No hay integración base para la org demo");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});