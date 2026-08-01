import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // MercadoPago test/ping webhooks
    if (body.action === "test.created" || !body.data?.id) {
      return Response.json({ success: true });
    }

    // Identificar el ID del pago en MP
    const paymentId = body.data.id;
    // Si viene desde un preference auto-return, podríamos buscar por external_reference, 
    // pero MP manda webhooks estructurados.
    
    // Simplificación para la demo: asume que si recibimos un webhook válido de payment, 
    // lo marcamos si hace match. En un entorno real validaríamos con la API de MP.

    const db = getDb();
    
    // Buscar el payment local con ese externalId o paymentUrl (a veces MP manda el id del merchant_order o payment).
    // Nota: Como no estamos haciendo la integración full validada aquí con HMAC/token de MP,
    // buscamos el id.
    const payment = await db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.externalId, String(paymentId)))
      .limit(1)
      .then((r) => r[0]);

    if (!payment) {
      // Ignorar pagos no registrados en nuestro sistema
      return Response.json({ success: true });
    }

    // Actualizar estado del pago local y del pedido
    await db.transaction(async (tx) => {
      await tx
        .update(schema.payment)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.payment.id, payment.id));
        
      await tx
        .update(schema.order)
        .set({ isPaid: true, status: "processing", updatedAt: new Date() })
        .where(eq(schema.order.id, payment.orderId));
    });

    // Publicar evento para SSE (Dashboard y UI de órdenes)
    publish(payment.organizationId, {
      type: "order.updated",
      data: { orderId: payment.orderId, status: "processing" },
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[MP Webhook Error]:", err);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
