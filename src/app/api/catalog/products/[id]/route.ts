import { apiError, parseBody, withAuth } from "@/lib/api";
import { CatalogError, deleteProduct, updateProduct } from "@/server/ecommerce/catalog";
import { productInput } from "../route";

function failure(error: CatalogError) { return apiError(error.code === "product_not_found" ? 404 : error.code === "invalid_category" ? 422 : 409, error.code, "No se pudo completar la operación de producto."); }
export const PATCH = withAuth(async (session, req: Request, context: { params: Promise<{ id: string }> }) => {
  const body = await parseBody(req, productInput); if (!body.ok) return body.response;
  try { return Response.json({ product: await updateProduct(session.organizationId, (await context.params).id, body.data) }); }
  catch (error) { if (error instanceof CatalogError) return failure(error); throw error; }
});
export const DELETE = withAuth(async (session, _req: Request, context: { params: Promise<{ id: string }> }) => {
  try { await deleteProduct(session.organizationId, (await context.params).id); return new Response(null, { status: 204 }); }
  catch (error) { if (error instanceof CatalogError) return failure(error); throw error; }
});
