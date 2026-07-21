import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CatalogError, deleteCategory, updateCategory } from "@/server/ecommerce/catalog";

const input = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable().optional() });
function failure(error: CatalogError) { return apiError(error.code === "category_not_found" ? 404 : 409, error.code, "No se pudo completar la operación de categoría."); }
export const PATCH = withAuth(async (session, req: Request, context: { params: Promise<{ id: string }> }) => {
  const body = await parseBody(req, input); if (!body.ok) return body.response;
  try { return Response.json({ category: await updateCategory(session.organizationId, (await context.params).id, body.data) }); }
  catch (error) { if (error instanceof CatalogError) return failure(error); throw error; }
});
export const DELETE = withAuth(async (session, _req: Request, context: { params: Promise<{ id: string }> }) => {
  try { return Response.json(await deleteCategory(session.organizationId, (await context.params).id)); }
  catch (error) { if (error instanceof CatalogError) return failure(error); throw error; }
});
