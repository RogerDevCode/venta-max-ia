import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export type TelegramCredentials = { token: string; botId: number; botUsername: string | null; status: "connected" | "reconnect_required" };

export async function getTelegramCredentialsByOrg(organizationId: string): Promise<TelegramCredentials | null> {
  const rows = await getDb().select().from(schema.telegramIntegration)
    .where(scoped(schema.telegramIntegration.organizationId, organizationId)).limit(1);
  const row = rows[0];
  if (!row?.tokenCipher || !row.tokenIv || !row.tokenTag || !row.botId) return null;
  return { token: decryptSecret({ cipher: row.tokenCipher, iv: row.tokenIv, tag: row.tokenTag }), botId: row.botId, botUsername: row.botUsername, status: row.status };
}

export async function saveTelegramCredentials(input: { organizationId: string; token: string; botId: number; botUsername: string | null; webhookTokenHash: string }) {
  const enc = encryptSecret(input.token);
  await getDb().insert(schema.telegramIntegration).values({ id: newId("telegramIntegration"), organizationId: input.organizationId, webhookTokenHash: input.webhookTokenHash, tokenCipher: enc.cipher, tokenIv: enc.iv, tokenTag: enc.tag, botId: input.botId, botUsername: input.botUsername, status: "connected" })
    .onConflictDoUpdate({ target: [schema.telegramIntegration.organizationId], set: { tokenCipher: enc.cipher, tokenIv: enc.iv, tokenTag: enc.tag, botId: input.botId, botUsername: input.botUsername, webhookTokenHash: input.webhookTokenHash, status: "connected", updatedAt: new Date() } });
}

export function tokenLast4(token: string) { return token.slice(-4); }
