import { and, eq, inArray } from "drizzle-orm";
import { getAuthDb, getDb, schema } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";
import { generateEmbedding } from "@/server/ai/rag/embeddings";
import { BOTILLERIA_FAQS, botilleriaFaqId } from "@/server/seed/botilleria-faq";
import "./enforce-ipv4";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export async function seedBotilleriaFaq(input: { organizationId: string; withEmbeddings?: boolean }) {
  const organization = await getAuthDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, input.organizationId))
    .limit(1);
  if (!organization[0]) throw new Error("La organización indicada no existe.");

  return withJobTransaction(input.organizationId, async () => {
  const db = getDb();

  const ids = BOTILLERIA_FAQS.map((_, index) => botilleriaFaqId(input.organizationId, index));
  const embeddings: Array<number[] | null> = [];
  if (input.withEmbeddings !== false) {
    for (const [question, answer] of BOTILLERIA_FAQS) {
      try {
        embeddings.push(await generateEmbedding(`Pregunta: ${question}\nRespuesta: ${answer}`));
      } catch {
        embeddings.push(null);
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.kbEntry).where(and(
      eq(schema.kbEntry.organizationId, input.organizationId),
      inArray(schema.kbEntry.id, ids),
    ));
    await tx.insert(schema.kbEntry).values(BOTILLERIA_FAQS.map(([question, answer], index) => ({
      id: ids[index]!,
      organizationId: input.organizationId,
      kind: "qa" as const,
      question,
      answer,
      embedding: embeddings[index] ?? null,
    })));
  });
  return { count: BOTILLERIA_FAQS.length, embedded: embeddings.filter((embedding) => embedding !== null).length };
  });
}

async function main() {
  const organizationId = option("--organization");
  if (!organizationId) throw new Error("Uso: pnpm seed:botilleria-faq -- --organization <id>");
  const result = await seedBotilleriaFaq({ organizationId, withEmbeddings: !process.argv.includes("--skip-embeddings") });
  console.log(`FAQ de Botillería STAX Demo actualizadas: ${result.count} entradas; ${result.embedded} con embeddings.`);
}

if (process.argv[1]?.includes("seed-botilleria-faq")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }).finally(() => {
    process.exit();
  });
}
