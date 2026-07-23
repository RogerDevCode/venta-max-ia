import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encodeMenuCallback } from "@/server/telegram/menu-codec";
import { acceptTelegramMenuCallback } from "@/server/telegram/menu-guard";
import { activateDeliveredTelegramMenu } from "@/server/telegram/menu-store";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const db = getDb();
const organizationId = newId("organization");
const contactId = newId("contact");
const conversationId = newId("conversation");
const TEST_CHAT_ID = "900000000001";
let generation = 0;

async function createMenu(status: "active" | "superseded" = "active", fsbState = "menu:main/main_menu") {
  const id = newId("telegramMenu");
  await db.insert(schema.telegramMenuInstance).values({
    id, organizationId, conversationId, chatId: TEST_CHAT_ID, telegramMessageId: 700 + ++generation,
    generation, fsbState, allowedActions: ["menu:carrito"], status,
  });
  return { id, messageId: 700 + generation };
}

describe.sequential("Telegram menu concurrency with real PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: organizationId, name: "Telegram concurrency test" });
    await db.insert(schema.contact).values({ id: contactId, organizationId, phone: TEST_CHAT_ID, name: "Test" });
    await db.insert(schema.conversation).values({
      id: conversationId, organizationId, contactId, stateMetadata: { current_state: "menu:main", active_step: "main_menu" },
    });
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  });

  it("accepts exactly one of 20 simultaneous clicks", async () => {
    const menu = await createMenu();
    const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      acceptTelegramMenuCallback({
        organizationId, updateId: 10_000 + index, callbackQueryId: `concurrent_${index}`,
        callbackData: encodeMenuCallback(menu.id, 0), chatId: TEST_CHAT_ID, fromId: TEST_CHAT_ID,
        messageId: menu.messageId, chatType: "private",
      })
    ));
    expect(decisions.filter((decision) => decision.accepted)).toHaveLength(1);
    const actions = await db.select().from(schema.telegramMenuAction)
      .where(eq(schema.telegramMenuAction.menuInstanceId, menu.id));
    expect(actions).toHaveLength(1);
  });

  it("silently rejects superseded, cross-tenant and state-mismatched menus", async () => {
    const stale = await createMenu("superseded");
    const base = {
      updateId: 20_000, callbackQueryId: "rejected", callbackData: encodeMenuCallback(stale.id, 0),
      chatId: TEST_CHAT_ID, fromId: TEST_CHAT_ID, messageId: stale.messageId, chatType: "private" as const,
    };
    await expect(acceptTelegramMenuCallback({ ...base, organizationId })).resolves.toEqual({ accepted: false });
    await expect(acceptTelegramMenuCallback({ ...base, organizationId: "org_does_not_exist" })).resolves.toEqual({ accepted: false });

    const wrongState = await createMenu("active", "menu:catalog/viewing_catalog");
    await expect(acceptTelegramMenuCallback({
      ...base, organizationId, updateId: 20_001, callbackQueryId: "wrong_state",
      callbackData: encodeMenuCallback(wrongState.id, 0), messageId: wrongState.messageId,
    })).resolves.toEqual({ accepted: false });
  });

  it("rechaza un menú del mismo estado cuando cambió el paso activo", async () => {
    await db.update(schema.telegramMenuInstance).set({ status: "superseded" })
      .where(eq(schema.telegramMenuInstance.conversationId, conversationId));
    await db.update(schema.conversation).set({
      stateMetadata: { current_state: "menu:catalog", active_step: "viewing_catalog" },
    }).where(eq(schema.conversation.id, conversationId));
    const menu = await createMenu("active", "menu:catalog/viewing_catalog");
    await db.update(schema.conversation).set({
      stateMetadata: { current_state: "menu:catalog", active_step: "viewing_category" },
    }).where(eq(schema.conversation.id, conversationId));
    await expect(acceptTelegramMenuCallback({
      organizationId,
      updateId: 20_002,
      callbackQueryId: "wrong_step",
      callbackData: encodeMenuCallback(menu.id, 0),
      chatId: TEST_CHAT_ID,
      fromId: TEST_CHAT_ID,
      messageId: menu.messageId,
      chatType: "private",
    })).resolves.toEqual({ accepted: false });
    await db.update(schema.conversation).set({
      stateMetadata: { current_state: "menu:main", active_step: "main_menu" },
    }).where(eq(schema.conversation.id, conversationId));
  });

  it("keeps the newest generation active when Telegram responses arrive reversed", async () => {
    const olderId = newId("telegramMenu");
    const newerId = newId("telegramMenu");
    const olderGeneration = ++generation;
    const newerGeneration = ++generation;
    await db.insert(schema.telegramMenuInstance).values([
      { id: olderId, organizationId, conversationId, chatId: TEST_CHAT_ID, generation: olderGeneration,
        fsbState: "menu:main/main_menu", allowedActions: ["menu:catalog"], status: "pending" },
      { id: newerId, organizationId, conversationId, chatId: TEST_CHAT_ID, generation: newerGeneration,
        fsbState: "menu:main/main_menu", allowedActions: ["menu:cart"], status: "pending" },
    ]);

    await activateDeliveredTelegramMenu({ organizationId, conversationId, instanceId: newerId, telegramMessageId: 9002 });
    await activateDeliveredTelegramMenu({ organizationId, conversationId, instanceId: olderId, telegramMessageId: 9001 });

    const rows = await db.select({ id: schema.telegramMenuInstance.id, status: schema.telegramMenuInstance.status })
      .from(schema.telegramMenuInstance)
      .where(eq(schema.telegramMenuInstance.conversationId, conversationId));
    expect(rows.find((row) => row.id === newerId)?.status).toBe("active");
    expect(rows.find((row) => row.id === olderId)?.status).toBe("superseded");
    expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
  });
});
