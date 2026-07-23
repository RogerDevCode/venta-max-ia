import { eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)` })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        session.organizationId,
        eq(schema.conversation.isTest, false)
      )
    );
  return Response.json({ unread: Number(rows[0]?.total ?? 0) });
});
