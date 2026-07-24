import { desc, eq, inArray, or, and, gte } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["pending", "confirmed", "processing", "pending_shipment", "shipped", "paused"] as const;

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";

  let cutoffDate: Date | undefined;
  if (range === "24h") {
    cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  } else if (range === "48h") {
    cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  } else if (range === "7d") {
    cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const db = getDb();

  // Si hay cutoffDate, mantener SIEMPRE los pedidos activos, y filtrar únicamente los terminales antiguos
  const condition = cutoffDate
    ? scoped(
        schema.order.organizationId,
        session.organizationId,
        or(
          inArray(schema.order.status, [...ACTIVE_STATUSES]),
          and(
            inArray(schema.order.status, ["delivered", "completed", "cancelled"]),
            gte(schema.order.updatedAt, cutoffDate)
          )
        )
      )
    : scoped(schema.order.organizationId, session.organizationId);

  const rows = await db
    .select({
      order: schema.order,
      contact: schema.contact,
    })
    .from(schema.order)
    .innerJoin(schema.contact, eq(schema.order.contactId, schema.contact.id))
    .where(condition)
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
