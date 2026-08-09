import { getDb } from "../src/lib/db/index.js";
import { scoped } from "../src/lib/db/tenant.js";
import * as schema from "../src/lib/db/schema.js";
import { newId } from "../src/lib/db/ids.js";
import { withTenantTransaction } from "../src/lib/db/context.js";
import { agregarAlCarrito, confirmarPedido } from "../src/server/ecommerce/service.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  console.log("==> Starting VentaMax IA Transaction & Order Verification Test...");

  const orgId = "org_x3jnpp3eyk6h608shh3k";

  await withTenantTransaction(orgId, null, "system", async () => {
    // 1. Get organization details
    const orgs = await db.select().from(schema.organization).where(scoped(schema.organization.id, orgId));
    const org = orgs[0] || { id: orgId, name: "Negocio de Botillería STAX Demo" };
    console.log(`[+] Selected Organization: ${org.name} (${org.id})`);

    // 2. Find sample products using scoped
    const products = await db.select().from(schema.product).where(scoped(schema.product.organizationId, orgId));
    if (products.length === 0) {
      console.error("[-] No products found in organization.");
      process.exit(1);
    }
    const monster = products.find((p) => p.name.includes("Monster")) || products[0]!;
    const pisco = products.find((p) => p.name.includes("Pisco")) || products[1]!;
    console.log(`[+] Selected Product 1: ${monster.name} - Price: $${monster.price} CLP (Initial Stock: ${monster.stock})`);
    console.log(`[+] Selected Product 2: ${pisco.name} - Price: $${pisco.price} CLP (Initial Stock: ${pisco.stock})`);

    // 3. Create test Contact
    const contactId = newId("contact");
    const [contact] = await db.insert(schema.contact).values({
      id: contactId,
      organizationId: orgId,
      name: "Roger Gallegos (Cliente Prueba)",
      channel: "telegram",
      externalAddress: `tg_${Date.now()}`,
    }).returning();
    console.log(`[+] Contact created: ${contact.name} (${contact.id})`);

    // 4. Create test Conversation
    const convId = newId("conversation");
    const [conversation] = await db.insert(schema.conversation).values({
      id: convId,
      organizationId: orgId,
      contactId: contact.id,
      channel: "telegram",
      externalThreadId: `thread_${Date.now()}`,
      status: "active",
    }).returning();
    console.log(`[+] Conversation created: ${conversation.id}`);

    // 5. Add products to active cart using domain service
    console.log("\n--> Adding items to cart...");
    await agregarAlCarrito({
      organizationId: orgId,
      conversationId: conversation.id,
      productId: monster.id,
      cantidad: 2,
    });
    console.log(`[+] Added 2x ${monster.name} to cart.`);

    await agregarAlCarrito({
      organizationId: orgId,
      conversationId: conversation.id,
      productId: pisco.id,
      cantidad: 1,
    });
    console.log(`[+] Added 1x ${pisco.name} to cart.`);

    // 6. Execute Order Confirmation
    console.log("\n--> Executing Order Confirmation (confirmarPedido)...");
    const orderResult = await confirmarPedido({
      organizationId: orgId,
      conversationId: conversation.id,
    });

    if (!orderResult.ok) {
      console.error("[-] Order creation failed:", orderResult);
      process.exit(1);
    }

    const order = orderResult.order;
    console.log("\n=======================================================");
    console.log("🎉 TRANSACTION & ORDER CREATED SUCCESSFULLY!");
    console.log("=======================================================");
    console.log(`Order ID:        ${order.id}`);
    console.log(`Order Number:    #${order.orderNumber}`);
    console.log(`Contact Name:    ${contact.name}`);
    console.log(`Total Amount:    $${order.totalAmount} CLP`);
    console.log(`Order Status:    ${order.status}`);
    console.log(`Items Count:     ${order.items.length}`);
    console.log("Items details:\n", JSON.stringify(order.items, null, 2));

    // 7. Verify DB persistence directly
    const savedOrders = await db.select().from(schema.order).where(scoped(schema.order.organizationId, orgId, eq(schema.order.id, order.id)));
    if (savedOrders.length === 1 && savedOrders[0]!.orderNumber === order.orderNumber) {
      console.log("\n[+] Direct DB Verification PASS: Order is persisted in PostgreSQL!");
    } else {
      console.error("[-] DB Verification FAIL: Order was not found in PostgreSQL.");
      process.exit(1);
    }

    // 8. Check updated product stock
    const [updatedMonster] = await db.select().from(schema.product).where(scoped(schema.product.organizationId, orgId, eq(schema.product.id, monster.id)));
    const [updatedPisco] = await db.select().from(schema.product).where(scoped(schema.product.organizationId, orgId, eq(schema.product.id, pisco.id)));
    console.log(`[+] Stock Verification: ${monster.name} updated stock: ${updatedMonster?.stock} (was ${monster.stock})`);
    console.log(`[+] Stock Verification: ${pisco.name} updated stock: ${updatedPisco?.stock} (was ${pisco.stock})`);
  });
}

main().catch((err) => {
  console.error("[-] Error running test:", err);
  process.exit(1);
});
