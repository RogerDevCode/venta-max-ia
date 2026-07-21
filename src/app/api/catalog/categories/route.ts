import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CatalogError, createCategory, listCategories } from "@/server/ecommerce/catalog";

export const dynamic = "force-dynamic";
const input = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable().optional() });
function catalogError(error: CatalogError) {
  const status = error.code === "category_not_found" ? 404 : 409;
  return apiError(status, error.code, error.code === "category_limit" ? "Se permite un máximo de 9 categorías." : "No se pudo completar la operación de categoría.");
}
export const GET = withAuth(async (session) => Response.json({ categories: await listCategories(session.organizationId) }));
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, input); if (!body.ok) return body.response;
  try { return Response.json({ category: await createCategory(session.organizationId, body.data) }, { status: 201 }); }
  catch (error) { if (error instanceof CatalogError) return catalogError(error); throw error; }
});
