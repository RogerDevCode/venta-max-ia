# Authorized Fourth-Order Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer an explicit, state-isolated authorization flow that merges a rejected fourth cart into the newest of three active orders without duplicating products, stock or effects.

**Architecture:** Checkout returns the newest active order when the contact has reached the limit. A dedicated FSM state renders the authorization proposal, and a tenant-scoped transaction locks contact, cart, candidate order and products before normalizing merged items by `productId`.

**Tech Stack:** TypeScript 5.7, Next.js 15, Drizzle ORM, PostgreSQL 18, Vitest, Telegram Bot API.

## Global Constraints

- Maximum three active orders per contact and tenant.
- Explicit customer authorization is mandatory.
- Product identity is `productId`; SKU is never used.
- Repeated products become one line with summed quantities.
- Tenant quantity limit and effective stock are validated before writes.
- Any failure leaves order, cart and stock unchanged.
- Invalid state input, stale callbacks and double clicks are ignored silently.

---

### Task 1: Fourth-order authorization state

**Files:**
- Modify: `src/server/ai/menu-fsm.ts`
- Modify: `src/server/ai/commands.ts`
- Modify: `tests/unit/menu-fsm.test.ts`
- Modify: `tests/unit/slash-commands.test.ts`

**Interfaces:**
- Consumes: `active_order_limit` with `candidateOrder`.
- Produces: `menu:order_merge/awaiting_merge_confirmation`, actions `order:merge:confirm:<id>` and `order:merge:keep`.

- [ ] Write failing tests asserting the new state accepts only its two persisted actions and rejects every foreign number/action.
- [ ] Run `pnpm vitest run tests/unit/menu-fsm.test.ts tests/unit/slash-commands.test.ts`; expect RED.
- [ ] Add the compound state and action rules to `MENU_TRANSITIONS`.
- [ ] Render candidate order and active cart summaries with numbered confirmation buttons plus Inicio and Retornar.
- [ ] Make `order:merge:keep` preserve all business rows and render the cart again.
- [ ] Run the focused tests; expect PASS.
- [ ] Commit with `git commit -m "feat(fsm): add fourth-order merge authorization"`.

### Task 2: Atomic product-normalizing merge

**Files:**
- Modify: `src/server/ecommerce/service.ts`
- Modify: `tests/integration/ecommerce-order-concurrency.test.ts`
- Modify: `tests/unit/redteam-fsm-ecommerce-chaos.test.ts`

**Interfaces:**
- Produces: `mergeLatestOrderIntoActiveCart({ organizationId, conversationId, candidateOrderId })`.
- Returns: success with normalized cart, or `merge_limit_exceeded`, `merge_stock_changed`, `merge_candidate_changed`, `active_cart_missing`, `invalid_order_items`.

- [ ] Write failing PostgreSQL tests for repeated products, distinct products, tenant limit, effective stock, stale candidate, cross-tenant access and twenty concurrent confirmations.
- [ ] Run `pnpm vitest run tests/integration/ecommerce-order-concurrency.test.ts`; expect RED.
- [ ] Extend `confirmarPedido()` so `active_order_limit` includes the newest active order selected by `createdAt DESC, id DESC`.
- [ ] Implement the transaction: lock conversation/contact/cart/candidate/products, re-resolve newest candidate, group by `productId`, reload product data, validate all rows, conditionally cancel the order, restore its stock and replace cart items.
- [ ] Invalidate catalog cache only after commit.
- [ ] Run focused integration and red-team tests; expect PASS.
- [ ] Commit with `git commit -m "feat(orders): merge fourth cart into latest active order"`.

### Task 3: Command execution and complete verification

**Files:**
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `tests/unit/slash-commands.test.ts`
- Modify: `tests/integration/telegram-menu-concurrency.test.ts`

**Interfaces:**
- Consumes: `mergeLatestOrderIntoActiveCart()` and candidate returned by checkout.
- Produces: deterministic user messages and navigation after accept/reject.

- [ ] Write failing command tests for proposal, acceptance, keep-current-cart, business failures and stale callback rejection.
- [ ] Run focused menu and Telegram tests; expect RED.
- [ ] Route accepted merge actions to the service and render the combined cart on success.
- [ ] On business rejection, preserve the authorization state or re-render current cart/orders as appropriate.
- [ ] Run `pnpm test`, `pnpm typecheck` and `pnpm lint`; expect all tests PASS, typecheck PASS and zero lint errors.
- [ ] Recreate Docker services with `./scripts/du.sh`, apply migrations, start with `./scripts/run.sh`, and verify HTTP 200 on port 3000.
- [ ] Commit with `git commit -m "feat(menus): authorize fourth-order merge"`.

