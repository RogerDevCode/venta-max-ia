import type { telegramWebhookReceipt } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { completeTelegramReceipt } from "@/server/telegram/receipt-queue";
import { processTelegramUpdate, type TelegramUpdate } from "@/server/inbox/telegram-webhook";
import { parseSlashCommand } from "@/server/ai/commands";

type Receipt = typeof telegramWebhookReceipt.$inferSelect;

function privateContext(update: TelegramUpdate): { private: boolean; supported: boolean } {
  const message = update.callback_query?.message ?? update.message;
  if (!message) return { private: false, supported: false };
  const from = update.callback_query?.from ?? message.from;
  return {
    supported: Boolean(update.callback_query || update.message),
    private: message.chat.type === "private" && Boolean(from) && String(message.chat.id) === String(from?.id),
  };
}

export async function processTelegramReceipt(receipt: Receipt): Promise<void> {
  const update = receipt.payload as unknown as TelegramUpdate;
  const context = privateContext(update);
  if (!context.supported) {
    await completeTelegramReceipt({ organizationId: receipt.organizationId, receiptId: receipt.id, status: "ignored", ignoredReason: "unsupported" });
    return;
  }
  if (!context.private) {
    await completeTelegramReceipt({ organizationId: receipt.organizationId, receiptId: receipt.id, status: "ignored", ignoredReason: "non_private" });
    return;
  }
  const message = update.callback_query?.message ?? update.message;
  const chatId = String(message!.chat.id);
  const lockKey = `${receipt.organizationId}:${chatId}`;
  const sqlClient = await getSql().reserve();
  await sqlClient`select pg_advisory_lock(hashtext(${lockKey}))`;
  try {
    let conversationId = receipt.conversationId;
    if (conversationId && receipt.expectedFsmRevision !== null) {
      const current = await getDb().select({ revision: schema.conversation.fsmRevision })
        .from(schema.conversation)
        .where(scoped(schema.conversation.organizationId, receipt.organizationId, eq(schema.conversation.id, conversationId)))
        .limit(1);
      if (!current[0] || current[0].revision !== receipt.expectedFsmRevision) {
        await completeTelegramReceipt({ organizationId: receipt.organizationId, receiptId: receipt.id, status: "ignored", ignoredReason: "stale_revision" });
        return;
      }
    }
    await processTelegramUpdate({ organizationId: receipt.organizationId, integrationId: receipt.integrationId, update });
    const rawInput = update.callback_query?.data ?? update.message?.text ?? null;
    const consumesRevision = update.callback_query !== undefined || parseSlashCommand(rawInput) !== null;
    if (consumesRevision) {
      if (!conversationId) {
        const rows = await getDb().select({ id: schema.conversation.id }).from(schema.contact)
          .innerJoin(schema.conversation, eq(schema.conversation.contactId, schema.contact.id))
          .where(scoped(schema.contact.organizationId, receipt.organizationId, and(
            eq(schema.contact.channel, "telegram"), eq(schema.contact.externalAddress, chatId), eq(schema.conversation.organizationId, receipt.organizationId), eq(schema.conversation.isTest, false),
          ))).limit(1);
        conversationId = rows[0]?.id ?? null;
      }
      if (conversationId) {
        const expected = receipt.expectedFsmRevision ?? 0;
        const incremented = await getDb().update(schema.conversation).set({
          fsmRevision: sql`${schema.conversation.fsmRevision} + 1`,
          updatedAt: new Date(),
        }).where(scoped(schema.conversation.organizationId, receipt.organizationId, and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.fsmRevision, expected),
        ))).returning({ revision: schema.conversation.fsmRevision });
        if (!incremented[0]) {
          await completeTelegramReceipt({ organizationId: receipt.organizationId, receiptId: receipt.id, status: "ignored", ignoredReason: "stale_revision" });
          return;
        }
      }
    }
    await completeTelegramReceipt({ organizationId: receipt.organizationId, receiptId: receipt.id });
  } finally {
    await sqlClient`select pg_advisory_unlock(hashtext(${lockKey}))`;
    await sqlClient.release();
  }
}
