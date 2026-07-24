import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export type TelegramCredentials = { id: string; token: string; botId: number; botUsername: string | null; status: "pending" | "header_pending" | "connected" | "reconnect_required" | "failed" };

export async function getTelegramCredentialsByOrg(organizationId: string): Promise<TelegramCredentials | null> {
  const rows = await getDb().select().from(schema.telegramIntegration)
    .where(scoped(schema.telegramIntegration.organizationId, organizationId)).limit(1);
  const row = rows[0];
  if (!row?.tokenCipher || !row.tokenIv || !row.tokenTag || !row.botId) return null;
  return { id: row.id, token: decryptSecret({ cipher: row.tokenCipher, iv: row.tokenIv, tag: row.tokenTag }), botId: row.botId, botUsername: row.botUsername, status: row.status };
}

export async function saveTelegramCredentials(input: {
  organizationId: string;
  token: string;
  botId: number;
  botUsername: string | null;
  webhookTokenHash: string;
  webhookHeaderSecretHash?: string;
  routeSecret?: string;
  headerSecret?: string;
  status?: TelegramCredentials["status"];
}) {
  const enc = encryptSecret(input.token);
  const route = input.routeSecret ? encryptSecret(input.routeSecret) : null;
  const header = input.headerSecret ? encryptSecret(input.headerSecret) : null;
  const values = {
    tokenCipher: enc.cipher, tokenIv: enc.iv, tokenTag: enc.tag,
    botId: input.botId, botUsername: input.botUsername,
    webhookTokenHash: input.webhookTokenHash,
    webhookHeaderSecretHash: input.webhookHeaderSecretHash,
    webhookRouteSecretCipher: route?.cipher,
    webhookRouteSecretIv: route?.iv,
    webhookRouteSecretTag: route?.tag,
    webhookHeaderSecretCipher: header?.cipher,
    webhookHeaderSecretIv: header?.iv,
    webhookHeaderSecretTag: header?.tag,
    status: input.status ?? "connected",
    updatedAt: new Date(),
  } as const;
  await getDb().insert(schema.telegramIntegration).values({ id: newId("telegramIntegration"), organizationId: input.organizationId, ...values })
    .onConflictDoUpdate({ target: [schema.telegramIntegration.organizationId], set: values });
}

export async function getTelegramIntegrationSnapshot(organizationId: string) {
  const rows = await getDb().select().from(schema.telegramIntegration)
    .where(scoped(schema.telegramIntegration.organizationId, organizationId)).limit(1);
  return rows[0] ?? null;
}

export async function restoreTelegramIntegrationSnapshot(organizationId: string, snapshot: typeof schema.telegramIntegration.$inferSelect | null) {
  const db = getDb();
  if (!snapshot) {
    await db.delete(schema.telegramIntegration).where(scoped(schema.telegramIntegration.organizationId, organizationId));
    return;
  }
  const { id: _id, organizationId: _organizationId, createdAt: _createdAt, ...rest } = snapshot;
  await db.update(schema.telegramIntegration).set(rest)
    .where(scoped(schema.telegramIntegration.organizationId, organizationId));
}

export function decryptWebhookSecrets(snapshot: typeof schema.telegramIntegration.$inferSelect | null) {
  if (!snapshot?.webhookRouteSecretCipher || !snapshot.webhookRouteSecretIv || !snapshot.webhookRouteSecretTag) return null;
  const routeSecret = decryptSecret({ cipher: snapshot.webhookRouteSecretCipher, iv: snapshot.webhookRouteSecretIv, tag: snapshot.webhookRouteSecretTag });
  const headerSecret = snapshot.webhookHeaderSecretCipher && snapshot.webhookHeaderSecretIv && snapshot.webhookHeaderSecretTag
    ? decryptSecret({ cipher: snapshot.webhookHeaderSecretCipher, iv: snapshot.webhookHeaderSecretIv, tag: snapshot.webhookHeaderSecretTag })
    : undefined;
  return { routeSecret, headerSecret };
}

export function tokenLast4(token: string) { return token.slice(-4); }
