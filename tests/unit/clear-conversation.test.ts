import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { clearConversationMessages } from "@/server/inbox/queries";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const db = getDb();
const orgId = newId("organization");
const contactId = newId("contact");
const conversationId = newId("conversation");
const cartId = newId("cart");

describe("clearConversationMessages unit & integration", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: orgId, name: "Clear Conv Org" });
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId: orgId,
      channel: "telegram",
      externalAddress: "880000000001",
      name: "Clear Conv Contact",
    });
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId: orgId,
      contactId,
      isTest: true,
      unreadCount: 3,
      stateMetadata: { current_state: "menu:catalog", active_step: "item_selected" },
    });

    await db.insert(schema.cart).values({
      id: cartId,
      organizationId: orgId,
      conversationId,
      status: "active",
      items: [{ productId: "p1", quantity: 2, unitPrice: 15, name: "Producto 1", presentation: "Unidad" }],
    });

    await db.insert(schema.message).values([
      { id: newId("message"), organizationId: orgId, conversationId, direction: "in", type: "text", text: "Hola", status: "delivered" },
      { id: newId("message"), organizationId: orgId, conversationId, direction: "out", type: "text", text: "Hola! ¿En qué puedo ayudarte?", status: "sent" },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
  });

  it("clears messages from PostgreSQL while keeping active cart and FSM stateMetadata completely intact", async () => {
    // 1. Verify messages exist prior to clear
    const initialMessages = await db.select().from(schema.message).where(scoped(schema.message.organizationId, orgId, eq(schema.message.conversationId, conversationId)));
    expect(initialMessages).toHaveLength(2);

    // 2. Execute clearConversationMessages
    const result = await clearConversationMessages(orgId, conversationId);
    expect(result.clearedCount).toBe(2);

    // 3. Verify 0 messages remain in PostgreSQL
    const remainingMessages = await db.select().from(schema.message).where(scoped(schema.message.organizationId, orgId, eq(schema.message.conversationId, conversationId)));
    expect(remainingMessages).toHaveLength(0);

    // 4. Verify conversation stateMetadata is INTACT (not reset)
    const convRows = await db.select().from(schema.conversation).where(scoped(schema.conversation.organizationId, orgId, eq(schema.conversation.id, conversationId)));
    expect(convRows[0]?.stateMetadata).toEqual({ current_state: "menu:catalog", active_step: "item_selected" });
    expect(convRows[0]?.unreadCount).toBe(0);
    expect(convRows[0]?.lastMessageAt).toBeNull();

    // 5. Verify active cart remains ACTIVE and UNTOUCHED
    const carts = await db.select().from(schema.cart).where(scoped(schema.cart.organizationId, orgId, eq(schema.cart.id, cartId)));
    expect(carts[0]?.status).toBe("active");
    expect(carts[0]?.items).toHaveLength(1);
  });
});
