import { and, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const DELETE = withAuth(
  async (
    session,
    _req: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    if (session.role !== "owner") {
      return apiError(
        403,
        "forbidden",
        "Solo el propietario puede eliminar miembros"
      );
    }
    const { id } = await context.params;
    const db = getDb();

    // Verificamos si el miembro existe en la organización actual
    const [target] = await db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        userId: schema.member.userId,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, id),
          scoped(schema.member.organizationId, session.organizationId)
        )
      );

    if (!target) {
      return apiError(404, "not_found", "Miembro no encontrado");
    }

    if (target.role === "owner") {
      return apiError(
        400,
        "invalid",
        "No se puede eliminar al propietario de la organización"
      );
    }

    // Eliminamos la membresía en la organización del tenant
    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.id, id),
          scoped(schema.member.organizationId, session.organizationId)
        )
      );

    // Revocamos las sesiones activas de ese usuario para esta organización
    await db
      .delete(schema.session)
      .where(
        and(
          eq(schema.session.userId, target.userId),
          eq(schema.session.activeOrganizationId, session.organizationId)
        )
      );

    return Response.json({ ok: true });
  }
);
