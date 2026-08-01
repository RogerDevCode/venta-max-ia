import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function sha256(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ verifyToken: string }> }
) {
  try {
    const p = await params;
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === p.verifyToken) {
      const db = getDb();
      const tokenHash = sha256(token);
      
      const integration = await db
        .select()
        .from(schema.whatsappIntegration)
        .where(eq(schema.whatsappIntegration.verifyTokenHash, tokenHash))
        .limit(1)
        .then((r) => r[0]);

      if (integration) {
        // Confirmar webhook a Meta
        return new Response(challenge, { status: 200 });
      }
    }
    return new Response("Forbidden", { status: 403 });
  } catch {
    return new Response("Internal Error", { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ verifyToken: string }> }
) {
  try {
    const p = await params;
    // 1. Validar Token en la URL
    const tokenHash = sha256(p.verifyToken);
    const db = getDb();
    
    const integration = await db
      .select()
      .from(schema.whatsappIntegration)
      .where(eq(schema.whatsappIntegration.verifyTokenHash, tokenHash))
      .limit(1)
      .then((r) => r[0]);

    if (!integration) {
      return new Response("Forbidden", { status: 403 });
    }

    const body = await req.json();

    // 2. Procesar Webhook (solo acknowledge, lógica de ingesta en outbox iría aquí)
    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.value && change.value.messages) {
            // Se recibió un mensaje: Encolarlo para procesamiento
            console.log("[WhatsApp Webhook] Mensaje recibido:", JSON.stringify(change.value.messages));
          }
        }
      }
      return Response.json({ success: true });
    }
    
    return Response.json({ success: true });
  } catch (error) {
    console.error("[WhatsApp Webhook Error]:", error);
    return new Response("Internal Error", { status: 500 });
  }
}
