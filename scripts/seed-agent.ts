import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema.ts";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "../src/lib/db/index.ts";

async function seed() {
  const db = getDb();
  const orgs = await db.select().from(schema.organization).limit(1);
  if (orgs.length === 0) process.exit(1);
  const orgId = orgs[0].id;

  // 1. Actualizar Perfil del Agente
  const instructions = `Eres el Agente Virtual de Venta Max IA. Tu trabajo es asistir a los clientes de forma rápida, amable y precisa.
REGLA DE ORO 1: SOLO puedes proporcionar información que se encuentre estrictamente en tu CONOCIMIENTO DEL NEGOCIO o en el catálogo de productos.
REGLA DE ORO 2: Si el cliente hace una pregunta que NO está cubierta en tus datos, DEBES responder cortésmente que no dispones de esa información y ofrecer contactarlo con un asesor humano o realizar otra consulta relacionada. ¡BAJO NINGUNA CIRCUNSTANCIA DEBES INVENTAR DATOS, PRECIOS O POLÍTICAS!
REGLA DE ORO 3: Ve al grano. No uses saludos largos en cada mensaje, sé conversacional y mantén la cordialidad.
REGLA DE ORO 4: Tu respuesta nunca debe exceder los 2-3 párrafos cortos.`;

  await db.update(schema.agentProfile)
    .set({
      name: "Max",
      tone: "Amable, directo y resolutivo.",
      instructions,
      greeting: "¡Hola! Soy Max de Venta Max IA 💪. ¿En qué te puedo ayudar hoy? (Puedes preguntarme por productos, precios o condiciones de envío).",
      escalationRules: "Si preguntan por compras al por mayor (>50 unidades), problemas con un pedido anterior o dudas técnicas sobre suplementos de prescripción médica, transfiere a humano.",
    })
    .where(eq(schema.agentProfile.organizationId, orgId));

  // 2. Insertar Knowledge Base (FAQ)
  await db.delete(schema.kbEntry).where(eq(schema.kbEntry.organizationId, orgId));

  const faqs = [
    { q: "¿Cuáles son los métodos de pago?", a: "Por ahora, al confirmar tu pedido puedes pagar mediante transferencia bancaria o en efectivo al momento de la entrega (solo en la Región Metropolitana). También puedes solicitarnos un link de MercadoPago." },
    { q: "¿Hacen envíos a todo Chile?", a: "Sí, enviamos a todo Chile. Los envíos a la Región Metropolitana toman 24 a 48 horas hábiles. A otras regiones, los envíos se realizan por Starken o Chilexpress por pagar y toman entre 3 a 5 días hábiles." },
    { q: "¿Tienen tienda física?", a: "Actualmente operamos de manera 100% online (Dark Store), lo que nos permite ofrecerte mejores precios. No tenemos punto de retiro físico por ahora." },
    { q: "¿Cuál es el horario de atención del soporte humano?", a: "Nuestros asesores humanos atienden de Lunes a Viernes de 09:00 a 18:30 horas. Yo (el asistente virtual) estoy disponible 24/7 para recibir tus pedidos." },
    { q: "¿Puedo cambiar o devolver un producto?", a: "Sí. Tienes 10 días desde que recibes tu pedido para solicitar un cambio o devolución, siempre y cuando el producto esté sellado y sin uso. No se aceptan devoluciones de suplementos abiertos por normativa sanitaria." },
    { q: "¿Tienen precios al por mayor?", a: "Sí, a partir de compras sobre $200.000 CLP. Si te interesa, pídele a un humano que te atienda para revisar tu caso comercial." }
  ];

  for (const faq of faqs) {
    await db.insert(schema.kbEntry).values({
      id: "kb_" + randomUUID().substring(0, 8),
      organizationId: orgId,
      kind: "qa",
      question: faq.q,
      answer: faq.a,
    });
  }

  console.log("✓ Perfil del agente actualizado y FAQ poblada.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});
