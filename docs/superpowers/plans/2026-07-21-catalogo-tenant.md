# Catálogo administrable por tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar CRUD seguro de categorías y productos por organización, con General como respaldo y navegación conversacional por botones/números.

**Architecture:** Centralizar las reglas del catálogo en un servicio tenant-scoped; las rutas autenticadas y el panel sólo consumen ese servicio. Reforzar la relación categoría-producto en PostgreSQL y guardar en `stateMetadata` los ids enumerados, para que el chat no infiera índices ni cruce tenants.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript estricto, Drizzle ORM/PostgreSQL, Zod, Tailwind/shadcn, Vitest y Playwright.

## Global Constraints

- Toda tabla y consulta de dominio usa `organization_id NOT NULL` y `scoped()`.
- No agregar dependencias ni infraestructura externa; SSE y Node in-process solamente.
- General cuenta dentro del máximo de 9; es protegida y se crea idempotentemente por tenant.
- Eliminar una categoría ordinaria mueve sus productos a General atómicamente; nunca borra productos.
- Precio y stock son enteros no negativos (precio en centavos); SKU y categoría se validan en API y servicio.
- La definición de hecho exige `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` y Playwright verde; el E2E borra sus datos aun ante fallo.

---

### Task 1: Reforzar el modelo PostgreSQL multi-tenant

**Files:**
- Modify: `src/lib/db/schema.ts:434-473`
- Create: `drizzle/0004_catalog_tenant_integrity.sql`
- Create: `tests/unit/catalog-schema.test.ts`

**Interfaces:**
- Produces `category` con nombre único por tenant y clave candidata `(organization_id,id)`.
- Produces `product` con FK compuesta `(organization_id,category_id)` y categoría obligatoria.

- [ ] **Step 1: Write the failing schema/migration test**

```ts
it("impide categorías repetidas y referencias cross-tenant", () => {
  expect(schema.category.organizationId.notNull).toBe(true);
  expect(schema.product.categoryId.notNull).toBe(true);
  expect(readFileSync("drizzle/0004_catalog_tenant_integrity.sql", "utf8"))
    .toContain('FOREIGN KEY ("organization_id","category_id")');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/catalog-schema.test.ts`
Expected: FAIL porque no existen la FK compuesta ni `categoryId` obligatorio.

- [ ] **Step 3: Write minimal implementation**

Añadir en Drizzle:

```ts
categoryId: text("category_id").notNull(),
uniqueIndex("category_org_name_uq").on(t.organizationId, t.name),
uniqueIndex("category_org_id_uq").on(t.organizationId, t.id),
```

La migración crea General con `INSERT ... SELECT ... ON CONFLICT DO NOTHING`,
reasigna los productos con categoría nula al General de su tenant, elimina la FK
simple, establece `category_id NOT NULL` y agrega
`FOREIGN KEY ("organization_id","category_id") ... ON DELETE RESTRICT`.
Conservar índices org-first y no afectar otro tenant.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm db:generate && pnpm vitest run tests/unit/catalog-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0004_catalog_tenant_integrity.sql tests/unit/catalog-schema.test.ts
git commit -m "feat: enforce tenant catalog integrity"
```

### Task 2: Implementar el servicio de dominio de catálogo

**Files:**
- Create: `src/server/ecommerce/catalog.ts`
- Modify: `src/server/ecommerce/service.ts:1-72`
- Create: `tests/unit/catalog-service.test.ts`

**Interfaces:**

```ts
export type CatalogCategory = {
  id: string; name: string; description: string | null;
  isGeneral: boolean; productCount: number;
};
export type CatalogProductInput = {
  sku: string; name: string; description?: string | null;
  price: number; stock: number; active: boolean; categoryId: string;
};
export class CatalogError extends Error {
  constructor(public code:
    "category_limit" | "general_protected" | "category_not_found" |
    "product_not_found" | "duplicate_category" | "duplicate_sku" |
    "invalid_category") { super(code); }
}
export function ensureGeneralCategory(organizationId: string): Promise<CatalogCategory>;
export function createCategory(organizationId: string, input: {
  name: string; description?: string | null;
}): Promise<CatalogCategory>;
export function updateCategory(organizationId: string, id: string, input: {
  name: string; description?: string | null;
}): Promise<CatalogCategory>;
export function deleteCategory(organizationId: string, id: string):
  Promise<{ movedProducts: number }>;
export function listCatalogProducts(organizationId: string, categoryId: string):
  Promise<CatalogProduct[]>;
```

- [ ] **Step 1: Write the failing domain tests**

```ts
it("crea General una sola vez y rechaza la décima categoría", async () => {
  await expect(createCategory("org_a", { name: "Diez" }))
    .rejects.toMatchObject({ code: "category_limit" });
});
it("mueve sólo los productos de la categoría eliminada a General", async () => {
  await expect(deleteCategory("org_a", "cat_tools"))
    .resolves.toEqual({ movedProducts: 2 });
  expect(productFromOtherTenant.categoryId).toBe("cat_other");
});
it("rechaza asignar una categoría de otro tenant a un producto", async () => {
  await expect(createProduct("org_a", { ...validProduct, categoryId: "cat_org_b" }))
    .rejects.toMatchObject({ code: "invalid_category" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/catalog-service.test.ts`
Expected: FAIL porque `catalog.ts` no existe.

- [ ] **Step 3: Write minimal implementation**

`ensureGeneralCategory` busca/crea General con carrera resuelta por la
restricción única. Crear categoría cuenta dentro de una transacción antes de
insertar. Normalizar nombres con `trim()` y reservar General para el helper.
En `deleteCategory`, ejecutar `db.transaction(async (tx) => ...)`: buscar
ambas categorías con tenant, actualizar sólo sus productos a General, borrar
sólo la solicitada y devolver el conteo. Crear, editar, borrar y listar
productos en el mismo módulo verifican siempre la categoría con
`organizationId`; adaptar `listarCategorias` y exportar
`listCatalogProducts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/catalog-service.test.ts tests/unit/ecommerce-tenant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ecommerce/catalog.ts src/server/ecommerce/service.ts tests/unit/catalog-service.test.ts
git commit -m "feat: add tenant catalog domain service"
```

### Task 3: Exponer API autenticada con validaciones

**Files:**
- Create: `src/app/api/catalog/categories/route.ts`
- Create: `src/app/api/catalog/categories/[id]/route.ts`
- Create: `src/app/api/catalog/products/route.ts`
- Create: `src/app/api/catalog/products/[id]/route.ts`
- Create: `tests/unit/catalog-api.test.ts`

**Interfaces:** GET entrega `{ categories }` / `{ products }`; escrituras
entregan `{ category }`, `{ product }` o `{ movedProducts }`; los errores
mantienen `{ error: { code, message } }`.

- [ ] **Step 1: Write the failing route tests**

```ts
expect((await POST(authOrgA, json({ name: "" }))).status).toBe(422);
expect((await POST(authOrgA, json(tenthCategory))).status).toBe(409);
expect((await DELETE(authOrgA, requestFor("cat_general"))).status).toBe(409);
expect((await POST(authOrgA, json({ ...product, categoryId: "cat_org_b" }))).status).toBe(422);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/catalog-api.test.ts`
Expected: FAIL porque las rutas no existen.

- [ ] **Step 3: Write minimal implementation**

Usar exactamente:

```ts
const categoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
});
const productInput = z.object({
  sku: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  price: z.number().int().min(0), stock: z.number().int().min(0),
  active: z.boolean(), categoryId: z.string().min(1),
});
```

Usar `withAuth`, `parseBody` y `session.organizationId` exclusivamente.
Mapear duplicado/límite/protegida a 409, ausente a 404 y referencia inválida a
422; nunca exponer errores SQL. Las lecturas aseguran General y ordenan General
primero, luego nombre ascendente.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/catalog-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/catalog tests/unit/catalog-api.test.ts
git commit -m "feat: add catalog management api"
```

### Task 4: Construir el CRUD de Configuración > Catálogo

**Files:**
- Create: `src/app/(app)/settings/catalog/page.tsx`
- Create: `src/components/settings/catalog-client.tsx`
- Modify: `src/components/settings/settings-nav.tsx:6-11`
- Create: `tests/unit/catalog-client.test.tsx`

**Interfaces:** consume la API de Task 3 y expone controles accesibles más
`data-testid` `category-form`, `product-form`,
`delete-category-<id>`, `category-general` y
`product-category-select`.

- [ ] **Step 1: Write the failing component tests**

```tsx
render(<CatalogClient />);
await screen.findByText("General");
expect(screen.getByRole("button", { name: /eliminar general/i })).toBeDisabled();
expect(screen.getByText(/9 de 9 categorías/i)).toBeInTheDocument();
expect(screen.getByRole("button", { name: /crear categoría/i })).toBeDisabled();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/catalog-client.test.tsx`
Expected: FAIL porque `CatalogClient` no existe.

- [ ] **Step 3: Write minimal implementation**

Seguir las pautas de fetch/error de `TemplatesClient`. Renderizar formulario y
lista de categorías con edición inline, contador `n de 9 categorías`, creación
deshabilitada al límite y General de sólo lectura. Antes de DELETE, abrir un
diálogo accesible: “Sus N productos se moverán a General”; refetch sólo tras
éxito.

Renderizar formulario/lista de productos con selector de categoría, edición,
borrado y error visible. Enviar precio/stock enteros; no eliminar
optimísticamente. Añadir pestaña `/settings/catalog` llamada Catálogo.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/catalog-client.test.tsx && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(app)'/settings/catalog/page.tsx src/components/settings/catalog-client.tsx src/components/settings/settings-nav.tsx tests/unit/catalog-client.test.tsx
git commit -m "feat: add catalog settings crud"
```

### Task 5: Navegación conversacional por categoría, retorno e inicio

**Files:**
- Modify: `src/server/ai/commands.ts:10-215`
- Modify: `src/server/ecommerce/service.ts:14-72`
- Modify: `tests/unit/slash-commands.test.ts`

**Interfaces:** callbacks `catalog:category:<id>`, `catalog:return`,
`catalog:home`; estado `catalogCategoryIds: string[]` y `current_state`.

- [ ] **Step 1: Write the failing command tests**

```ts
expect(parseSlashCommand("R")).toBe("catalog:return");
expect(parseSlashCommand("i")).toBe("catalog:home");
await processSlashCommand({ command: "menu:categorias", conversation, lastInboundWaId: "tg_1" });
expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
  replyMarkup: { inline_keyboard: expect.arrayContaining([
    expect.arrayContaining([expect.objectContaining({ text: "1. General" })])
  ]) }
}));
await processSlashCommand({ command: "catalog:number:2", conversation: categoryState });
expect(mockListCatalogProducts).toHaveBeenCalledWith("org_cmd_123", "cat_2");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts`
Expected: FAIL porque los comandos y consulta por categoría no existen.

- [ ] **Step 3: Write minimal implementation**

Extender parser sólo para `r`/`R`, `i`/`I`, callbacks `catalog:*` y
números cuando `current_state === "menu:catalog"`. Resolver número a través
de `catalogCategoryIds` de estado, validar límite y llamar
`listCatalogProducts(organizationId, categoryId)`. Nunca convertir texto
libre a id.

Crear teclado Telegram de 1–9 con etiquetas enumeradas y, al ver productos,
botones Retornar/Inicio. Para otros canales enviar la lista seguida de
`R. Retornar · I. Inicio`. Un id borrado o inválido vuelve a mostrar categorías
actualizadas. Retornar limpia categoría seleccionada; Inicio reutiliza el
renderer del menú principal.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/commands.ts src/server/ecommerce/service.ts tests/unit/slash-commands.test.ts
git commit -m "feat: browse catalog categories in chat"
```

### Task 6: Automatizar Playwright y limpieza de datos

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/catalog-crud.spec.ts`
- Modify: `package.json:8-28`
- Create: `tests/e2e/README.md`

**Interfaces:** produce `pnpm test:e2e:catalog`, que corre contra un servidor
local con mocks y una organización `e2e_catalog_<timestamp>` limpiada al final.

- [ ] **Step 1: Write the failing E2E spec**

```ts
test("CRUD, límite, General y navegación de catálogo", async ({ page }) => {
  await registerAndLogin(page, uniqueCredentials);
  await page.goto("/settings/catalog");
  await expect(page.getByText("General")).toBeVisible();
  // Crear ocho categorías, rechazar la décima ordinaria y verificar reasignación.
  // Recorrer botón/número/R/I con el harness de mensajes mock.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e:catalog`
Expected: FAIL porque faltan configuración, UI y flujo completo.

- [ ] **Step 3: Write minimal implementation**

Configurar `webServer` con `pnpm dev`, URL local y variables mock; prohibir
red externa. Registrar mediante UI real y ejercer CRUD mediante el panel.
Cubrir General protegida, alta/edición/borrado de cada entidad, nueve categorías,
décima rechazada, reasignación, producto inactivo fuera del chat, botón de
categoría, número, Retornar/`r`, Inicio/`I` y un intento cross-tenant seguro.

Usar `try/finally` y `test.afterAll`: el helper de prueba puede inspeccionar
y borrar exclusivamente el tenant generado, en orden FK-safe
(order, cart, product, category, auth/organización). Aserta que no quedan filas
con el prefijo antes de cerrar.

- [ ] **Step 4: Run test to verify it passes twice**

Run: `pnpm test:e2e:catalog && pnpm test:e2e:catalog`
Expected: PASS dos veces; confirma limpieza e idempotencia.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/catalog-crud.spec.ts tests/e2e/README.md package.json
git commit -m "test: cover tenant catalog crud end to end"
```

### Task 7: Ejecutar puerta completa y actualizar trazabilidad

**Files:**
- Modify: `specs/002-migracion-chatbot-rag-telegram/plan.md:73-80`
- Modify: `docs/superpowers/specs/2026-07-21-catalogo-tenant-design.md` sólo ante desviación documentada.

- [ ] **Step 1: Apply migration**

Run: `pnpm db:migrate`
Expected: `0004_catalog_tenant_integrity` aplica y los productos existentes
quedan en General de su tenant.

- [ ] **Step 2: Run static and unit gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todos salen 0.

- [ ] **Step 3: Run final browser verification**

Run: `pnpm test:e2e:catalog`
Expected: PASS y cero fixtures restantes.

- [ ] **Step 4: Record and inspect**

Actualizar casillas de migración con comandos/PASS.

Run: `git diff --check && git status --short`
Expected: sin errores de whitespace y sólo archivos previstos.

- [ ] **Step 5: Commit**

```bash
git add specs/002-migracion-chatbot-rag-telegram/plan.md docs/superpowers/specs/2026-07-21-catalogo-tenant-design.md
git commit -m "docs: verify tenant catalog migration"
```

## Self-review

- Cobertura: Tasks 1–3 cubren integridad, aislamiento, General, límite y validación; Task 4 el CRUD del tenant; Task 5 botones, 1–9, `R/r`, `I/i`; Task 6 Playwright, combinaciones y limpieza; Task 7 todas las puertas de calidad.
- Ambigüedad resuelta: General está persistida, cuenta dentro del límite, es protegida y recibe productos por transacción.
- Consistencia: API, UI y comandos usan los contratos del servicio de Task 2; ninguna entrada del chat contiene un `organizationId` controlado por cliente.

