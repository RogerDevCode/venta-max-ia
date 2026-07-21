import { apiError, parseBody, withAuth } from "@/lib/api";
import { CatalogError, deleteProduct, updateProduct } from "@/server/ecommerce/catalog";
import { z } from "zod";

const productInput = z.object({ sku: z.string().trim().max(80).optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable().optional(), price: z.number().int().min(0), stock: z.number().int().min(0), active: z.boolean(), categoryId: z.string().min(1) });

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
