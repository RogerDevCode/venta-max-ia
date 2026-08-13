import { getDb, schema } from "@/lib/db";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { sendMessage } from "@/lib/telegram/client";
import { decryptSecret } from "@/lib/crypto";

export function getYesterdayDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return formatter.format(yesterday); // e.g. '2026-08-12'
}

export function getYesterdayReadableString(): string {
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'long'
  });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return formatter.format(yesterday); // e.g. '12 de agosto'
}

export function formatSummaryMessage(params: {
  dateStr: string;
  businessName: string;
  conversations: number;
  contacts: number;
  activeLeads: number;
  newOrders: number;
}): string {
  return `Resumen del ${params.dateStr}
${params.businessName}

Conversaciones nuevas: ${params.conversations}
Contactos nuevos: ${params.contacts}
Leads activos (total): ${params.activeLeads}
Pedidos nuevos: ${params.newOrders}

Generado automaticamente por Tu Vitrina`;
}

export async function sendDailySummaryToAll(): Promise<void> {
  const db = getDb();
  
  // Find integrations with notificationChatId configured and connected
  const integrations = await db.select().from(schema.telegramIntegration)
    .where(
      and(
        eq(schema.telegramIntegration.status, 'connected'),
        isNotNull(schema.telegramIntegration.notificationChatId)
      )
    );

  const ymdStr = getYesterdayDateString();
  const readableStr = getYesterdayReadableString();

  for (const integration of integrations) {
    try {
      if (!integration.notificationChatId || !integration.tokenCipher || !integration.tokenIv || !integration.tokenTag) {
        continue;
      }
      
      const orgId = integration.organizationId;
      
      // Get org name
      const orgs = await db.select({ name: schema.organization.name }).from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1);
      const businessName = orgs[0]?.name || "Tu Negocio";

      const token = decryptSecret({ cipher: integration.tokenCipher, iv: integration.tokenIv, tag: integration.tokenTag });

      // Count new conversations yesterday
      const convs = await db.select({ count: sql<number>`count(*)::int` }).from(schema.conversation)
        .where(and(
          eq(schema.conversation.organizationId, orgId),
          sql`(${schema.conversation.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santiago')::date = ${ymdStr}::date`
        ));
      
      // Count new contacts yesterday
      const contacts = await db.select({ count: sql<number>`count(*)::int` }).from(schema.contact)
        .where(and(
          eq(schema.contact.organizationId, orgId),
          sql`(${schema.contact.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santiago')::date = ${ymdStr}::date`
        ));

      // Count total active leads
      const activeLeads = await db.select({ count: sql<number>`count(*)::int` }).from(schema.lead)
        .where(eq(schema.lead.organizationId, orgId));
        
      // Count new orders yesterday
      const orders = await db.select({ count: sql<number>`count(*)::int` }).from(schema.order)
        .where(and(
          eq(schema.order.organizationId, orgId),
          sql`(${schema.order.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santiago')::date = ${ymdStr}::date`
        ));

      const message = formatSummaryMessage({
        dateStr: readableStr,
        businessName,
        conversations: convs[0]?.count || 0,
        contacts: contacts[0]?.count || 0,
        activeLeads: activeLeads[0]?.count || 0,
        newOrders: orders[0]?.count || 0,
      });

      await sendMessage({
        token: token,
        chatId: integration.notificationChatId,
        text: message
      });
      
    } catch (err) {
      console.error(`[DailySummary] Error sending summary to org ${integration.organizationId}:`, err);
    }
  }
}
