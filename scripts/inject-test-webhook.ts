import { getDb } from "../src/lib/db/index";
import * as schema from "../src/lib/db/schema";
import { createHash } from "node:crypto";
import { newId } from "../src/lib/db/ids";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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
  const db = getDb();
  const orgId = "org_x3jnpp3eyk6h608shh3k"; // Botilleria
  
  const plainToken = "test_webhook_token_12345";
  const secretHeader = "test_webhook_secret_67890";
  
  const integrationId = newId("telegramIntegration");
  
  await db.insert(schema.telegramIntegration).values({
    id: integrationId,
    organizationId: orgId,
    webhookTokenHash: hashToken(plainToken),
    webhookHeaderSecretHash: hashToken(secretHeader),
    status: "connected",
    botId: 99999999,
  });
  
  console.log("Token:", plainToken);
  console.log("Secret:", secretHeader);
  process.exit(0);
}
main().catch(console.error);
