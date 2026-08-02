# FAQ Botillería STAX Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sembrar y mantener 32 FAQ demostrativas, recuperables por RAG y aisladas para el tenant de Botillería STAX Demo.

**Architecture:** Un script dedicado recibe un `organizationId`, reemplaza exclusivamente las entradas QA que él mismo marca como demo y conserva toda FAQ creada por un operador. La información se declara como demostrativa y editable; no se copia texto ni condiciones de otros negocios. Las pruebas validan contenido, aislamiento y que no se borren conocimientos ajenos.

**Tech Stack:** TypeScript, tsx, Drizzle ORM, PostgreSQL/pgvector, Vitest.

## Global Constraints

- Cada operación lleva `organizationId`; no modificar datos de otros tenants.
- Las condiciones de horario, cobertura y pago son demostrativas y editables.
- No prometer stock, tarifa, entrega, horario ni precio definitivo.
- Reutilizar `schema.kbEntry`, `getDb()` y los scripts de seed existentes.
- No incluir secretos ni dumps de base de datos en Git.

---

### Task 1: Definir el contenido versionado de las FAQ demo

**Files:**
- Create: `src/server/seed/botilleria-faq.ts`
- Test: `tests/unit/botilleria-faq.test.ts`

**Interfaces:**
- Produces: `BOTILLERIA_FAQ_VERSION: "botilleria-demo-v1"`.
- Produces: `BOTILLERIA_FAQS: ReadonlyArray<{ question: string; answer: string }>` con exactamente 32 entradas.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, it } from "vitest";
import { BOTILLERIA_FAQS, BOTILLERIA_FAQ_VERSION } from "@/server/seed/botilleria-faq";

it("define 32 FAQ demo concretas y no promete condiciones definitivas", () => {
  expect(BOTILLERIA_FAQ_VERSION).toBe("botilleria-demo-v1");
  expect(BOTILLERIA_FAQS).toHaveLength(32);
  expect(BOTILLERIA_FAQS.map((faq) => faq.question)).toEqual(expect.arrayContaining([
    "¿Cuál es el horario de atención de Botillería STAX Demo?",
    "¿Qué comunas cubre el delivery de Botillería STAX Demo?",
    "¿Qué medios de pago acepta Botillería STAX Demo?",
  ]));
  expect(BOTILLERIA_FAQS.map((faq) => faq.answer).join(" ").toLowerCase()).not.toContain("garantizado");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/botilleria-faq.test.ts`

Expected: FAIL because `botilleria-faq.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const BOTILLERIA_FAQ_VERSION = "botilleria-demo-v1" as const;
export const BOTILLERIA_FAQS = [
  { question: "¿Cuál es el horario de atención de Botillería STAX Demo?", answer: "La atención demo opera de lunes a jueves entre 10:00 y 00:00; viernes y sábado hasta 01:00; domingo hasta 22:30. Revisa el catálogo antes de pedir: el horario real siempre lo define el negocio." },
  ...BOTILLERIA_FAQ_CONTENT,
] as const;
```

Define `BOTILLERIA_FAQ_CONTENT` above as the remaining 31 complete QA entries, one entry for each of: cierre, cinco preguntas de cobertura y delivery, cinco de pago y retiro, siete de catálogo, siete de ciclo de pedido, atención humana, mayor de edad, recepción y datos. Each answer must state confirmation when delivery, stock, payment or price can vary.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/botilleria-faq.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/seed/botilleria-faq.ts tests/unit/botilleria-faq.test.ts
git commit -m "feat: definir conocimiento de botilleria demo"
```

### Task 2: Crear un seed idempotente y aislado

**Files:**
- Create: `scripts/seed-botilleria-faq.ts`
- Modify: `package.json`
- Test: `tests/integration/botilleria-faq-seed.test.ts`

**Interfaces:**
- Consumes: `BOTILLERIA_FAQS`, `BOTILLERIA_FAQ_VERSION`.
- Produces: CLI `pnpm seed:botilleria-faq -- --organization <id>`.
- Uses deterministic IDs `kb_botilleria_demo_01` through `kb_botilleria_demo_32` to identify only its own rows.

- [ ] **Step 1: Write the failing integration test**

```ts
it("crea 32 FAQ para el tenant objetivo y conserva las FAQ ajenas", async () => {
  await seedBotilleriaFaq({ organizationId: targetOrgId });
  expect(await countDemoFaq(targetOrgId)).toBe(32);
  expect(await countDemoFaq(otherOrgId)).toBe(0);
  await insertOperatorFaq(targetOrgId, "¿Puedo retirar hoy?", "Sí, confirma antes de salir.");
  await seedBotilleriaFaq({ organizationId: targetOrgId });
  expect(await findOperatorFaq(targetOrgId)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/botilleria-faq-seed.test.ts`

Expected: FAIL because the seed module does not exist.

- [ ] **Step 3: Implement the isolated seed**

```ts
export async function seedBotilleriaFaq(input: { organizationId: string }) {
  const db = getDb();
  const organization = await db.select({ id: schema.organization.id })
    .from(schema.organization).where(eq(schema.organization.id, input.organizationId)).limit(1);
  if (!organization[0]) throw new Error("La organización indicada no existe.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.kbEntry).where(and(
      eq(schema.kbEntry.organizationId, input.organizationId),
      inArray(schema.kbEntry.id, BOTILLERIA_FAQS.map((_, index) => `kb_botilleria_demo_${String(index + 1).padStart(2, "0")}`)),
    ));
    await tx.insert(schema.kbEntry).values(BOTILLERIA_FAQS.map((faq, index) => ({
      id: `kb_botilleria_demo_${String(index + 1).padStart(2, "0")}`,
      organizationId: input.organizationId, kind: "qa", question: faq.question, answer: faq.answer,
    })));
  });
}
```

Import `and` and `inArray` from `drizzle-orm`. The deterministic IDs avoid a schema migration and never select rows by question text.

- [ ] **Step 4: Add package command and verify it**

```json
"seed:botilleria-faq": "tsx scripts/seed-botilleria-faq.ts"
```

Run: `pnpm vitest run tests/integration/botilleria-faq-seed.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-botilleria-faq.ts package.json tests/integration/botilleria-faq-seed.test.ts
git commit -m "feat: sembrar FAQ aisladas de botilleria"
```

### Task 3: Sembrar, comprobar recuperación y regresión

**Files:**
- Modify: `tests/unit/rag-builder.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-faq-botilleria-demo-design.md`

**Interfaces:**
- Consumes: `seedBotilleriaFaq({ organizationId })`.
- Verifies: las preguntas sobre horario, comunas, pago, delivery, pedido y consumo responsable recuperan una respuesta relevante del tenant correcto.

- [ ] **Step 1: Add RAG retrieval assertions**

```ts
for (const query of ["horario", "comunas de delivery", "pagar con tarjeta", "cancelar pedido", "mayor de edad"]) {
  const context = await buildRagContext({ organizationId: targetOrgId, query });
  expect(context).toContain("Botillería STAX Demo");
}
```

- [ ] **Step 2: Run targeted validation**

Run: `pnpm vitest run tests/unit/botilleria-faq.test.ts tests/integration/botilleria-faq-seed.test.ts tests/unit/rag-builder.test.ts`

Expected: PASS.

- [ ] **Step 3: Seed the local demo tenant explicitly**

Run: `pnpm seed:botilleria-faq -- --organization org_x3jnpp3eyk6h608shh3k`

Expected: output confirms exactly 32 FAQ written for that organization.

- [ ] **Step 4: Verify through PostgreSQL**

Run:

```bash
docker compose exec -T postgres psql -U postgres -d vocero -c \
  "select count(*) from kb_entry where organization_id = 'org_x3jnpp3eyk6h608shh3k';"
```

Expected: `32` plus any operator-created FAQ, never rows from other tenants.

- [ ] **Step 5: Run regression and commit**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all tests and production build PASS.

```bash
git add tests/unit/rag-builder.test.ts docs/superpowers/specs/2026-08-01-faq-botilleria-demo-design.md
git commit -m "test: validar FAQ de botilleria en RAG"
```
