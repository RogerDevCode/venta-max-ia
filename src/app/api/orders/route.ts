import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select({
      order: schema.order,
      contact: schema.contact,
    })
    .from(schema.order)
    .innerJoin(schema.contact, eq(schema.order.contactId, schema.contact.id))
    .where(scoped(schema.order.organizationId, session.organizationId))
    .orderBy(desc(schema.order.createdAt));

  const orders = rows.map((r) => ({
    id: r.order.id,
    orderNumber: r.order.orderNumber,
    contactId: r.order.contactId,
    conversationId: r.order.conversationId,
    contact: {
      id: r.contact.id,
      name: r.contact.name,
      channel: r.contact.channel,
      externalAddress: r.contact.externalAddress,
    },
    items: r.order.items,
    totalAmount: r.order.totalAmount,
    isPaid: r.order.isPaid,
    status: r.order.status,
    createdAt: r.order.createdAt.toISOString(),
    updatedAt: r.order.updatedAt.toISOString(),
  }));

  return Response.json({ orders });
});
