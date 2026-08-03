export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // MercadoPago test/ping webhooks
    if (body.action === "test.created" || !body.data?.id) {
      return Response.json({ success: true });
    }

    // Fail closed: nunca se mutan pagos con un payload no autenticado. La
    // integración se habilitará cuando valide la firma HMAC de Mercado Pago y
    // resuelva el tenant desde una referencia opaca emitida por el servidor.
    return Response.json(
      { success: false, error: "payment_webhook_not_configured" },
      { status: 503 },
    );
  } catch (err) {
    console.error("[MP Webhook Error]:", err);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
