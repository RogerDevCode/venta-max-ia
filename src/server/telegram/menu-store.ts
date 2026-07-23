import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { encodeMenuCallback } from "@/server/telegram/menu-codec";
import { stateKey } from "@/server/ai/menu-fsm";

type InlineButton = { text: string; callback_data?: string; [key: string]: unknown };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export function isInlineKeyboard(value: unknown): value is InlineKeyboard {
  return Boolean(value && typeof value === "object" && Array.isArray((value as InlineKeyboard).inline_keyboard));
}

export function encodeTelegramMenuMarkup(markup: InlineKeyboard, instanceId: string) {
  const allowedActions: string[] = [];
  const inline_keyboard = markup.inline_keyboard.map((row) => row.map((button) => {
    if (typeof button.callback_data !== "string") return { ...button };
    const optionIndex = allowedActions.push(button.callback_data) - 1;
    return { ...button, callback_data: encodeMenuCallback(instanceId, optionIndex) };
  }));
  if (allowedActions.length === 0) throw new Error("Telegram menu has no callback actions");
  return { markup: { inline_keyboard }, allowedActions };
}

export async function reserveTelegramMenu(input: {
  organizationId: string;
  conversationId: string;
  chatId: string;
  markup: InlineKeyboard;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
      where ${schema.conversation.organizationId} = ${input.organizationId}
        and ${schema.conversation.id} = ${input.conversationId} for update`);
    const conversations = await tx.select({ stateMetadata: schema.conversation.stateMetadata })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId)))
      .limit(1);
    if (!conversations[0]) throw new Error("Conversation not found while reserving Telegram menu");
    const previous = await tx.select({ generation: schema.telegramMenuInstance.generation })
      .from(schema.telegramMenuInstance)
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId, eq(schema.telegramMenuInstance.conversationId, input.conversationId)))
      .orderBy(desc(schema.telegramMenuInstance.generation)).limit(1);
    const instanceId = newId("telegramMenu");
    const encoded = encodeTelegramMenuMarkup(input.markup, instanceId);
    const state = (conversations[0].stateMetadata ?? {}) as Record<string, unknown>;
    const generation = (previous[0]?.generation ?? 0) + 1;
    await tx.insert(schema.telegramMenuInstance).values({
      id: instanceId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      chatId: input.chatId,
      generation,
      fsbState: stateKey(state),
      allowedActions: encoded.allowedActions,
      status: "pending",
    });
    return { instanceId, generation, replyMarkup: encoded.markup };
  });
}

export async function markTelegramMenuFailed(organizationId: string, instanceId: string) {
  await getDb().update(schema.telegramMenuInstance).set({ status: "failed" })
    .where(scoped(schema.telegramMenuInstance.organizationId, organizationId, eq(schema.telegramMenuInstance.id, instanceId)));
}

export async function activateDeliveredTelegramMenu(input: {
  organizationId: string;
  conversationId: string;
  instanceId: string;
  telegramMessageId: number;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
      where ${schema.conversation.organizationId} = ${input.organizationId}
        and ${schema.conversation.id} = ${input.conversationId} for update`);
    await tx.update(schema.telegramMenuInstance).set({
      status: "delivered", telegramMessageId: input.telegramMessageId, deliveredAt: new Date(),
    }).where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId,
      and(eq(schema.telegramMenuInstance.conversationId, input.conversationId), eq(schema.telegramMenuInstance.id, input.instanceId))));

    const candidates = await tx.select({ id: schema.telegramMenuInstance.id })
      .from(schema.telegramMenuInstance)
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId,
        and(eq(schema.telegramMenuInstance.conversationId, input.conversationId), inArray(schema.telegramMenuInstance.status, ["delivered", "active"]))))
      .orderBy(desc(schema.telegramMenuInstance.generation)).limit(1);
    const winner = candidates[0]?.id;
    if (!winner) return;
    await tx.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId,
        and(
          eq(schema.telegramMenuInstance.conversationId, input.conversationId),
          inArray(schema.telegramMenuInstance.status, ["delivered", "active"]),
          ne(schema.telegramMenuInstance.id, winner)
        )));
    await tx.update(schema.telegramMenuInstance).set({ status: "active", activatedAt: new Date() })
      .where(scoped(schema.telegramMenuInstance.organizationId, input.organizationId, eq(schema.telegramMenuInstance.id, winner)));
  });
}
