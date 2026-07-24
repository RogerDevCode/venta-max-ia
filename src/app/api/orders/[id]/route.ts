import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const patchOrderSchema = z.object({
  status: z.enum(["pending", "confirmed", "processing", "paused", "completed", "cancelled"]).optional(),
  isPaid: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

const STATUS_NOTIF_MESSAGES: Record<string, string> = {
  processing: "📦 Tu pedido #{orderNumber} cambió a estado: EN PROCESO.",
  paused: "⏸ Tu pedido #{orderNumber} está en PAUSA. Nos comunicaremos contigo pronto.",
  completed: "✅ Tu pedido #{orderNumber} ha sido COMPLETADO. ¡Gracias por tu compra!",
  cancelled: "❌ Tu pedido #{orderNumber} ha sido CANCELADO.",
  confirmed: "📋 Tu pedido #{orderNumber} fue CONFIRMADO.",
  pending: "📋 Tu pedido #{orderNumber} está PENDIENTE.",
};

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchOrderSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.status) set.status = body.data.status;
  if (body.data.isPaid !== undefined) set.isPaid = body.data.isPaid;

  const updated = await db
    .update(schema.order)
    .set(set)
    .where(
      scoped(
        schema.order.organizationId,
        session.organizationId,
        eq(schema.order.id, id)
      )
    )
    .returning();

  if (!updated.length || !updated[0]) {
    return apiError(404, "not_found", "Pedido no encontrado");
  }

  const orderRow = updated[0];

  // Si cambió el estado y existe conversación activa, enviar notificación muy corta por Telegram
  if (body.data.status && orderRow.conversationId) {
    const template = STATUS_NOTIF_MESSAGES[body.data.status];
    if (template) {
      const text = template.replace("{orderNumber}", orderRow.orderNumber);
      await sendText({
        conversationId: orderRow.conversationId,
        organizationId: session.organizationId,
        text,
      }).catch(() => null);
    }
  }

  // Evento SSE para sincronización en tiempo real
  publish(session.organizationId, {
    type: "order.updated",
    data: { orderId: id, status: orderRow.status },
  });

  return Response.json({ order: orderRow });
});
