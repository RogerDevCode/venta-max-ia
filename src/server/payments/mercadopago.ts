import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export type PaymentResult = {
  ok: boolean;
  url?: string;
  error?: string;
};

export async function createPaymentLink(
  organizationId: string,
  orderId: string
): Promise<PaymentResult> {
  const db = getDb();
  const settings = await db
    .select({ token: schema.commerceSettings.mercadopagoAccessToken })
    .from(schema.commerceSettings)
    .where(eq(schema.commerceSettings.organizationId, organizationId))
    .limit(1)
    .then((r) => r[0]);

  if (!settings?.token) {
    return { ok: false, error: "not_configured" };
  }

  const orderRec = await db
    .select()
    .from(schema.order)
    .where(scoped(schema.order.organizationId, organizationId, eq(schema.order.id, orderId)))
    .limit(1)
    .then((r) => r[0]);

  if (!orderRec) {
    return { ok: false, error: "order_not_found" };
  }

  if (orderRec.isPaid) {
    return { ok: false, error: "already_paid" };
  }

  // Verificar si ya hay un payment pendiente
  const existingPayment = await db
    .select()
    .from(schema.payment)
    .where(
      scoped(
        schema.payment.organizationId,
        organizationId,
        eq(schema.payment.orderId, orderId)
      )
    )
    .limit(1)
    .then((r) => r[0]);

  if (existingPayment?.paymentUrl && existingPayment.status === "pending") {
    return { ok: true, url: existingPayment.paymentUrl };
  }

  const items = (orderRec.items ?? []).map((item) => ({
    title: item.name,
    description: item.presentation ?? undefined,
    quantity: item.quantity,
    currency_id: "CLP",
    unit_price: item.unitPrice,
  }));

  const baseURL = process.env.PUBLIC_URL || "https://venta-max.ia";

  try {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items,
        external_reference: orderId,
        metadata: { organization_id: organizationId },
        notification_url: `${baseURL}/api/payments/webhook?source_news=webhooks`,
        auto_return: "approved",
      }),
    });

    if (!res.ok) {
      console.error("[MercadoPago] Error creating preference:", await res.text());
      return { ok: false, error: "provider_error" };
    }

    const data = await res.json();
    const url = data.init_point;
    const externalId = data.id;

    if (existingPayment) {
      await db
        .update(schema.payment)
        .set({ paymentUrl: url, externalId, updatedAt: new Date() })
        .where(eq(schema.payment.id, existingPayment.id));
    } else {
      await db.insert(schema.payment).values({
        id: crypto.randomUUID(),
        organizationId,
        orderId,
        provider: "mercadopago",
        externalId,
        amount: orderRec.totalAmount,
        status: "pending",
        paymentUrl: url,
      });
    }

    return { ok: true, url };
  } catch (error) {
    console.error("[MercadoPago] Exception:", error);
    return { ok: false, error: "provider_exception" };
  }
}
