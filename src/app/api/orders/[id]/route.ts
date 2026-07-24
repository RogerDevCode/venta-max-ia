import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

const patchOrderSchema = z.object({
  status: z.enum(["pending", "confirmed", "processing", "paused", "completed", "cancelled"]),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchOrderSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.order)
    .set({
      status: body.data.status,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.order.organizationId,
        session.organizationId,
        eq(schema.order.id, id)
      )
    )
    .returning();

  if (!updated.length) {
    return apiError(404, "not_found", "Pedido no encontrado");
  }

  const orderRow = updated[0];

  // Publish SSE event for real-time order queue updates
  publish(session.organizationId, {
    type: "order.updated",
    data: { orderId: id, status: body.data.status },
  });

  return Response.json({ order: orderRow });
});
