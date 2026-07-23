# Telegram Single-Use Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram inline menus durable and single-use so stale, duplicated, concurrent, cross-tenant, or state-invalid callbacks are silently acknowledged without effects.

**Architecture:** PostgreSQL owns menu lifecycle and callback acceptance in dedicated tenant-scoped tables. Outgoing keyboards carry only a compact instance token and option index; an atomic conditional update accepts one callback and queues one durable action. Existing Telegram receipt idempotency and in-process execution gain recoverable statuses.

**Tech Stack:** TypeScript, Next.js 15, Drizzle ORM, PostgreSQL 18, Telegram Bot API, Vitest.

## Global Constraints

- Every domain table has `organization_id NOT NULL` and org-first indexes.
- Every Drizzle domain query uses `scoped(organization_id)`.
- No Redis, S3, external worker, or runtime dependency is added.
- `is_test: true` never calls the real Telegram API.
- Background tasks use `.catch(logError)` or `Promise.allSettled()`.
- Old Telegram keyboards remain visible; rejected callbacks receive an empty ACK only.

---

### Task 1: Menu schema and compact callback codec

**Files:** Modify `src/lib/db/schema.ts`, `src/lib/db/ids.ts`; create `src/server/telegram/menu-codec.ts`; create generated `drizzle/0008_*.sql`; test `tests/unit/telegram-menu-codec.test.ts`.

**Interfaces:** Produces `encodeMenuCallback(instanceId, optionIndex)` and `decodeMenuCallback(data)` returning `{ instanceId, optionIndex } | null`; produces `telegramMenuInstance` and `telegramMenuAction` schema exports.

- [ ] Write failing tests for valid payloads, 64-byte ceiling, malformed tokens, negative/oversized indexes, and Unicode payload attacks.
- [ ] Run `pnpm vitest run tests/unit/telegram-menu-codec.test.ts`; expect module-not-found failure.
- [ ] Implement strict ASCII codec `m:<id>:<base36-index>` and tables with unique generation, one-active partial index, callback uniqueness, lifecycle timestamps, and org-first indexes.
- [ ] Run `pnpm db:generate` and inspect migration for both tables and indexes.
- [ ] Run focused tests and `pnpm typecheck`; expect PASS.

### Task 2: Durable menu emission lifecycle

**Files:** Create `src/server/telegram/menu-store.ts`; modify `src/server/inbox/send.ts`; test `tests/unit/telegram-menu-send.test.ts`.

**Interfaces:** Produces `reserveTelegramMenu`, `markTelegramMenuFailed`, and `activateDeliveredTelegramMenu`; consumes a plain inline keyboard and returns an encoded keyboard plus instance metadata.

- [ ] Write failing tests for menu reservation, encoded callbacks, send failure preserving the previous active menu, and inverted Telegram responses selecting the highest delivered generation.
- [ ] Run focused tests; expect failures before the store exists.
- [ ] Reserve generation transactionally, call Telegram outside the transaction, record delivery, and activate the highest delivered generation while superseding the prior active row.
- [ ] Ensure non-menu messages bypass the lifecycle and sandbox calls no store/API.
- [ ] Run focused tests and typecheck; expect PASS.

### Task 3: Atomic callback guard and silent ACK

**Files:** Create `src/server/telegram/menu-guard.ts`; modify `src/server/inbox/telegram-webhook.ts`; test `tests/unit/telegram-menu-guard.test.ts`, `tests/unit/telegram-webhook.test.ts`.

**Interfaces:** Produces `acceptTelegramMenuCallback` returning `{ accepted: true; action; actionId } | { accepted: false }`; consumes organization, chat, user, message, callback query, update, and current FSB state.

- [ ] Write failing tests for stale menu, duplicate callback, 20 concurrent clicks, distinct concurrent options, wrong tenant/chat/message/user, invalid state, and malformed payload.
- [ ] Run focused tests; expect failures.
- [ ] ACK with the tenant integration token, decode strictly, reject non-private/missing-message callbacks, and transactionally perform `active → consumed` plus one action insertion using `UPDATE ... RETURNING` semantics.
- [ ] Continue to existing ingestion only for accepted callbacks using the server-resolved action; rejected callbacks return before message/SSE/LLM work.
- [ ] Run focused tests and PostgreSQL integration tests; expect one accepted action under concurrency.

### Task 4: Receipt recovery and action execution

**Files:** Modify `src/lib/db/schema.ts`, `src/server/telegram/integrations.ts`, `src/app/api/webhooks/telegram/[webhookToken]/route.ts`; create `src/server/telegram/menu-action-runner.ts`; test `tests/unit/telegram-menu-recovery.test.ts`, `tests/unit/telegram-webhook-route.test.ts`.

**Interfaces:** Produces receipt claim/complete/fail operations and `drainTelegramMenuActions()` with per-conversation coalescing.

- [ ] Write failing crash-point tests for receipt registration, post-consume/pre-execute failure, expired processing lease, retry backoff, and permanent failure.
- [ ] Run focused tests; expect failures.
- [ ] Add recoverable receipt states, lease fields, attempts, and safe error fields; claim pending menu actions conditionally and feed accepted actions into existing ingestion/FSB processing.
- [ ] Start bounded recovery on instrumentation startup with logged background failures.
- [ ] Run focused tests and typecheck; expect PASS.

### Task 5: Shadow rollout and complete verification

**Files:** Modify `src/lib/env.ts`; create `scripts/test-telegram-menu-e2e.ts`; modify relevant Telegram unit tests and documentation.

**Interfaces:** Adds `TELEGRAM_MENU_GUARD_MODE=off|shadow|enforce`; E2E script reports pass/fail without printing secrets.

- [ ] Test off, shadow, and enforce behavior; shadow records decisions without rejecting callbacks.
- [ ] Add a real PostgreSQL concurrency suite covering 20 clicks and reversed send completion.
- [ ] Run `pnpm db:migrate`, focused Vitest suites, `pnpm typecheck`, and `pnpm test`; expect PASS.
- [ ] Run the project with `./scripts/run.sh`, execute the webhook/API matrix, then perform real-client clicks for main menu, submenus, Inicio, Retornar, double-click, and stale menu.
- [ ] Enable enforcement only after shadow produces zero false rejects; retain the existing Git checkpoint for rollback.
