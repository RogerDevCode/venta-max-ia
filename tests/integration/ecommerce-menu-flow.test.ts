import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { processPendingProductQuantity, processSlashCommand } from "@/server/ai/commands";
import { invalidateCatalogCache } from "@/server/ecommerce/cache";

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
const waterCategoryId = newId("category");
const drinksCategoryId = newId("category");
const beerCategoryId = newId("category");
const waterProductId = newId("product");
const cokeProductId = newId("product");
const pepsiProductId = newId("product");

async function conversation() {
  const rows = await db.select().from(schema.conversation).where(and(
    eq(schema.conversation.organizationId, organizationId),
    eq(schema.conversation.id, conversationId)
  )).limit(1);
  if (!rows[0]) throw new Error("Test conversation missing");
  return rows[0];
}

describe.sequential("ecommerce menu flow with real PostgreSQL and sandboxed Telegram API", () => {
  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: organizationId, name: "Menu flow test" });
    await db.insert(schema.contact).values({ id: contactId, organizationId, channel: "test", externalAddress: "900000000010", name: "Menu Test" });
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId,
      contactId,
      isTest: true,
      stateMetadata: {},
    });
    await db.insert(schema.category).values([
      { id: waterCategoryId, organizationId, name: "Aguas" },
      { id: drinksCategoryId, organizationId, name: "Bebidas" },
      { id: beerCategoryId, organizationId, name: "Cervezas" },
    ]);
    await db.insert(schema.product).values([
      { id: waterProductId, organizationId, categoryId: drinksCategoryId, sku: "ADMIN-AGUA", name: "Agua", description: "1 litro", price: 1000, stock: 10 },
      { id: cokeProductId, organizationId, categoryId: drinksCategoryId, sku: "ADMIN-COCA", name: "Coca-Cola", description: "2 litros", price: 2500, stock: 8 },
      { id: pepsiProductId, organizationId, categoryId: drinksCategoryId, sku: "ADMIN-PEPSI", name: "Pepsi-Cola", description: "2 litros", price: 2000, stock: 7 },
    ]);
    invalidateCatalogCache(organizationId);
  });

  afterAll(async () => {
    invalidateCatalogCache(organizationId);
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  });

  it("selecciona la categoría y el producto por su índice real y agrega la cantidad al carrito", async () => {
    await processSlashCommand({
      command: "menu:categorias",
      conversation: await conversation(),
      lastInboundExternalId: "tg_900000000010_1",
    });
    const categoryState = (await conversation()).stateMetadata as { numeric_options?: string[] };
    const categoryAction = `catalog:category:${drinksCategoryId}`;
    const categoryIndex = categoryState.numeric_options?.indexOf(categoryAction) ?? -1;
    expect(categoryIndex).toBeGreaterThanOrEqual(0);

    await processSlashCommand({
      command: `catalog:number:${categoryIndex + 1}`,
      conversation: await conversation(),
      lastInboundExternalId: "tg_900000000010_2",
    });
    const productState = (await conversation()).stateMetadata as {
      catalogCategoryId?: string;
      numeric_options?: string[];
    };
    const productOptions = productState.numeric_options ?? [];
    expect(productState.catalogCategoryId).toBe(drinksCategoryId);
    expect(productOptions).toEqual([
      `catalog:product:${waterProductId}`,
      `catalog:product:${cokeProductId}`,
      `catalog:product:${pepsiProductId}`,
    ]);
    const pepsiIndex = productOptions.indexOf(`catalog:product:${pepsiProductId}`);

    await processSlashCommand({
      command: `catalog:number:${pepsiIndex + 1}`,
      conversation: await conversation(),
      lastInboundExternalId: "tg_900000000010_3",
    });
    expect((await conversation()).stateMetadata).toMatchObject({
      current_state: "cart:awaiting_quantity",
      active_step: "awaiting_product_quantity",
      selectedProductId: pepsiProductId,
    });

    await expect(processPendingProductQuantity({
      conversation: await conversation(),
      text: "2",
      lastInboundExternalId: "tg_900000000010_4",
    })).resolves.toBe(true);

    const carts = await db.select().from(schema.cart).where(and(
      eq(schema.cart.organizationId, organizationId),
      eq(schema.cart.conversationId, conversationId),
      eq(schema.cart.status, "active")
    ));
    expect(carts).toHaveLength(1);
    expect(carts[0]?.items).toEqual([
      expect.objectContaining({
        productId: pepsiProductId,
        name: "Pepsi-Cola",
        presentation: "2 litros",
        quantity: 2,
        unitPrice: 2000,
      }),
    ]);

    const messages = await db.select({ text: schema.message.text }).from(schema.message)
      .where(eq(schema.message.conversationId, conversationId)).orderBy(asc(schema.message.createdAt));
    const transcript = messages.map((message) => message.text).join("\n");
    expect(transcript).toContain("Pepsi-Cola — 2 litros");
    expect(transcript).toContain("cantidad 2");
    expect(transcript).not.toContain("ADMIN-");
    expect(transcript).not.toContain("null");
  });
});
