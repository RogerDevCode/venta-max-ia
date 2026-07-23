import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decodeMenuCallback } from "@/server/telegram/menu-codec";
import { stateKey } from "@/server/ai/menu-fsm";

export type MenuCallbackDecision =
  | { accepted: true; action: string; actionId: string }
  | { accepted: false };

export async function acceptTelegramMenuCallback(input: {
  organizationId: string;
  updateId: number;
  callbackQueryId: string;
  callbackData: string;
  chatId: string;
  fromId: string;
  messageId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
}): Promise<MenuCallbackDecision> {
  const decoded = decodeMenuCallback(input.callbackData);
  if (!decoded || input.chatType !== "private" || input.chatId !== input.fromId) return { accepted: false };
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.select({
      menu: schema.telegramMenuInstance,
      stateMetadata: schema.conversation.stateMetadata,
    }).from(schema.telegramMenuInstance)
      .innerJoin(schema.conversation, eq(schema.telegramMenuInstance.conversationId, schema.conversation.id))
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId,
        and(
          eq(schema.telegramMenuInstance.id, decoded.instanceId),
          eq(schema.telegramMenuInstance.chatId, input.chatId),
          eq(schema.telegramMenuInstance.telegramMessageId, input.messageId),
          eq(schema.telegramMenuInstance.status, "active"),
          eq(schema.conversation.organizationId, input.organizationId)
        )))
      .limit(1);
    const row = rows[0];
    const action = row?.menu.allowedActions[decoded.optionIndex];
    const state = (row?.stateMetadata ?? {}) as Record<string, unknown>;
    const currentStateKey = stateKey(state);
    if (!row || typeof action !== "string" || row.menu.fsbState !== currentStateKey) return { accepted: false };

    const consumed = await tx.update(schema.telegramMenuInstance).set({ status: "consumed", consumedAt: new Date() })
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId,
        and(
          eq(schema.telegramMenuInstance.id, decoded.instanceId),
          eq(schema.telegramMenuInstance.status, "active"),
          sql`exists (select 1 from ${schema.conversation}
            where ${schema.conversation.id} = ${schema.telegramMenuInstance.conversationId}
              and ${schema.conversation.organizationId} = ${input.organizationId}
              and concat(
                coalesce(${schema.conversation.stateMetadata}->>'current_state', 'menu:main'),
                '/',
                coalesce(
                  ${schema.conversation.stateMetadata}->>'active_step',
                  case coalesce(${schema.conversation.stateMetadata}->>'current_state', 'menu:main')
                    when 'menu:main' then 'main_menu'
                    when 'menu:catalog' then 'viewing_catalog'
                    when 'menu:promos' then 'viewing_promos'
                    when 'menu:recommended' then 'viewing_recommended'
                    when 'menu:cart' then 'viewing_cart'
                    when 'menu:orders' then 'viewing_orders'
                    when 'menu:order_detail' then 'viewing_order_detail'
                    when 'menu:order_merge' then 'awaiting_merge_confirmation'
                    when 'cart:awaiting_quantity' then 'awaiting_product_quantity'
                    when 'handoff:humano' then 'awaiting_human'
                    else 'unknown'
                  end
                )
              ) = ${row.menu.fsbState})`
        )))
      .returning({ id: schema.telegramMenuInstance.id });
    if (!consumed[0]) return { accepted: false };

    const actionId = newId("telegramMenuAction");
    const inserted = await tx.insert(schema.telegramMenuAction).values({
      id: actionId,
      organizationId: input.organizationId,
      conversationId: row.menu.conversationId,
      menuInstanceId: row.menu.id,
      callbackQueryId: input.callbackQueryId,
      telegramUpdateId: input.updateId,
      action,
    }).onConflictDoNothing().returning({ id: schema.telegramMenuAction.id });
    if (!inserted[0]) throw new Error("Telegram menu action uniqueness conflict");
    return { accepted: true, action, actionId };
  });
}
