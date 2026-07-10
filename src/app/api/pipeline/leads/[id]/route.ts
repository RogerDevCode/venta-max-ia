import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  stageId: z.string().min(1),
  position: z.number().int().min(0),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const stage = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        session.organizationId,
        eq(schema.pipelineStage.id, body.data.stageId)
      )
    )
    .limit(1);
  if (!stage[0]) return apiError(422, "invalid_stage", "Etapa inexistente");

  const updated = await db
    .update(schema.lead)
    .set({
      stageId: body.data.stageId,
      position: body.data.position,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        eq(schema.lead.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Lead no encontrado");
  return Response.json({ lead: updated[0] });
});
