# Telegram Product Quantity Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-safe Telegram flow that lists numbered products without SKU/null, accepts a typed quantity, enforces tenant and stock limits, adds by product ID, and decrements inventory only when an order is confirmed.

**Architecture:** PostgreSQL remains the source of truth. A tenant-scoped `commerce_settings` row supplies the per-product cart limit; the conversation FSB stores only a selected product ID while awaiting quantity; cart mutations use product IDs and never reserve stock. Order confirmation locks product rows and validates/decrements stock in one transaction.

**Tech Stack:** TypeScript, Next.js 15, React 19, Drizzle ORM, PostgreSQL 18/pgvector, Telegram Bot API, Vitest.

## Global Constraints

- Do not expose or accept SKU in customer messages, callbacks, FSB state, or new cart items; SKU remains administrative only.
- `product.description` is the customer-facing presentation; omit it when empty and never render `null`.
- Default `max_units_per_product` is exactly `10` and is configurable per tenant.
- Every new domain table includes `organization_id NOT NULL` and an org-first key/index; every domain query uses `scoped(organization_id)`.
- Adding to a cart does not reserve or subtract inventory.
- Order confirmation validates and decrements inventory atomically in PostgreSQL.
- Old/double Telegram callbacks stay visible but are silently ignored by the existing single-use menu guard.
- Test conversations (`is_test: true`) never call Telegram.
- Use `./scripts/du.sh` and `./scripts/run.sh`; the application runs on port `3000`.
- Every background promise uses `.catch(logError)` or `Promise.allSettled()`.

---

## File Structure

- Create `src/server/ecommerce/settings.ts`: tenant-scoped read/write API for commerce limits.
- Create `src/app/api/catalog/settings/route.ts`: authenticated GET/PATCH route.
- Create `src/server/ecommerce/quantity.ts`: pure integer parsing and customer-safe formatting.
- Modify `src/lib/db/schema.ts` and generated migration: `commerce_settings`.
- Modify `src/components/settings/catalog-client.tsx`: tenant limit editor.
- Modify `src/server/ai/commands.ts`: product buttons, selection, quantity FSB flow.
- Modify `src/server/ecommerce/service.ts`: add by product ID, no cart reservation, atomic order confirmation.
- Modify `src/server/ecommerce/cache.ts`: remove active-cart reservation accounting.
- Modify `src/server/ai/actions.ts`, `src/server/ai/prompts.ts`, and `src/server/ai/pipeline.ts`: stop customer purchase operations from using SKU.
- Add focused unit and PostgreSQL integration tests under `tests/unit` and `tests/integration`.

---

### Task 1: Tenant commerce limit

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/server/ecommerce/settings.ts`
- Create: `src/app/api/catalog/settings/route.ts`
- Create: `tests/unit/ecommerce-settings.test.ts`
- Create: generated `drizzle/0009_*.sql` and snapshot metadata

**Interfaces:**
- Produces: `getCommerceSettings(organizationId): Promise<{ maxUnitsPerProduct: number }>`
- Produces: `saveCommerceSettings(organizationId, { maxUnitsPerProduct }): Promise<{ maxUnitsPerProduct: number }>`
- HTTP: `GET /api/catalog/settings`, `PATCH /api/catalog/settings` with `{ maxUnitsPerProduct: integer 1..1000 }`

- [ ] **Step 1: Write failing tenant/default tests**

```ts
it("returns the default limit when the tenant has no settings row", async () => {
  await expect(getCommerceSettings("org_a")).resolves.toEqual({ maxUnitsPerProduct: 10 });
});

it("never reads another tenant's limit", async () => {
  await saveCommerceSettings("org_a", { maxUnitsPerProduct: 3 });
  await expect(getCommerceSettings("org_b")).resolves.toEqual({ maxUnitsPerProduct: 10 });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `pnpm vitest run tests/unit/ecommerce-settings.test.ts`  
Expected: FAIL because `@/server/ecommerce/settings` does not exist.

- [ ] **Step 3: Add schema and service**

```ts
export const commerceSettings = pgTable("commerce_settings", {
  organizationId: text("organization_id").primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  maxUnitsPerProduct: integer("max_units_per_product").notNull().default(10),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [check("commerce_settings_max_units_positive", sql`${t.maxUnitsPerProduct} > 0`)]);
```

```ts
export const DEFAULT_MAX_UNITS_PER_PRODUCT = 10;

export async function getCommerceSettings(organizationId: string) {
  const rows = await getDb().select({ maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct })
    .from(schema.commerceSettings)
    .where(scoped(schema.commerceSettings.organizationId, organizationId))
    .limit(1);
  return { maxUnitsPerProduct: rows[0]?.maxUnitsPerProduct ?? DEFAULT_MAX_UNITS_PER_PRODUCT };
}
```

```ts
export async function saveCommerceSettings(
  organizationId: string,
  input: { maxUnitsPerProduct: number }
) {
  const rows = await getDb().insert(schema.commerceSettings)
    .values({ organizationId, maxUnitsPerProduct: input.maxUnitsPerProduct })
    .onConflictDoUpdate({
      target: schema.commerceSettings.organizationId,
      set: { maxUnitsPerProduct: input.maxUnitsPerProduct, updatedAt: new Date() },
    })
    .returning({ maxUnitsPerProduct: schema.commerceSettings.maxUnitsPerProduct });
  return rows[0]!;
}
```

- [ ] **Step 4: Add authenticated route validation**

```ts
const input = z.object({ maxUnitsPerProduct: z.number().int().min(1).max(1000) });
export const GET = withAuth(async (session) =>
  Response.json({ settings: await getCommerceSettings(session.organizationId) }));
export const PATCH = withAuth(async (session, req) => {
  const body = await parseBody(req, input);
  if (!body.ok) return body.response;
  return Response.json({ settings: await saveCommerceSettings(session.organizationId, body.data) });
});
```

- [ ] **Step 5: Generate/apply migration and run tests**

Run: `pnpm db:generate && pnpm db:migrate && pnpm vitest run tests/unit/ecommerce-settings.test.ts && pnpm typecheck`  
Expected: migration applied; tests and typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/server/ecommerce/settings.ts src/app/api/catalog/settings/route.ts tests/unit/ecommerce-settings.test.ts drizzle
git commit -m "feat(ecommerce): add tenant product quantity limit"
```

---

### Task 2: Catalog settings UI

**Files:**
- Modify: `src/components/settings/catalog-client.tsx`
- Modify: `tests/unit/frontend-tenant-ui.test.ts`

**Interfaces:**
- Consumes: `GET/PATCH /api/catalog/settings`
- Produces: controlled number field `max-units-per-product` and save feedback

- [ ] **Step 1: Add failing UI source assertions**

```ts
expect(source).toContain('fetch("/api/catalog/settings")');
expect(source).toContain('id="max-units-per-product"');
expect(source).toContain("Máximo por producto y carrito");
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm vitest run tests/unit/frontend-tenant-ui.test.ts`  
Expected: FAIL because the catalog settings UI is absent.

- [ ] **Step 3: Fetch and save the limit in `CatalogClient`**

Add settings to the existing parallel fetch:

```ts
const [catsRes, prodsRes, settingsRes] = await Promise.all([
  fetch("/api/catalog/categories"),
  fetch("/api/catalog/products"),
  fetch("/api/catalog/settings"),
]);
```

Render a compact card above products with an integer input (`min=1`, `max=1000`, `step=1`) and a save button. Validate with `Number.isInteger(value) && value > 0` before PATCH; show `✅ Límite actualizado.` only after a successful response.

- [ ] **Step 4: Run UI tests and typecheck**

Run: `pnpm vitest run tests/unit/frontend-tenant-ui.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/catalog-client.tsx tests/unit/frontend-tenant-ui.test.ts
git commit -m "feat(catalog): configure tenant cart quantity limit"
```

---

### Task 3: Numbered product menu and product selection

**Files:**
- Modify: `src/server/ai/commands.ts`
- Modify: `tests/unit/slash-commands.test.ts`

**Interfaces:**
- Produces command type: ``catalog:product:${string}``
- Produces state: `{ current_state: "cart:awaiting_quantity", active_step: "awaiting_product_quantity", selectedProductId, catalogCategoryId }`
- Consumes: `listCatalogProducts(organizationId, categoryId)`

- [ ] **Step 1: Write failing menu/parser tests**

```ts
expect(parseSlashCommand("catalog:product:prod_123")).toBe("catalog:product:prod_123");

expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
  text: expect.stringContaining("1. Coca-Cola — 2 litros — $2.500 CLP"),
  replyMarkup: { inline_keyboard: [
    [{ text: "1. Coca-Cola — 2 litros", callback_data: "catalog:product:prod_1" }],
    [{ text: "2. Agua — 1 litro", callback_data: "catalog:product:prod_2" }],
    [{ text: "↩ Retornar", callback_data: "catalog:return" }, { text: "⌂ Inicio", callback_data: "catalog:home" }],
  ]},
}));
expect(JSON.stringify(mockSendText.mock.calls)).not.toContain("SKU-ADMIN");
expect(JSON.stringify(mockSendText.mock.calls)).not.toContain("null");
```

- [ ] **Step 2: Run the menu tests**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts`  
Expected: FAIL because products are plain bullet text and there is no product callback command.

- [ ] **Step 3: Add customer-safe formatting and buttons**

Use helpers local to `commands.ts`:

```ts
function customerProductLabel(product: { name: string; description: string | null }) {
  return [product.name.trim(), product.description?.trim()].filter(Boolean).join(" — ");
}

function customerProductLine(
  product: { name: string; description: string | null; price: number },
  index: number
) {
  return `${index + 1}. ${customerProductLabel(product)} — $${product.price.toLocaleString("es-CL")} CLP`;
}
```

Append navigation as the final keyboard row and use only `product.id` in callback data.

- [ ] **Step 4: Handle selection with a fresh tenant-scoped product lookup**

For ``catalog:product:${productId}``, query by `organizationId`, `product.id`, active and not deleted. On success update the FSB state and send:

```ts
`¿Cuántas unidades de ${customerProductLabel(product)} deseas agregar? Escribe un número.`
```

Do not store name, presentation, price, stock, or SKU in `stateMetadata`; these must be re-read before mutation.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts tests/unit/telegram-menu-send.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/commands.ts tests/unit/slash-commands.test.ts
git commit -m "feat(telegram): add numbered product selection menu"
```

---

### Task 4: Typed quantity state and safe cart mutation

**Files:**
- Create: `src/server/ecommerce/quantity.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `tests/unit/slash-commands.test.ts`
- Modify: `tests/unit/ecommerce-actions.test.ts`
- Modify: `tests/unit/redteam-fsm-ecommerce-chaos.test.ts`

**Interfaces:**
- Produces: `parsePositiveInteger(text): number | null`
- Produces: `addProductToCart({ organizationId, conversationId, productId, quantity }): Promise<CartMutationResult>`
- Result errors: `product_not_found | invalid_quantity | tenant_limit_exceeded | insufficient_stock | cart_create_failed`

- [ ] **Step 1: Write failing pure parser tests**

```ts
expect(parsePositiveInteger("2")).toBe(2);
for (const invalid of ["", "0", "-1", "+2", "2.5", "2e3", "dos", "2 unidades", "9007199254740992"]) {
  expect(parsePositiveInteger(invalid)).toBeNull();
}
```

- [ ] **Step 2: Write failing domain tests for total, tenant limit and stock**

```ts
await expect(addProductToCart({ organizationId: "org_a", conversationId: "conv_a", productId: "prod_a", quantity: 3 }))
  .resolves.toMatchObject({ ok: false, error: "tenant_limit_exceeded", limit: 4 }); // cart already has 2

await expect(addProductToCart({ organizationId: "org_a", conversationId: "conv_a", productId: "prod_a", quantity: 4 }))
  .resolves.toMatchObject({ ok: false, error: "insufficient_stock", available: 3 });
```

- [ ] **Step 3: Run focused tests and verify failures**

Run: `pnpm vitest run tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts tests/unit/slash-commands.test.ts`  
Expected: FAIL because quantity parsing and ID-based cart mutation do not exist.

- [ ] **Step 4: Implement strict parser and ID-based cart service**

```ts
export function parsePositiveInteger(text: string): number | null {
  const clean = text.trim();
  if (!/^[1-9][0-9]*$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isSafeInteger(value) ? value : null;
}
```

In `addProductToCart`, serialize mutations for one conversation with the existing conversation row, then re-read all values inside the transaction:

```ts
return db.transaction(async (tx) => {
  await tx.execute(sql`select ${schema.conversation.id} from ${schema.conversation}
    where ${schema.conversation.organizationId} = ${organizationId}
      and ${schema.conversation.id} = ${conversationId} for update`);
  const products = await tx.select().from(schema.product).where(scoped(
    schema.product.organizationId,
    organizationId,
    and(eq(schema.product.id, productId), eq(schema.product.active, true), isNull(schema.product.deletedAt))
  )).limit(1);
  const carts = await tx.select().from(schema.cart).where(scoped(
    schema.cart.organizationId,
    organizationId,
    and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
  )).limit(1);
  // Create the cart only after holding the conversation lock; then compute and validate newTotal.
});
```

Read `getCommerceSettings` before the transaction, compute `newTotal = existingQuantity + quantity`, then validate `newTotal <= maxUnitsPerProduct` and `newTotal <= product.stock`. Store new items as:

```ts
type CartItem = { productId: string; quantity: number; unitPrice: number; name: string; presentation: string | null };
```

No call to `updateMemoryCartReservation` is allowed.

- [ ] **Step 5: Intercept awaiting quantity before slash/LLM resolution**

At the start of the command path in `pipeline.ts`, inspect `conversation.stateMetadata.current_state`. When it is `cart:awaiting_quantity`, call a focused `processPendingProductQuantity(...)`. Invalid input sends the validation message and keeps selection state. Success sends product/presentation/quantity plus cart count/total, changes state to `menu:cart`, and clears `selectedProductId`.

The success string must follow:

```ts
`✅ Agregamos ${label}, cantidad ${quantity}, a tu carrito.\n\n🛒 Carrito: ${units} productos · Total: $${total.toLocaleString("es-CL")} CLP`
```

- [ ] **Step 6: Test retries and terminal state**

Cover invalid format, tenant limit, stock, product deleted after selection, success state cleanup, and a second quantity message after success not adding again.

Run: `pnpm vitest run tests/unit/slash-commands.test.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/ecommerce/quantity.ts src/server/ecommerce/service.ts src/server/ai/commands.ts src/server/ai/pipeline.ts tests/unit/slash-commands.test.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts
git commit -m "feat(ecommerce): validate typed product quantities"
```

---

### Task 5: Remove cart stock reservation and SKU from customer AI paths

**Files:**
- Modify: `src/server/ecommerce/cache.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/server/ai/actions.ts`
- Modify: `src/server/ai/prompts.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `tests/unit/ecommerce-actions.test.ts`
- Modify: `tests/unit/rag-pipeline.test.ts`

**Interfaces:**
- Cache exposes actual product stock only; no `reservedStock` map.
- Customer product search renders name, presentation, price and stock without SKU.
- Direct AI purchase intent emits `mostrar_catalogo`; it cannot mutate a cart using SKU.

- [ ] **Step 1: Write failing no-reservation/no-SKU tests**

```ts
expect(await listCatalogProducts("org_a", "cat_a")).toEqual([
  expect.objectContaining({ id: "prod_a", stock: 5 }),
]); // another active cart contains 5 and must not reduce stock

expect(customerProductSearchText).not.toContain("SKU-ADMIN");
expect(AgentAction.safeParse({ action: "agregar_al_carrito", sku: "SKU-ADMIN", cantidad: 2 }).success).toBe(false);
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run tests/unit/ecommerce-actions.test.ts tests/unit/rag-pipeline.test.ts`  
Expected: FAIL because active carts currently populate `reservedStock` and the AI accepts SKU cart mutations.

- [ ] **Step 3: Simplify cache to actual stock**

Remove the active cart query, `reservedStock`, `updateMemoryCartReservation`, and reservation-release logic. Keep cache invalidation and update cached product stock only after committed orders.

- [ ] **Step 4: Remove SKU mutation from the AI contract**

Delete the `agregar_al_carrito` action that accepts SKU from `AgentAction`, remove its prompt instruction and pipeline case. Add this server-controlled action:

```ts
z.object({ action: z.literal("mostrar_catalogo") })
```

The prompt instruction is exact: `Si el cliente desea comprar, responde {"action":"mostrar_catalogo"}; nunca solicites ni uses SKU.` The pipeline handles it without trusting model-supplied IDs:

```ts
case "mostrar_catalogo":
  await processSlashCommand({
    command: "menu:categorias",
    conversation,
    lastInboundWaId: lastInbound?.waMessageId,
    profile,
  });
  return;
```

Product search output becomes:

```ts
productos.map((p, index) =>
  `${index + 1}. ${[p.name, p.description].filter(Boolean).join(" — ")} — $${p.price.toLocaleString("es-CL")} CLP`
).join("\n")
```

Cart mutation remains server-controlled after an ID callback and typed quantity.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm vitest run tests/unit/ecommerce-actions.test.ts tests/unit/rag-pipeline.test.ts tests/unit/ai-adapter.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ecommerce/cache.ts src/server/ecommerce/service.ts src/server/ai/actions.ts src/server/ai/prompts.ts src/server/ai/pipeline.ts tests/unit/ecommerce-actions.test.ts tests/unit/rag-pipeline.test.ts
git commit -m "refactor(ecommerce): reserve stock only at order confirmation"
```

---

### Task 6: Atomic order confirmation

**Files:**
- Modify: `src/server/ecommerce/service.ts`
- Modify: `tests/unit/ecommerce-actions.test.ts`
- Create: `tests/integration/ecommerce-order-concurrency.test.ts`

**Interfaces:**
- `confirmarPedido({ organizationId, conversationId })`
- Errors add: `stock_changed` with `{ productId, available, requested }`

- [ ] **Step 1: Write failing PostgreSQL concurrency test**

Create two tenants/contacts/conversations/carts against a product with stock `5`; each cart requests `4`. Execute both confirmations with `Promise.all`. Assert exactly one succeeds, product stock is `1`, one confirmed order exists, and the rejected cart remains active.

```ts
const results = await Promise.all([
  confirmarPedido({ organizationId, conversationId: conversationA }),
  confirmarPedido({ organizationId, conversationId: conversationB }),
]);
expect(results.filter((result) => result.ok)).toHaveLength(1);
expect(await readStock(productId)).toBe(1);
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm vitest run tests/integration/ecommerce-order-concurrency.test.ts`  
Expected: FAIL because current confirmation creates orders without locking, validating, or decrementing PostgreSQL stock.

- [ ] **Step 3: Implement one serial transaction**

Within `db.transaction`:

1. Lock the tenant cart row `FOR UPDATE`.
2. Load each product using `organizationId + productId`, ordered by product ID, with `FOR UPDATE` to avoid deadlocks.
3. Validate active/not deleted and `stock >= requested` for every item.
4. Decrement every product with a scoped conditional update including `stock >= quantity` and verify `RETURNING` for each.
5. Insert the confirmed order.
6. Mark the cart converted.

If any item fails, throw a typed internal error so the entire transaction rolls back, then return `stock_changed` outside the transaction. Generate the order number before the transaction but rely on a database-unique order identifier for idempotency.

- [ ] **Step 4: Add legacy cart compatibility test**

Existing active cart JSON may contain `{ sku }`. Resolve it once, tenant-scoped, to a product ID during confirmation; write only product-ID items in all new carts/orders. Never expose the legacy SKU in responses or logs.

- [ ] **Step 5: Run concurrency and domain tests**

Run: `pnpm vitest run tests/integration/ecommerce-order-concurrency.test.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts && pnpm typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ecommerce/service.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts tests/integration/ecommerce-order-concurrency.test.ts
git commit -m "feat(ecommerce): confirm orders with atomic stock control"
```

---

### Task 7: End-to-end verification and live startup

**Files:**
- Create: `tests/integration/telegram-product-cart-flow.test.ts`
- Modify: `tests/unit/telegram-webhook.test.ts`
- Modify: `tests/unit/telegram-menu-send.test.ts`

**Interfaces:**
- Verifies category → product → typed quantity → cart and all rejection paths.

- [ ] **Step 1: Add real PostgreSQL flow tests**

Seed two tenants and verify:

- Product button callback contains an encoded menu token, not product ID/SKU in the Telegram payload.
- The stored menu action resolves server-side to `catalog:product:<productId>`.
- Typed `2` adds once and clears quantity state.
- Duplicate callback/message IDs create no second cart mutation.
- Tenant A cannot select Tenant B's product/settings.
- Quantity `11` fails with default limit 10; a configured limit 3 rejects 4.
- Quantity above stock is rejected without cart mutation.
- Another tenant's active cart does not reduce displayed availability.

- [ ] **Step 2: Run complete automated verification**

Run: `pnpm db:migrate && pnpm test && pnpm typecheck && pnpm lint && git diff --check`  
Expected: all test files PASS, typecheck PASS, ESLint has zero errors, diff check PASS.

- [ ] **Step 3: Restart infrastructure and application using mandatory scripts**

Run: `./scripts/du.sh`  
Expected: PostgreSQL, tunnel and proxy report healthy.

Run: `./scripts/run.sh`  
Expected: Next.js reports ready at `http://localhost:3000` and frees port 3000 if necessary.

- [ ] **Step 4: Execute live health and Telegram API checks**

Run: `curl --fail --silent http://127.0.0.1:3000/api/health`  
Expected: `{"ok":true}`.

Run: `pnpm test:telegram:connection`  
Expected: `CONEXIÓN TELEGRAM: OK`; no token is printed.

Run the automated PostgreSQL test for category → product → quantity → cart, invalid quantity, tenant limit, stock rejection, Inicio, Retornar, double click and stale click. Then call Telegram `getMe`/`getWebhookInfo` through the existing client test script; never print secrets and never delete old Telegram messages.

- [ ] **Step 5: Final commit if fixtures changed**

```bash
git add tests/integration/telegram-product-cart-flow.test.ts tests
git commit -m "test(telegram): cover product quantity cart flow"
```
