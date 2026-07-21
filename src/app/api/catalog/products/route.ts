import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CatalogError, createProduct, listCatalogProducts } from "@/server/ecommerce/catalog";

export const dynamic = "force-dynamic";
const productInput = z.object({ sku: z.string().trim().max(80).optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable().optional(), price: z.number().int().min(0), stock: z.number().int().min(0), active: z.boolean(), categoryId: z.string().min(1) });
function failure(error: CatalogError) { return apiError(error.code === "invalid_category" ? 422 : 409, error.code, "No se pudo completar la operación de producto."); }
export const GET = withAuth(async (session) => Response.json({ products: await listCatalogProducts(session.organizationId) }));
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, productInput); if (!body.ok) return body.response;
  try { return Response.json({ product: await createProduct(session.organizationId, body.data) }, { status: 201 }); }
  catch (error) { if (error instanceof CatalogError) return failure(error); throw error; }
});
