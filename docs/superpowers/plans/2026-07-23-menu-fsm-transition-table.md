# Deterministic Telegram Menu FSM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a single typed transition table that resolves every menu input only against the active state and step, adds selectable promotions, recommendations and orders, and makes order editing/cancellation stock-safe and idempotent.

**Architecture:** A pure `menu-fsm.ts` module normalizes state, input and navigation and returns either one exact semantic action or `ignore`. Menu renderers persist the exact ordered numeric actions and scope stack in `conversation.stateMetadata`; command execution remains responsible for database queries and outbound messages. Order confirmation, editing and cancellation use tenant-scoped PostgreSQL transactions and row locks.

**Tech Stack:** TypeScript 5.7, Next.js 15, Drizzle ORM, PostgreSQL 18/pgvector, Vitest, Telegram Bot API.

## Global Constraints

- No new runtime dependency.
- Application remains self-hosted and runs on port `3000` through `./scripts/run.sh`.
- Every domain query is tenant-scoped with `organization_id` first.
- Invalid menu inputs, stale callbacks and double clicks are ignored silently.
- SKU is administrative only and never appears in customer flows.
- Test conversations never call Telegram.
- Active order statuses are `pending`, `confirmed` and `processing`.
- Maximum active orders is three per contact and tenant.

---

### Task 1: Pure typed transition table

**Files:**
- Create: `src/server/ai/menu-fsm.ts`
- Create: `tests/unit/menu-fsm.test.ts`

**Interfaces:**
- Produces: `MenuStateMetadata`, `MenuInput`, `MenuDecision`, `stateKey()`, `resolveMenuInput()`, `enterMenuState()`, `goBack()`.
- Consumes: plain JSON-compatible state metadata only.

- [ ] **Step 1: Write failing matrix tests**

Cover every compound state, `home`, `back`, valid number, invalid number and cross-state action. Assert the main-menu number `3` never resolves while the state is a category, promotion, recommendation, cart, orders or order detail.

```ts
expect(resolveMenuInput({
  current_state: "menu:promos",
  active_step: "viewing_promos",
  numeric_options: ["catalog:product:pepsi"],
}, { type: "number", value: 1 })).toEqual({
  kind: "action",
  action: "catalog:product:pepsi",
});

expect(resolveMenuInput(state, { type: "number", value: 2 }))
  .toEqual({ kind: "ignore" });
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run tests/unit/menu-fsm.test.ts`

Expected: FAIL because `@/server/ai/menu-fsm` does not exist.

- [ ] **Step 3: Implement the transition table**

Use exact compound keys and explicit allowed action prefixes. `number` reads only `numeric_options[value - 1]`; it never synthesizes a global action. `home` is global only for AI-controlled states, while `back` is forbidden on main and resolves only from `menu_stack`.

```ts
export type MenuDecision =
  | { kind: "action"; action: string }
  | { kind: "navigate"; scope: string }
  | { kind: "ignore" };

export const MENU_TRANSITIONS = {
  "menu:main/main_menu": { actionPrefixes: ["menu:"] },
  "menu:catalog/viewing_catalog": { actionPrefixes: ["catalog:category:"] },
  "menu:catalog/viewing_category": { actionPrefixes: ["catalog:product:"] },
  "menu:promos/viewing_promos": { actionPrefixes: ["catalog:product:"] },
  "menu:recommended/viewing_recommended": { actionPrefixes: ["catalog:product:"] },
  "menu:orders/viewing_orders": { actionPrefixes: ["order:detail:"] },
  "menu:order_detail/viewing_order_detail": {
    actionPrefixes: ["order:refresh:", "order:edit:", "order:cancel:"],
  },
} as const;
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/unit/menu-fsm.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/menu-fsm.ts tests/unit/menu-fsm.test.ts
git commit -m "feat(fsm): add deterministic menu transition table"
```

### Task 2: Persist exact menu scopes and numeric actions

**Files:**
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `tests/unit/slash-commands.test.ts`

**Interfaces:**
- Consumes: `resolveMenuInput()` and state helpers from Task 1.
- Produces: menu renderers that persist `menu_scope`, `menu_stack` and `numeric_options` before sending buttons.

- [ ] **Step 1: Write failing command tests**

Add tests for main, categories, products, promotions, recommendations, cart and orders. Assert text and buttons share the same index-to-action mapping, and that a number from another state returns `handled: true` without calls or messages.

```ts
expect(state.numeric_options).toEqual([
  "catalog:product:prod_coca",
  "catalog:product:prod_pepsi",
]);
expect(markup.inline_keyboard[1][0].callback_data)
  .toBe("catalog:product:prod_pepsi");
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts tests/unit/menu-fsm.test.ts`

Expected: FAIL because current menus persist ad-hoc ID arrays and use a global numeric fallback.

- [ ] **Step 3: Replace parser fallback with normalized FSM input**

Keep parsing positive integers but route them through `resolveMenuInput`. Remove the six-option fallback from `commands.ts`. A decision of `ignore` is handled silently and never reaches the LLM.

- [ ] **Step 4: Add reusable navigation buttons and menu rendering**

Every submenu ends with:

```ts
[
  { text: "⌂ Inicio", callback_data: "nav:home" },
  { text: "↩ Retornar", callback_data: "nav:back" },
]
```

Promotions and recommendations render numbered product rows with exact product IDs. Selecting either goes to the existing quantity flow while retaining the prior scope for `R`.

- [ ] **Step 5: Route quantity navigation through the same table**

`pipeline.ts` must normalize `I`, `R` and numbers before quantity parsing. Invalid numbers remain in quantity state with the existing validation message; menu actions not allowed in quantity are ignored.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/unit/menu-fsm.test.ts tests/unit/slash-commands.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/ai/commands.ts src/server/ai/pipeline.ts tests/unit/slash-commands.test.ts
git commit -m "feat(menus): route numbers through active FSM state"
```

### Task 3: Contact-scoped active-order limit and lifecycle

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/ids.ts` only if a new ID kind is required
- Modify: `src/server/ecommerce/service.ts`
- Create: generated `drizzle/0010_*.sql`
- Modify: generated `drizzle/meta/_journal.json`
- Create: generated `drizzle/meta/0010_snapshot.json`
- Modify: `tests/integration/ecommerce-order-concurrency.test.ts`
- Modify: `tests/unit/ecommerce-actions.test.ts`

**Interfaces:**
- Produces: `listActiveOrders()`, `getActiveOrderDetail()`, `editOrderAsCart()`, `cancelActiveOrder()` and `active_order_limit` from `confirmarPedido()`.
- Consumes: `organizationId`, `contactId` derived under lock from the conversation, and exact order ID.

- [ ] **Step 1: Write failing concurrency and lifecycle tests**

Test contact/tenant isolation, three-active maximum, simultaneous third/fourth confirmation, edit idempotency, cancellation idempotency, stock restoration and rejection when a non-empty active cart exists.

```ts
const [first, second] = await Promise.all([
  editOrderAsCart(input),
  editOrderAsCart(input),
]);
expect([first, second].filter((result) => result.ok)).toHaveLength(1);
expect(await stock(productId)).toBe(originalStock);
expect(await activeCarts(conversationId)).toHaveLength(1);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run tests/integration/ecommerce-order-concurrency.test.ts`

Expected: FAIL because contact ownership, active limit and lifecycle functions do not exist.

- [ ] **Step 3: Extend schema and generate migration**

Add `order.contactId NOT NULL` referencing contact, and `cart.reopenedFromOrderId` as an audit reference. Backfill `order.contact_id` from its conversation before applying NOT NULL. Add org-first index `(organization_id, contact_id, status)`.

Run: `pnpm db:generate`

Expected: a new migration and snapshot.

- [ ] **Step 4: Enforce active-order limit transactionally**

Inside `confirmarPedido`, resolve and lock the contact row, count active orders with `organizationId + contactId + inArray(statuses)`, and return `{ ok: false, error: "active_order_limit", limit: 3 }` before any stock mutation.

- [ ] **Step 5: Implement edit and cancel transactions**

Lock contact, order and products in stable ID order. Conditional status update ensures one winner. Restore stock exactly once, create the reopened cart with copied items on edit, and return typed business errors for stale order or an occupied cart.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/integration/ecommerce-order-concurrency.test.ts tests/unit/ecommerce-actions.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/server/ecommerce/service.ts drizzle tests/integration/ecommerce-order-concurrency.test.ts tests/unit/ecommerce-actions.test.ts
git commit -m "feat(orders): enforce active limit and editable lifecycle"
```

### Task 4: Selectable order list and order options menu

**Files:**
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `tests/unit/slash-commands.test.ts`
- Create: `tests/unit/menu-transition-matrix.test.ts`

**Interfaces:**
- Consumes: order service functions from Task 3 and FSM from Task 1.
- Produces: `order:detail:<id>`, `order:refresh:<id>`, `order:edit:<id>`, `order:cancel:<id>` command handling.

- [ ] **Step 1: Write failing menu behavior tests**

Cover zero, one, two and three active orders. One opens detail directly; multiple orders are numbered. Detail contains exactly three numeric actions plus Inicio and Retornar.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run tests/unit/slash-commands.test.ts tests/unit/menu-transition-matrix.test.ts`

Expected: FAIL because order commands and direct-detail routing do not exist.

- [ ] **Step 3: Implement order menu commands**

Render only tenant/contact-owned active orders. Refresh re-queries the order. Edit creates the reopened cart and sends the user to categories. Cancel restores stock and returns to the remaining active order list.

- [ ] **Step 4: Handle order-limit response in checkout**

Add a deterministic user message for `active_order_limit`; it must not rely on LLM-generated copy.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/unit/menu-fsm.test.ts tests/unit/slash-commands.test.ts tests/unit/menu-transition-matrix.test.ts tests/unit/ecommerce-actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/commands.ts src/server/ai/pipeline.ts tests/unit/slash-commands.test.ts tests/unit/menu-transition-matrix.test.ts
git commit -m "feat(orders): add selectable order detail menu"
```

### Task 5: Guard Telegram callbacks by state and step

**Files:**
- Modify: `src/server/telegram/menu-store.ts`
- Modify: `src/server/telegram/menu-guard.ts`
- Modify: `tests/integration/telegram-menu-concurrency.test.ts`
- Modify: `tests/unit/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `stateKey()` from Task 1.
- Produces: exact compound FSB snapshots for every Telegram menu instance.

- [ ] **Step 1: Write failing state-step mismatch test**

Create an active callback for `menu:catalog/viewing_catalog`, advance the conversation to `menu:catalog/viewing_category`, and assert silent rejection even though `current_state` is unchanged.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run tests/integration/telegram-menu-concurrency.test.ts`

Expected: FAIL because the guard currently compares only `current_state`.

- [ ] **Step 3: Persist and compare compound key atomically**

Reserve menus with `stateKey(stateMetadata)`. In the conditional consume query, compare the database JSON fields concatenated into the same key. Existing pre-change menu rows naturally mismatch and are silently rejected.

- [ ] **Step 4: Run and confirm GREEN**

Run: `pnpm vitest run tests/integration/telegram-menu-concurrency.test.ts tests/unit/telegram-webhook.test.ts tests/unit/telegram-menu-recovery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/telegram/menu-store.ts src/server/telegram/menu-guard.ts tests/integration/telegram-menu-concurrency.test.ts tests/unit/telegram-webhook.test.ts
git commit -m "fix(telegram): guard callbacks by exact FSM step"
```

### Task 6: Full migration, regression and live verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: migrated local database, complete PASS and healthy application on port 3000.

- [ ] **Step 1: Recreate services with mandatory scripts**

Run: `./scripts/du.sh`

Expected: PostgreSQL and dependencies healthy with migration applied.

- [ ] **Step 2: Run the complete verification suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all tests PASS and zero type/lint errors.

- [ ] **Step 3: Start the application through the mandatory runner**

Run: `./scripts/run.sh`

Expected: application listens only on port 3000.

- [ ] **Step 4: Verify health and Telegram update combinatorics**

Exercise main, categories, products, promotions, recommendations, quantity,
cart, zero/one/multiple orders, order refresh/edit/cancel, Inicio, Retornar,
wrong-state numbers, stale callbacks and simultaneous callbacks. Use test-mode
updates or mocked Telegram transport so no laboratory session reaches Telegram.

- [ ] **Step 5: Verify worktree and commit final corrections**

Run: `git status --short && git diff --check`

Expected: no uncommitted feature files and no whitespace errors.

