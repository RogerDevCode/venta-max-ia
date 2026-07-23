import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isMenuActionAllowed } from "@/server/ai/menu-fsm";

type ActiveMenu = {
  telegramMessageId?: number;
  version?: number;
  allowedActions?: string[];
};

/** Consumes the only valid Telegram menu before its callback reaches the agent. */
export async function consumeActiveTelegramMenu(input: {
  organizationId: string;
  chatId: string;
  messageId?: number;
  action: string;
}): Promise<{ accepted: boolean; reason?: "stale_menu" | "invalid_transition" }> {
  if (!input.messageId) return { accepted: false, reason: "stale_menu" };
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(scoped(schema.conversation.organizationId, input.organizationId, eq(schema.contact.phone, input.chatId)))
    .limit(1);
  const conversation = rows[0]?.conversation;
  if (!conversation) return { accepted: false, reason: "stale_menu" };

  const stateMetadata = (conversation.stateMetadata ?? {}) as Record<string, unknown>;
  const activeMenu = (stateMetadata.activeMenu ?? {}) as ActiveMenu;
  if (
    activeMenu.telegramMessageId !== input.messageId ||
    !activeMenu.allowedActions?.includes(input.action) ||
    !isMenuActionAllowed(stateMetadata.current_state, input.action)
  ) return { accepted: false, reason: activeMenu.telegramMessageId === input.messageId ? "invalid_transition" : "stale_menu" };

  // Compare-and-swap: only one concurrent callback can remove this exact menu.
  const consumed = await db
    .update(schema.conversation)
    .set({ stateMetadata: sql`${schema.conversation.stateMetadata} - 'activeMenu'`, updatedAt: new Date() })
    .where(and(
      scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, conversation.id)),
      sql`${schema.conversation.stateMetadata}->'activeMenu'->>'telegramMessageId' = ${String(input.messageId)}`,
      sql`${schema.conversation.stateMetadata}->'activeMenu'->'allowedActions' @> ${JSON.stringify([input.action])}::jsonb`
    ))
    .returning({ id: schema.conversation.id });
  return consumed.length ? { accepted: true } : { accepted: false, reason: "stale_menu" };
}
