import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const BRANDING_TTL_MS = 30000;
declare global {
  // eslint-disable-next-line no-var
  var __brandingCache: Map<string, { branding: Branding; expiresAt: number }> | undefined;
}
function getBrandingCache() {
  if (!globalThis.__brandingCache) {
    globalThis.__brandingCache = new Map();
  }
  return globalThis.__brandingCache;
}

export const getBranding = cache(async (
  organizationId?: string | null
): Promise<Branding> => {
  const cacheKey = organizationId ?? "__root__";
  const cacheMap = getBrandingCache();
  const cached = cacheMap.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.branding;
  }

  const db = getDb();
  const rows = organizationId
    ? await db
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    : // Sin sesión (login, layout raíz): la única organización de la instancia.
      await db
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .limit(1);
  if (!rows[0]) {
    cacheMap.set(cacheKey, { branding: DEFAULT_BRANDING, expiresAt: Date.now() + BRANDING_TTL_MS });
    return DEFAULT_BRANDING;
  }
  const meta = parseMetadata(rows[0].metadata);
  const result = normalizeBranding(
    (meta.branding as Partial<Branding> | undefined) ?? null
  );
  cacheMap.set(cacheKey, { branding: result, expiresAt: Date.now() + BRANDING_TTL_MS });
  return result;
});

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));

  getBrandingCache().delete(organizationId);
}
