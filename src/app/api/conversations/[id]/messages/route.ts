import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation, listMessages } from "@/server/inbox/queries";
import { serializeMessage } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const messages = await listMessages(
    session.organizationId,
    id,
    since && !Number.isNaN(since.getTime()) ? since : undefined
  );
  return Response.json({ messages: messages.map(serializeMessage) });
});

const sendSchema = z.object({ text: z.string().trim().min(1).max(4096) });

const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  not_connected: 409,
  reconnect_required: 409,
  telegram_error: 422,
  telegram_unavailable: 503,
};

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const result = await sendText({
      conversationId: id,
      organizationId: session.organizationId,
      text: body.data.text,
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});

export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const { clearConversationMessages } = await import("@/server/inbox/queries");
  const { publish } = await import("@/server/events/bus");

  const result = await clearConversationMessages(session.organizationId, id);

  const freshRow = await getConversation(session, id);
  if (freshRow) {
    const { serializeConversation } = await import("@/server/inbox/queries");
    const dto = serializeConversation(freshRow.conversation, freshRow.contact);
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: dto },
    });
  }

  return Response.json({ ok: true, clearedCount: result.clearedCount });
});
