import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getCommerceSettings, saveCommerceSettings } from "@/server/ecommerce/settings";

export const dynamic = "force-dynamic";

const input = z.object({
  maxUnitsPerProduct: z.number().int().min(1).max(1000).optional(),
  autoExpirationHours: z.number().int().min(1).max(720).optional(),
});

export const GET = withAuth(async (session) =>
  Response.json({ settings: await getCommerceSettings(session.organizationId) })
);

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, input);
  if (!body.ok) return body.response;
  return Response.json({
    settings: await saveCommerceSettings(session.organizationId, body.data),
  });
});
