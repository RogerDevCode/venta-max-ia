import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getSessionOrNull } from "@/lib/auth/session";
import { DEFAULT_BRANDING, isValidHex, resolveAccentSet } from "@/lib/branding";
import { getBranding, saveBranding } from "@/server/branding";
import { withTenantTransaction } from "@/lib/db/context";

export const dynamic = "force-dynamic";

/** GET público: el login necesita la marca antes de autenticarse. */
export async function GET() {
  const session = await getSessionOrNull();
  const branding = session
    ? await withTenantTransaction(
        session.organizationId,
        session.userId,
        "user",
        () => getBranding(session.organizationId),
      )
    : DEFAULT_BRANDING;
  return Response.json({ branding, accentSet: resolveAccentSet(branding.accent) });
}

const putSchema = z.object({
  name: z.string().trim().min(1).max(30),
  accent: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  await saveBranding(session.organizationId, body.data);
  return Response.json({ ok: true });
});
