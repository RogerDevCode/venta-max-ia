import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

function startOf(range: string): Date {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 86400_000);
  if (range === "30d") return new Date(now - 30 * 86400_000);
  if (range === "90d") return new Date(now - 90 * 86400_000);
  return new Date(now - 30 * 86400_000); // default 30d
}

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "30d";
  const since = startOf(range);
  const orgId = session.organizationId;
  const db = getDb();

  // ── Pedidos en período ──────────────────────────────────────────────────
  const [ordersAgg] = await db
    .select({
      total: count(schema.order.id),
      revenue: sum(schema.order.totalAmount),
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${schema.order.status} = 'cancelled')`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${schema.order.status} IN ('delivered','completed'))`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.order.status} IN ('pending','confirmed','processing','pending_shipment','shipped','paused'))`,
    })
    .from(schema.order)
    .where(
      scoped(schema.order.organizationId, orgId, gte(schema.order.createdAt, since))
    );

  // ── Revenue diario (últimos N días) ───────────────────────────────────
  const revenueByDay = await db
    .select({
      day: sql<string>`DATE(${schema.order.createdAt})`,
      revenue: sum(schema.order.totalAmount),
      orders: count(schema.order.id),
    })
    .from(schema.order)
    .where(
      scoped(
        schema.order.organizationId,
        orgId,
        and(
          gte(schema.order.createdAt, since),
          sql`${schema.order.status} NOT IN ('cancelled')`
        )
      )
    )
    .groupBy(sql`DATE(${schema.order.createdAt})`)
    .orderBy(sql`DATE(${schema.order.createdAt})`);

  // ── Top 5 productos más vendidos ──────────────────────────────────────
  const allOrders = await db
    .select({ items: schema.order.items })
    .from(schema.order)
    .where(
      scoped(
        schema.order.organizationId,
        orgId,
        and(
          gte(schema.order.createdAt, since),
          sql`${schema.order.status} NOT IN ('cancelled')`
        )
      )
    );

  const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const { items } of allOrders) {
    for (const item of items ?? []) {
      const existing = productMap.get(item.productId) ?? {
        name: item.name,
        qty: 0,
        revenue: 0,
      };
      existing.qty += item.quantity;
      existing.revenue += item.quantity * item.unitPrice;
      productMap.set(item.productId, existing);
    }
  }
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // ── Conversaciones y handoffs ─────────────────────────────────────────
  const [convAgg] = await db
    .select({
      total: count(schema.conversation.id),
      withHandoff: sql<number>`COUNT(*) FILTER (WHERE ${schema.conversation.handoffAt} IS NOT NULL)`,
      aiEnabled: sql<number>`COUNT(*) FILTER (WHERE ${schema.conversation.aiEnabled} = true)`,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        orgId,
        and(
          gte(schema.conversation.createdAt, since),
          eq(schema.conversation.isTest, false)
        )
      )
    );

  // ── Contactos nuevos ──────────────────────────────────────────────────
  const [contactAgg] = await db
    .select({ newContacts: count(schema.contact.id) })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        orgId,
        gte(schema.contact.createdAt, since)
      )
    );

  // ── Mensajes totales (actividad del bot) ──────────────────────────────
  const [msgAgg] = await db
    .select({
      total: count(schema.message.id),
      inbound: sql<number>`COUNT(*) FILTER (WHERE ${schema.message.direction} = 'in')`,
      outbound: sql<number>`COUNT(*) FILTER (WHERE ${schema.message.direction} = 'out')`,
    })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
    .where(
      and(
        scoped(schema.conversation.organizationId, orgId),
        gte(schema.message.createdAt, since),
        eq(schema.conversation.isTest, false)
      )
    );

  // ── Pedidos por estado (donut) ─────────────────────────────────────────
  const ordersByStatus = await db
    .select({
      status: schema.order.status,
      count: count(schema.order.id),
    })
    .from(schema.order)
    .where(
      scoped(schema.order.organizationId, orgId, gte(schema.order.createdAt, since))
    )
    .groupBy(schema.order.status);

  // ── Carrito vs Pedido (tasa de conversión) ───────────────────────────
  const [cartAgg] = await db
    .select({
      total: count(schema.cart.id),
      converted: sql<number>`COUNT(*) FILTER (WHERE ${schema.cart.status} = 'converted')`,
      abandoned: sql<number>`COUNT(*) FILTER (WHERE ${schema.cart.status} = 'abandoned')`,
    })
    .from(schema.cart)
    .where(
      scoped(schema.cart.organizationId, orgId, gte(schema.cart.createdAt, since))
    );

  return Response.json({
    range,
    since: since.toISOString(),
    kpis: {
      totalOrders: Number(ordersAgg?.total ?? 0),
      revenue: Number(ordersAgg?.revenue ?? 0),
      cancelledOrders: Number(ordersAgg?.cancelled ?? 0),
      deliveredOrders: Number(ordersAgg?.delivered ?? 0),
      pendingOrders: Number(ordersAgg?.pending ?? 0),
      newContacts: Number(contactAgg?.newContacts ?? 0),
      totalConversations: Number(convAgg?.total ?? 0),
      handoffs: Number(convAgg?.withHandoff ?? 0),
      totalMessages: Number(msgAgg?.total ?? 0),
      inboundMessages: Number(msgAgg?.inbound ?? 0),
      outboundMessages: Number(msgAgg?.outbound ?? 0),
      cartTotal: Number(cartAgg?.total ?? 0),
      cartConverted: Number(cartAgg?.converted ?? 0),
      cartAbandoned: Number(cartAgg?.abandoned ?? 0),
      conversionRate:
        Number(cartAgg?.total ?? 0) > 0
          ? Math.round((Number(cartAgg?.converted ?? 0) / Number(cartAgg?.total)) * 100)
          : 0,
    },
    revenueByDay: revenueByDay.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue ?? 0),
      orders: Number(r.orders ?? 0),
    })),
    topProducts,
    ordersByStatus: ordersByStatus.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
  });
});
