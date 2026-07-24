# Telegram Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Venta Max IA into a Telegram-only application whose inbound updates, menu transitions, outbound messages, carts, repricing, and orders remain correct under crashes, retries, bursts, and multi-tenant concurrency.

**Architecture:** PostgreSQL is the durable queue and source of truth. Telegram updates are stored before acknowledgment, claimed with leases, serialized per conversation, validated against an atomic FSM revision, and answered through a transactional outbox. Commerce invariants are enforced both in TypeScript and PostgreSQL before the WhatsApp runtime and schema are retired.

**Tech Stack:** TypeScript, Next.js 15, React 19, Drizzle ORM, PostgreSQL 18/pgvector, Vitest, Telegram Bot API, Docker Compose.

## Global Constraints

- Runtime channel: Telegram only; accept only private chats.
- Settings must retain exactly `WhatsApp (deshabilitado)` with no interactive WhatsApp controls.
- PostgreSQL only for queues, leases, mutexes, counters, and outbox; no Redis or external storage.
- Every domain table and query remains tenant-scoped with `organization_id NOT NULL` and org-first indexes.
- Numeric input remains supported and stale burst entries are ignored silently by FSM revision.
- Repricing is automatic and every change is disclosed to the customer.
- Test conversations never call Telegram, including typing, callback ACK, or outbox delivery.
- Use `./scripts/du.sh` (which invokes `dd.sh`) and `./scripts/run.sh`; the application stays on port 3000.
- Every task follows fail-first TDD and ends in an independently reviewable commit.

## Estado de ejecución (actualizado 2026-07-23)

La implementación se encuentra en un worktree compartido y todavía no tiene commits de esta ejecución. Las siguientes entregas ya fueron realizadas y verificadas:

- Tasks 1–3: harness de verificación semántica, migraciones base Telegram/FSM y transporte Telegram con timeout, clasificación de errores y sandbox.
- Task 4 y 4A: receipts durables, ingestión autenticada con límite de 256 KiB, clasificación private-only, worker con leases/reintentos, outbox, retención y métricas de health.
- Tasks 5–8: identidad Telegram multi-tenant, FSM revision-safe, callbacks durables y outbox transaccional con activación segura de menús.
- Tasks 9–11: normalización de carritos, unicidad de carrito activo, contador de órdenes por tenant y repricing con divulgación de cambios.
- Task 12: configuración Telegram owner-only, staged y compensable.
- Task 13: retiro del runtime WhatsApp, backup externo/restauración, migración destructiva 0014 con consentimiento exacto y UI estática `WhatsApp (deshabilitado)`.
- Migraciones 0011–0014 aplicadas; `pnpm db:migrate` es idempotente y `pnpm db:verify` pasa.
- Verificaciones ya exitosas: `./scripts/du.sh`, suite Vitest completa (46 archivos, 209 tests), `pnpm typecheck`, `pnpm lint` y `pnpm build` (el build debe repetirse después de los últimos ajustes de clases Tailwind).
- `./scripts/run.sh` fue probado en el puerto 3000 y detenido deliberadamente para pausar la ejecución.

Pendiente antes de declarar Done: repetir lint/build tras los ajustes Tailwind, ejecutar health HTTP con la aplicación levantada, completar el chaos matrix de Task 14, generar el informe QA, realizar los tres red-team reviews y ejecutar el canary Telegram real autorizado. No marcar esos puntos como completados sin evidencia.

## Authoritative Red-Team Amendments

These amendments supersede any conflicting detail in the task steps below. They are release-blocking contracts, not optional follow-ups.

### Guarantees and transaction boundary

- Telegram Bot API `sendMessage` has no external idempotency key. Domain/FSM effects are exactly-once, but external delivery is explicitly **at-least-once**. A timeout or crash after Telegram may have accepted a POST is recorded as `delivery_unknown`; it is never treated as definitely unsent. Reconciliation uses a known message anchor and `editMessageText` where possible. A retry may duplicate a notice, but can never repeat stock, order, cart, or FSM effects. Chaos tests cover `accepted -> response lost -> restart`.
- `processMenuInput`, commands, cart/order services, stock mutation, receipt/action completion, and outbox insertion accept one caller-owned Drizzle Unit of Work. Pure transition calculation is separate from effects. No nested transactions. Outbox insertion failure rolls back the entire domain transition; Telegram failure preserves the committed domain transition and retries only delivery.
- Required outbox kinds (`confirmation`, `repricing`, `cancellation`) are immutable and non-supersedable. Menus/typing may be superseded by a newer revision. A per-conversation sequence and dependency make every required notice deliver before its resulting menu, including reversed worker completion.
- A consumed origin menu is never restored after delivery or terminal action failure. The new outbox row remains retryable; terminal failure creates a durable recovery menu/instruction at the new revision. Tests must assert the old menu stays invalid.

### Durable ingress, identity, workers, and retention

- Receipt states are `received|processing|processed|ignored|retryable_failed|failed|conflict`. Identity is unique `(organization_id,integration_id,update_id)` with payload hash: same hash returns the original receipt; different hash becomes `conflict` with zero side effects.
- Authenticated malformed/oversize requests without an update id are stored in `telegram_webhook_rejection`, unique `(organization_id,integration_id,payload_hash)`. The request stream is cut at 256 KiB before parsing and never creates contacts/conversations.
- Private-only classification (`chat.type=private` and `chat.id=from.id`) happens during Task 4 before contact, conversation, message, typing, callback ACK, or action creation. Non-private callbacks receive no ACK.
- Receipt and callback action are linked by an org-consistent FK and unique `(organization_id,receipt_id)`. Their creation/lookup and terminal result are idempotent in one transaction. Crash tests cover before action insert, after insert, and before receipt completion.
- The receipt/message id is the durable free-form processing cursor. Processing is serial per conversation in `(available_at,id)` order and never reconstructs a lossy “last history item.” Crash tests cover before LLM, after decision/before commit, and after commit.
- Add `src/server/telegram/worker.ts`; start it from `src/instrumentation-node.ts`/`src/instrumentation.ts`. It periodically drains receipts, actions, outbox, ambiguous deliveries, and retention, with process guard, PostgreSQL advisory locks, SQL `clock_timestamp()` leases, pagination (remove all fixed `limit(50)` ceilings), `.catch(logError)`, `Promise.allSettled`, and graceful shutdown. Test restart recovery with no new traffic.
- Health exposes queue lag, lease age, conflicts, stale ignores by state/menu, shadow mismatches, ambiguous deliveries, and purge/worker errors. Purge terminal receipts/actions/menus/outbox after 30 days in bounded batches; never purge pending, active, processing, retryable, or `delivery_unknown` rows.

### Schema verification and migration rollout

- `verify-schema.mjs` verifies semantics through `pg_index`, `pg_constraint`, `pg_attribute`, `pg_get_indexdef`, and `pg_get_expr`: `indisvalid`, uniqueness, exact org-first column order, predicates, NOT NULL, FKs, and CHECKs. Object names alone do not pass. The old global `wa_message_id` unique must be absent.
- Migrations 0011–0013 are additive/cutover and run without `CONFIRM_DROP_WHATSAPP_DATA`. Destructive consent applies only to exact 0014 SQL id/hash: `CONFIRM_DROP_WHATSAPP_DATA=0014:<sha256>`; generic `YES` is rejected.
- Before unique bot id, preflight reports/aborts duplicate tenants; it never chooses a winner. Message/contact identity preflight detects mixed Telegram+WhatsApp contacts. It transactionally splits and reassigns conversations, messages, leads, carts, and orders only when ownership is provable, verifies before/after counts and tenant FKs, otherwise aborts with exact ids.
- Runtime rollout is `TELEGRAM_DURABLE_MODE=off|shadow|enforce`: expand, backfill, shadow comparison without duplicate effects, rotate headers, freeze/drain queues, enforce, then contract. Metrics and false-rejection thresholds gate promotion; rollback enforce -> shadow is tested before 0014.
- Integration statuses include `pending|header_pending|connected|reconnect_required|failed`. Existing rows missing headers become `header_pending` and remain accepted by URL token until verified. Enforcement begins only when 100% eligible integrations have verified hashes.
- Hashes remain the lookup/auth values, but active/previous webhook route and header secret versions are also AES-256-GCM encrypted for compensation. The staged workflow tests failure at pending DB write, `setWebhook`, `setMyCommands`, verification, and final DB promotion. Compensation restores decrypted previous versions; failed compensation remains explicit, never falsely `connected`.

### Commerce corrections

- Split `aggregateAndValidateShape` (product ids and safe positive integers) from `validateAdmission` (tenant limit, ownership, active product, stock). Cancellation restores committed stock even if the current limit is lower. Edit/reopen validates first and never cancels/mutates the old order on admission failure.
- Preserve price/source buckets. Adding at 100, catalog changing to 200, adding again, then checkout at 777 must disclose each old-price quantity separately. Adding never overwrites the old line snapshot. `PriceChange` includes product id/name/presentation/source/old price/new price/quantity/difference.
- Reconciliation runs with application stopped and a PostgreSQL advisory lock. It rejects missing, cross-tenant, inactive/deleted products, invalid quantity/price, overstock, and `reopenedFromOrder` conflicts; every abandoned cart is audited. Tests cover same/distinct merge, second-product rollback, cross-conversation checkout, concurrent consumer, stock change after proposal, cancel/edit/merge races, inactive/deleted products, and 20 merge confirmations.
- Tenant order counter is `bigint CHECK(next_value>0)` keyed by organization. Migration backfills `max(valid numeric ORD suffix)+1`, reports nonconforming legacy numbers, and tests populated 0010, independent tenants, idempotence, and rollback/reapply.
- Third/fourth merge proposal displays products, quantities, price buckets, and totals. Final required disclosure contains repricing and definitive total. The stock/order/cart/outbox transaction is atomic.

### WhatsApp retirement and final canary

- Before deleting WhatsApp security tests, port equivalent tenant, sandbox, authorization, idempotency, error, and monotonic-status coverage to Telegram/generic tests and require no coverage decrease.
- Before 0014, stop the application and freeze/drain queues; create an external local `pg_dump`, checksum it, record counts, and perform a restore drill to a temporary database. `retired_whatsapp` in the same DB is an archive, not a backup. 0014 runs under advisory lock with exact hash consent and tests failed-copy rollback plus forward restoration.
- Task 14 uses only `./scripts/du.sh` because it already invokes `dd.sh`. Destructive consent is never injected into normal startup.
- The real gate uses an isolated authorized canary bot/private chat and performs actual button clicks and typed numeric input; `getMe/getWebhookInfo` alone is insufficient. Drain is a bounded timeout/trend, not flaky instantaneous `pending_update_count===0`.
- Update `specs/002-migracion-chatbot-rag-telegram/plan.md`: remove WhatsApp runtime for this edition and replace `agregar_al_carrito(sku,cantidad)` with immutable `productId`/display-snapshot selection. SKU stays administrative only.

## File Map

- `src/lib/db/schema.ts`: durable receipts, FSM revision, external message identity, outbox, cart uniqueness, order counter.
- `drizzle/0011_*.sql`: additive Telegram reliability schema and backfills.
- `drizzle/0012_*.sql`: Telegram message identity cutover.
- `drizzle/0013_*.sql`: cart reconciliation and commerce constraints.
- `drizzle/0014_*.sql`: WhatsApp archival and schema retirement.
- `scripts/migrate.mjs`: destructive-migration consent and post-migration verification.
- `src/server/telegram/receipt-queue.ts`: receipt registration, claim, retry, terminal status.
- `src/server/telegram/update-processor.ts`: private-chat routing and durable processing.
- `src/server/telegram/worker.ts`: lifecycle, periodic drains, retention, and graceful shutdown.
- `src/server/telegram/outbox.ts`: transactional enqueue, claim, send, retry, menu activation.
- `src/server/telegram/transport.ts`: tenant-token client with timeout and retry classification.
- `src/server/ai/menu-fsm.ts`: exact revision-aware transition contract.
- `src/server/ai/menu-input.ts`: deterministic textual menu and quantity dispatch.
- `src/server/ecommerce/cart-normalizer.ts`: aggregate/validate cart lines by `productId`.
- `src/server/ecommerce/order-number.ts`: tenant counter allocation.
- `src/server/ecommerce/pricing.ts`: repricing calculation and notification data.
- `src/server/ecommerce/service.ts`: orchestrate normalized checkout and merge transactions.
- `src/app/api/webhooks/telegram/[webhookToken]/route.ts`: authenticate and persist only.
- `src/app/api/settings/telegram/route.ts`: owner-only compensated bot configuration.
- `src/app/(app)/settings/whatsapp/page.tsx`: disabled static notice.
- `src/components/settings/settings-nav.tsx`: disabled WhatsApp label.

---

### Task 1: Establish the migration verification harness

**Files:**
- Create: `scripts/verify-schema.mjs`
- Modify: `scripts/migrate.mjs`
- Modify: `package.json`
- Create: `tests/unit/schema-verifier.test.ts`

**Interfaces:**
- Produces: `verifySchema(sql): Promise<void>` and the commands `pnpm db:migrate` / `pnpm db:verify`.
- Consumes: `DATABASE_URL`; exact migration/hash destructive consent is consumed only by 0014.

- [ ] **Step 1: Write the failing verifier unit contract**

```ts
it("reports every missing contract for the selected phase", async () => {
  const sql = fakeCatalog(["telegram_integration_bot_id_uq"]);
  await expect(verifySchema(sql, "telegram-durable")).rejects.toThrow(
    "telegram_receipt_integration_update_uq"
  );
});
```

- [ ] **Step 2: Run the contract before migrations**

Run: `pnpm vitest run tests/unit/schema-verifier.test.ts --bail=1`  
Expected: FAIL because `verifySchema` does not exist.

- [ ] **Step 3: Implement a reusable semantic catalog verifier**

Query `pg_index`, `pg_attribute`, `pg_constraint`, `pg_get_indexdef`, and `pg_get_expr`. For each phase verify exact column order, org-first scope, uniqueness, `indisvalid`, partial predicates, NOT NULL, FKs, and CHECK definitions. Verify absence of retired global uniques/tables at cutover. Unit fixtures with the right object name but wrong predicate/order/constraint must fail.

`scripts/migrate.mjs` must export `runMigrations()`, call `verifySchema` after Drizzle migrations, and reject 0014 unless `CONFIRM_DROP_WHATSAPP_DATA=0014:<sha256-of-0014-sql>`. A generic `YES` is invalid and consent must never be passed to 0011–0013. Change `db:migrate` to `node scripts/migrate.mjs` and add `db:verify` for `scripts/verify-schema.mjs`.

- [ ] **Step 4: Run baseline checks**

Run: `pnpm vitest run tests/unit/schema-verifier.test.ts --bail=1 && pnpm typecheck && pnpm lint`  
Expected: verifier test PASS, typecheck PASS, lint has zero errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-schema.mjs scripts/migrate.mjs package.json tests/unit/schema-verifier.test.ts
git commit -m "test(db): add reliability schema verifier"
```

### Task 2: Add durable Telegram and FSM schema

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: generated `drizzle/0011_*.sql`
- Modify: generated `drizzle/meta/_journal.json`
- Create: generated `drizzle/meta/0011_snapshot.json`
- Create: `tests/integration/schema-reliability-contract.test.ts`
- Test: `tests/unit/telegram-integrations.test.ts`

**Interfaces:**
- Produces: `conversation.fsmRevision`, durable receipt fields, outbox schema, `telegramIntegration.webhookHeaderSecretHash`.
- Consumes: current `telegramIntegration`, `telegramWebhookReceipt`, `telegramMenuInstance`, and `message` rows.

- [ ] **Step 1: Extend failing schema assertions**

```ts
expect(await columns("telegram_webhook_receipt")).toEqual(expect.arrayContaining([
  "payload", "attempts", "available_at", "lease_expires_at", "last_error",
  "ignored_reason", "expected_fsm_revision", "expected_fsm_state_key",
]));
expect(await columns("conversation")).toContain("fsm_revision");
expect(await columns("telegram_outbox")).toEqual(expect.arrayContaining([
  "organization_id", "integration_id", "conversation_id", "status", "idempotency_key",
]));
```

- [ ] **Step 2: Verify the assertions fail**

Run: `pnpm vitest run tests/integration/schema-reliability-contract.test.ts --bail=1`  
Expected: FAIL listing missing columns and table.

- [ ] **Step 3: Define the Drizzle contracts**

Use these exact state unions:

```ts
type ReceiptStatus = "received" | "processing" | "processed" | "ignored" | "retryable_failed" | "failed" | "conflict";
type OutboxStatus = "pending" | "sending" | "delivered" | "retryable_failed" | "delivery_unknown" | "failed" | "superseded";
```

Add `fsmRevision bigint({ mode: "number" }).notNull().default(0)`, hashed plus AES-256-GCM encrypted/versioned webhook secrets, the receipt lease/payload/cursor fields, the malformed-request rejection table, receipt-linked action uniqueness, `telegramMenuInstance.fsmRevision`, and ordered/kinded `telegramOutbox`. Index receipts on `(organizationId, status, availableAt)`, outbox on `(organizationId, status, availableAt)`, add unique `(organizationId,idempotencyKey)`, and create the non-null bot-id unique only after a duplicate preflight aborts cleanly.

- [ ] **Step 4: Generate and inspect migration 0011**

Run: `pnpm db:generate`  
Expected: one new migration and snapshot. Inspect it with `git diff -- drizzle src/lib/db/schema.ts` and ensure every new domain table has `organization_id NOT NULL` and org-first indexes.

- [ ] **Step 5: Apply and verify against the current database**

Run: `pnpm db:migrate && SCHEMA_VERIFY_PHASE=telegram-durable pnpm db:verify`  
Expected: migration applies once, schema verifier PASS, second `pnpm db:migrate` changes nothing.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm vitest run tests/integration/schema-reliability-contract.test.ts tests/unit/telegram-integrations.test.ts --bail=1`  
Expected: PASS.

```bash
git add src/lib/db/schema.ts drizzle tests/integration/schema-reliability-contract.test.ts tests/unit/telegram-integrations.test.ts
git commit -m "feat(db): add durable Telegram processing schema"
```

### Task 3: Build timeout-safe tenant Telegram transport

**Files:**
- Create: `src/server/telegram/transport.ts`
- Modify: `src/lib/telegram/client.ts`
- Modify: `src/server/inbox/telegram-webhook.ts`
- Test: `tests/unit/telegram-transport.test.ts`
- Test: `tests/unit/telegram-client.test.ts`

**Interfaces:**
- Produces: `telegramCall<T>(integration, method, body, options)` and `classifyTelegramError(error)`.
- Consumes: decrypted tenant integration credentials.

- [ ] **Step 1: Write timeout, token, and sandbox failures**

```ts
it("aborts a tenant request at the configured timeout", async () => {
  vi.useFakeTimers();
  mockFetchNeverSettles();
  const pending = telegramCall(integration, "sendChatAction", { chat_id: "1", action: "typing" }, { timeoutMs: 5000 });
  await vi.advanceTimersByTimeAsync(5001);
  await expect(pending).rejects.toMatchObject({ code: "timeout", retryable: true });
});

it("never falls back to the admin bot", async () => {
  await telegramCall(integration, "sendChatAction", { chat_id: "1", action: "typing" });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining(integration.token), expect.anything());
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/unit/telegram-transport.test.ts --bail=1`  
Expected: FAIL because `telegramCall` does not exist.

- [ ] **Step 3: Implement the transport boundary**

Use `AbortSignal.timeout(timeoutMs)`, classify 429/5xx/network/timeout as retryable, 401 as terminal reconnect, and remove the global `dns.lookup` monkeypatch. All Telegram runtime calls must pass the tenant token explicitly. Test contexts return before creating a transport request.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm vitest run tests/unit/telegram-transport.test.ts tests/unit/telegram-client.test.ts tests/unit/send-sandbox.test.ts --bail=1`  
Expected: PASS.

```bash
git add src/server/telegram/transport.ts src/lib/telegram/client.ts src/server/inbox/telegram-webhook.ts tests/unit/telegram-transport.test.ts tests/unit/telegram-client.test.ts
git commit -m "feat(telegram): add timeout-safe tenant transport"
```

### Task 4: Persist and recover every Telegram update

**Files:**
- Create: `src/server/telegram/receipt-queue.ts`
- Create: `src/server/telegram/update-processor.ts`
- Modify: `src/server/telegram/integrations.ts`
- Modify: `src/app/api/webhooks/telegram/[webhookToken]/route.ts`
- Test: `tests/integration/telegram-receipt-recovery.test.ts`
- Test: `tests/unit/telegram-webhook-route.test.ts`

**Interfaces:**
- Produces: `registerTelegramReceipt`, `claimTelegramReceipt`, `completeTelegramReceipt`, `retryTelegramReceipt`, `drainTelegramReceipts`.
- Consumes: Task 2 receipt schema and Task 3 transport errors.

- [ ] **Step 1: Write crash-recovery and bot-replacement tests**

```ts
it("reclaims a receipt after its processing lease expires", async () => {
  const receipt = await seedReceipt({ status: "processing", leaseExpiresAt: past });
  const claimed = await claimTelegramReceipt(receipt.organizationId, receipt.id, now);
  expect(claimed).toMatchObject({ id: receipt.id, status: "processing", attempts: 2 });
});

it("accepts the same update_id for two different integrations", async () => {
  await expect(registerTelegramReceipt(updateFor(integrationA, 7))).resolves.toMatchObject({ inserted: true });
  await expect(registerTelegramReceipt(updateFor(integrationB, 7))).resolves.toMatchObject({ inserted: true });
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-receipt-recovery.test.ts --bail=1`  
Expected: FAIL because receipts cannot be reclaimed and uniqueness is organization-wide.

- [ ] **Step 3: Implement durable receipt operations**

Claims must use one conditional `UPDATE ... RETURNING`, increment attempts, set a 30-second lease using SQL time, and select only `received`, due `retryable_failed`, or expired `processing`. Completion writes `processedAt`; ignore writes a reason; retry uses exponential backoff with jitter; attempt 5 becomes `failed`.

The route must validate URL token and, when configured, `X-Telegram-Bot-Api-Secret-Token`; reject bodies by streamed byte count before JSON parsing; and return 200 only after persistence. Enforce private-chat identity before any contact or ACK. For private messages, receipt registration gets/creates the Telegram contact and conversation and snapshots revision/state in the same transaction. For callbacks it resolves conversation and revision from the menu instance. Two updates arriving before the first transition therefore capture the same revision deliberately. During rollout, `header_pending` rows accept the URL token; verified `connected` rows require both secrets. The lifecycle worker, not webhook traffic, guarantees draining.

- [ ] **Step 4: Add pagination and deterministic ordering**

`drainTelegramReceipts` pages by `(availableAt, id)`, never by a fixed organization limit, and processes independent organizations with `Promise.allSettled`. SQL mutations for one receipt remain serial.

- [ ] **Step 5: Run route, recovery, and adversarial tests**

Run: `pnpm vitest run tests/integration/telegram-receipt-recovery.test.ts tests/unit/telegram-webhook-route.test.ts tests/unit/redteam-security-adversarial.test.ts --bail=1`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/telegram/receipt-queue.ts src/server/telegram/update-processor.ts src/server/telegram/integrations.ts src/app/api/webhooks/telegram/[webhookToken]/route.ts tests/integration/telegram-receipt-recovery.test.ts tests/unit/telegram-webhook-route.test.ts
git commit -m "feat(telegram): make webhook processing durable"
```

### Task 4A: Operate receipts, actions, outbox, and retention without webhook traffic

**Files:**
- Create: `src/server/telegram/worker.ts`
- Modify: `src/instrumentation.ts`
- Modify: `src/instrumentation-node.ts`
- Modify: `src/server/telegram/menu-action-runner.ts`
- Modify: `src/app/api/health/route.ts`
- Create: `tests/integration/telegram-worker-lifecycle.test.ts`
- Create: `tests/unit/telegram-retention.test.ts`

- [ ] **Step 1: Write lifecycle failures**

Test startup drains pre-existing receipts/actions/outbox with no inbound request, restart reclaims expired leases, one process guard prevents duplicate timers, database advisory locks prevent replica overlap, and graceful shutdown awaits in-flight drains.

- [ ] **Step 2: Implement the lifecycle worker**

Start only in Node instrumentation. Use SQL `clock_timestamp()` for leases, global pagination ordered by `(available_at,id)`, per-conversation advisory locks, `.catch(logError)` for scheduled calls, and `Promise.allSettled` for independent conversations/organizations. Remove every fixed `limit(50)` ceiling from the existing action runner.

- [ ] **Step 3: Add retention and health**

Purge only terminal receipts, rejections, actions, menus, and delivered/failed/superseded outbox rows older than 30 days, in bounded batches under an advisory lock. Never purge pending/active/processing/retryable/`delivery_unknown`. Health reports queue lag, oldest lease, conflict/stale/shadow/ambiguous counts, purge status, and last worker error.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run tests/integration/telegram-worker-lifecycle.test.ts tests/unit/telegram-retention.test.ts --bail=1`  
Expected: PASS, including restart with no new traffic.

```bash
git add src/server/telegram/worker.ts src/instrumentation.ts src/instrumentation-node.ts src/server/telegram/menu-action-runner.ts src/app/api/health/route.ts tests/integration/telegram-worker-lifecycle.test.ts tests/unit/telegram-retention.test.ts
git commit -m "feat(telegram): operate durable queue workers"
```

### Task 5: Cut over message identity and private-chat policy

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: generated `drizzle/0012_*.sql`
- Modify: `src/server/inbox/ingest.ts`
- Modify: `src/server/inbox/telegram-webhook.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/inbox/queries.ts`
- Modify: `src/server/contacts.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/contact-panel.tsx`
- Modify: `src/components/pipeline/pipeline-client.tsx`
- Modify: `src/app/api/contacts/route.ts`
- Modify: `src/app/api/pipeline/board/route.ts`
- Modify: `src/server/lab/personas.ts`
- Modify: `src/server/lab/runner.ts`
- Modify: `src/server/seed/demo.ts`
- Create: `scripts/preflight-message-identity.mjs`
- Test: `tests/integration/telegram-message-identity.test.ts`
- Test: `tests/unit/telegram-webhook.test.ts`

**Interfaces:**
- Produces: `ingestTelegramMessage({ integrationId, externalMessageId, ... })`.
- Consumes: receipt integration identity and private Telegram updates.

- [ ] **Step 1: Write multi-tenant collision and non-private tests**

```ts
it("stores identical Telegram message coordinates for different integrations", async () => {
  await ingestTelegramMessage(messageFor(integrationA, "message:123:77"));
  await ingestTelegramMessage(messageFor(integrationB, "message:123:77"));
  expect(await countMessages("message:123:77")).toBe(2);
});

it.each(["group", "supergroup", "channel"])("ignores %s before contact creation", async (chatType) => {
  await processTelegramReceipt(receiptWithChatType(chatType));
  expect(await contactCount()).toBe(0);
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-message-identity.test.ts --bail=1`  
Expected: FAIL on the global `wa_message_id` constraint.

- [ ] **Step 3: Add the identity migration**

Add `channel`, `integration_id`, and `external_message_id`; backfill Telegram-prefixed rows; create org-first partial unique `(organization_id, integration_id, external_message_id) WHERE integration_id IS NOT NULL AND external_message_id IS NOT NULL`; remove the global unique; rename application properties from `waMessageId`/`lastInboundWaId` to `externalMessageId`/`lastInboundExternalId`.

Replace `contact.phone` with `contact.channel` (`telegram | test | retired_whatsapp`) and `contact.external_address`. Backfill Telegram contacts from Telegram message identity, laboratory contacts as `test`, and remaining historical contacts as `retired_whatsapp`. New runtime contacts accept only `telegram`; manually created phone contacts are removed from this edition. Enforce unique `(organization_id, channel, external_address)` and update inbox, pipeline, lab, seed, DTOs, and search labels to display Telegram ID or archived address rather than formatting every address as a phone.

Before migration, `preflight-message-identity.mjs` detects contacts/conversations with mixed channel history. It transactionally splits identities and reassigns conversations, messages, leads, carts, and orders only where provenance is deterministic; it checks tenant-consistent FKs and before/after counts. Any ambiguous row aborts with exact ids and no partial migration.

- [ ] **Step 4: Enforce private chat before side effects**

`update-processor.ts` checks `chat.type === "private"` and `chat.id === from.id` before contact creation, typing, message insert, or callback ACK. Unsupported chats end as `ignored/non_private`.

- [ ] **Step 5: Apply migration and run focused tests**

Run: `pnpm db:migrate && SCHEMA_VERIFY_PHASE=message-identity pnpm db:verify`  
Run: `pnpm vitest run tests/integration/telegram-message-identity.test.ts tests/unit/telegram-webhook.test.ts tests/unit/tenant.test.ts tests/unit/frontend-tenant-ui.test.ts --bail=1`  
Expected: PASS; duplicate query over `(integration_id, external_message_id)` returns zero rows.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle src/server/inbox src/server/contacts.ts src/server/ai src/server/lab src/server/seed src/lib/types.ts src/components/inbox src/components/pipeline src/app/api/contacts src/app/api/pipeline tests/integration/telegram-message-identity.test.ts tests/unit/telegram-webhook.test.ts tests/unit/frontend-tenant-ui.test.ts
git commit -m "feat(telegram): scope message identity by integration"
```

### Task 6: Make textual menus revision-safe

**Files:**
- Create: `src/server/ai/menu-input.ts`
- Modify: `src/server/ai/menu-fsm.ts`
- Modify: `src/server/telegram/update-processor.ts`
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Test: `tests/integration/telegram-text-burst.test.ts`
- Test: `tests/unit/menu-fsm.test.ts`

**Interfaces:**
- Produces: `processMenuInput({ conversationId, expectedRevision, expectedStateKey, input })`.
- Consumes: exact FSM transition table and receipt revision snapshot.

- [ ] **Step 1: Write burst, delayed-number, and wrong-step failures**

```ts
it("consumes only one transition from a numeric burst", async () => {
  const [first, second] = await Promise.all([
    processMenuInput(inputAtRevision(9, "1")),
    processMenuInput(inputAtRevision(9, "1")),
  ]);
  expect([first, second].filter((r) => r.status === "applied")).toHaveLength(1);
  expect([first, second].filter((r) => r.reason === "stale_revision")).toHaveLength(1);
});

it("rejects quantity when active_step is wrong", async () => {
  await setState("cart:awaiting_quantity", "wrong_step", 12);
  await expect(processMenuInput(inputAtRevision(12, "2"))).resolves.toMatchObject({ status: "ignored" });
  expect(await activeCart()).toBeNull();
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-text-burst.test.ts --bail=1`  
Expected: FAIL because both turns read the latest inbound without revision CAS.

- [ ] **Step 3: Implement atomic compare-and-swap**

Lock the conversation, require exact `stateKey` and `fsmRevision`, resolve through `resolveMenuInput`, and update with:

```ts
await tx.update(schema.conversation).set({
  stateMetadata: nextState,
  fsmRevision: sql`${schema.conversation.fsmRevision} + 1`,
}).where(scoped(schema.conversation.organizationId, organizationId, and(
  eq(schema.conversation.id, conversationId),
  eq(schema.conversation.fsmRevision, expectedRevision),
))).returning({ revision: schema.conversation.fsmRevision });
```

Move deterministic menu text and quantity handling out of last-history polling. The receipt/message id is the durable processing cursor for free-form input as well; process exact messages serially and remove any lossy last-history coalescing authority.

- [ ] **Step 4: Add exact revision to every menu state change**

All `show*`, navigation, cart, order detail, merge, handoff, `/start`, and `/reset` paths return the new revision. `humanAvailable=false` returns to main menu instead of persisting an unusable handoff state.

- [ ] **Step 5: Run FSM and burst tests**

Run: `pnpm vitest run tests/integration/telegram-text-burst.test.ts tests/unit/menu-fsm.test.ts tests/unit/slash-commands.test.ts --bail=1`  
Expected: PASS for `1,1`, `3,3`, `I,R`, delayed old numbers, wrong-step quantity, and mixed text/callback bursts.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/menu-input.ts src/server/ai/menu-fsm.ts src/server/telegram/update-processor.ts src/server/ai/commands.ts src/server/ai/pipeline.ts tests/integration/telegram-text-burst.test.ts tests/unit/menu-fsm.test.ts tests/unit/slash-commands.test.ts
git commit -m "feat(fsm): reject stale textual menu bursts"
```

### Task 7: Make callbacks durable through the real effect

**Files:**
- Modify: `src/server/telegram/menu-guard.ts`
- Modify: `src/server/telegram/menu-action-runner.ts`
- Modify: `src/server/telegram/update-processor.ts`
- Test: `tests/integration/telegram-menu-action-recovery.test.ts`
- Test: `tests/integration/telegram-menu-concurrency.test.ts`

**Interfaces:**
- Produces: callback action status that becomes `processed` only after `processMenuInput` returns `applied` or a terminal ignore result.
- Consumes: Task 6 revision-aware processor.

- [ ] **Step 1: Write failure-after-ingest recovery test**

```ts
it("retries a callback when the effect fails after claim", async () => {
  failMenuEffectOnce();
  await expect(runTelegramMenuAction(actionId)).rejects.toThrow();
  expect(await actionStatus(actionId)).toBe("pending");
  await expect(runTelegramMenuAction(actionId)).resolves.toBe(true);
  expect(await actionStatus(actionId)).toBe("processed");
  expect(await appliedTransitionCount()).toBe(1);
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-menu-action-recovery.test.ts --bail=1`  
Expected: FAIL because current ingestion schedules and returns before the effect.

- [ ] **Step 3: Execute the deterministic effect inside the durable worker**

Persist/locate the receipt-linked callback action idempotently. The worker invokes `processMenuInput` with the menu revision inside the caller-owned Unit of Work; revision CAS, menu consumption, effect, required outbox, action result, and receipt completion commit together. `answerCallbackQuery` is emitted only for the winning private non-sandbox action. Retry retryable failures; terminal stale actions commit `ignored_reason=stale_revision` with no ACK/outbox. Crash tests cover each receipt/action boundary.

- [ ] **Step 4: Run recovery and 20-click concurrency tests**

Run: `pnpm vitest run tests/integration/telegram-menu-action-recovery.test.ts tests/integration/telegram-menu-concurrency.test.ts --bail=1`  
Expected: PASS; exactly one transition and one durable action result.

- [ ] **Step 5: Commit**

```bash
git add src/server/telegram/menu-guard.ts src/server/telegram/menu-action-runner.ts src/server/telegram/update-processor.ts tests/integration/telegram-menu-action-recovery.test.ts tests/integration/telegram-menu-concurrency.test.ts
git commit -m "feat(telegram): complete callbacks after durable effects"
```

### Task 8: Add transactional Telegram outbox and safe menu activation

**Files:**
- Create: `src/server/telegram/outbox.ts`
- Modify: `src/server/inbox/send.ts`
- Modify: `src/server/telegram/menu-store.ts`
- Modify: `src/server/ai/commands.ts`
- Test: `tests/integration/telegram-outbox-recovery.test.ts`
- Test: `tests/unit/telegram-menu-send.test.ts`

**Interfaces:**
- Produces: `enqueueTelegramOutbox(tx, input)`, `drainTelegramOutbox()`, `deliverOutboxEntry(entry)`.
- Consumes: Task 3 transport, Task 2 outbox schema, menu generation/revision.

- [ ] **Step 1: Write send-failure and reversed-delivery tests**

```ts
it("never reactivates the consumed origin menu when replacement delivery fails", async () => {
  const oldMenu = await activeMenu();
  failTelegramSendOnce();
  await drainTelegramOutbox();
  expect(await menuStatus(oldMenu.id)).toBe("consumed");
  await drainTelegramOutbox();
  expect(await menuStatus(oldMenu.id)).not.toBe("active");
  expect(await activeMenus()).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-outbox-recovery.test.ts --bail=1`  
Expected: FAIL because state changes and direct send are not atomic/recoverable.

- [ ] **Step 3: Enqueue replies in the domain transaction**

Replace direct Telegram sends from deterministic menu commands with outbox inserts carrying org-first unique `idempotencyKey`, kind, integration, conversation, sequence/dependency, text, encoded logical markup, and FSM revision. Required confirmation/repricing/cancellation rows are immutable and precede the resulting menu. `isTest` writes only sandbox messages and returns before outbox insertion.

- [ ] **Step 4: Implement lease-based delivery**

Claim due rows with conditional update, call Telegram outside SQL transactions, then record `telegram_message_id` and atomically activate the new menu. Retry known pre-send failures/429/5xx; terminal 401 marks integration `reconnect_required`; ambiguous acceptance becomes `delivery_unknown`. Only menu/typing entries for a superseded FSM revision become `superseded`; required notices never do.

- [ ] **Step 5: Run outbox and sandbox tests**

Run: `pnpm vitest run tests/integration/telegram-outbox-recovery.test.ts tests/unit/telegram-menu-send.test.ts tests/unit/telegram-send.test.ts tests/unit/send-sandbox.test.ts --bail=1`  
Expected: PASS with zero external calls for `isTest`.

- [ ] **Step 6: Commit**

```bash
git add src/server/telegram/outbox.ts src/server/inbox/send.ts src/server/telegram/menu-store.ts src/server/ai/commands.ts tests/integration/telegram-outbox-recovery.test.ts tests/unit/telegram-menu-send.test.ts
git commit -m "feat(telegram): deliver menus through transactional outbox"
```

### Task 9: Enforce one active cart and aggregate duplicated lines

**Files:**
- Create: `src/server/ecommerce/cart-normalizer.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/lib/db/schema.ts`
- Create: generated `drizzle/0013_*.sql`
- Create: `scripts/preflight-commerce.mjs`
- Test: `tests/integration/ecommerce-cart-reconciliation.test.ts`
- Test: `tests/unit/ecommerce-cart-normalizer.test.ts`

**Interfaces:**
- Produces: `aggregateAndValidateShape(items)`, `validateAdmission(aggregate, settings, lockedProducts)`, preserved price/source buckets, and partial unique active-cart index.
- Consumes: `productId` cart lines and tenant commerce settings.

- [ ] **Step 1: Write duplicated-line and duplicated-cart failures**

```ts
it("rejects aggregate quantity above the tenant limit", () => {
  expect(() => normalizeCartItems([
    item(productId, 3), item(productId, 3),
  ], { maxUnitsPerProduct: 3 })).toThrowError("tenant_limit_exceeded");
});

it("has exactly one active cart after legacy reconciliation", async () => {
  await seedTwoActiveCarts(conversationId);
  await reconcileActiveCarts(organizationId, conversationId);
  expect(await activeCarts(conversationId)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/unit/ecommerce-cart-normalizer.test.ts tests/integration/ecommerce-cart-reconciliation.test.ts --bail=1`  
Expected: FAIL because checkout validates lines independently and the index is non-unique.

- [ ] **Step 3: Implement shape aggregation separately from admission**

Aggregate by `productId`, validate safe positive integers, and preserve price/source buckets; never expose/use SKU in customer flows. Admission separately validates current tenant limit, tenant-owned active products, and locked stock. Adding at a new catalog price appends a bucket and never overwrites earlier snapshots. Cancellation restores recorded stock even when today’s tenant limit is lower; edit/reopen validates before mutating the prior order.

- [ ] **Step 4: Implement audited legacy reconciliation**

With the application stopped, `preflight-commerce.mjs` takes an advisory lock and lists duplicate active carts and aggregate violations. It rejects missing/cross-tenant/inactive/deleted products, invalid quantity/price, overstock, and `reopenedFromOrder` conflicts. Migration locks affected conversations, selects newest cart by `(created_at,id)`, merges valid lines and price buckets, audits older carts as abandoned, and raises instead of truncating invalid data. Then create:

```sql
CREATE UNIQUE INDEX "cart_org_conv_active_uq"
ON "cart" ("organization_id", "conversation_id")
WHERE "status" = 'active';
```

- [ ] **Step 5: Apply and verify migration**

Run: `pnpm tsx scripts/preflight-commerce.mjs`  
Expected: exit 0 and report zero blocking violations.  
Run: `pnpm db:migrate && SCHEMA_VERIFY_PHASE=commerce pnpm db:verify`  
Expected: partial unique index exists and no duplicate active carts remain.

- [ ] **Step 6: Run commerce regression and commit**

Run: `pnpm vitest run tests/unit/ecommerce-cart-normalizer.test.ts tests/integration/ecommerce-cart-reconciliation.test.ts tests/integration/ecommerce-order-concurrency.test.ts --bail=1`  
Expected: PASS.

```bash
git add src/server/ecommerce/cart-normalizer.ts src/server/ecommerce/service.ts src/lib/db/schema.ts drizzle scripts/preflight-commerce.mjs tests/unit/ecommerce-cart-normalizer.test.ts tests/integration/ecommerce-cart-reconciliation.test.ts
git commit -m "feat(commerce): enforce aggregate cart invariants"
```

### Task 10: Replace random order numbers with tenant counters

**Files:**
- Create: `src/server/ecommerce/order-number.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: generated `drizzle/0013_*.sql`
- Test: `tests/integration/ecommerce-order-number.test.ts`

**Interfaces:**
- Produces: `allocateOrderNumber(tx, organizationId): Promise<string>`.
- Consumes: `commerceOrderCounter` row locked by organization.

- [ ] **Step 1: Write collision and concurrency failures**

```ts
it("allocates 100 concurrent unique sequential order numbers", async () => {
  const numbers = await Promise.all(Array.from({ length: 100 }, () => createOrderForTenant()));
  expect(new Set(numbers)).toHaveLength(100);
  expect(numbers.every((number) => /^ORD-\d{6,}$/.test(number))).toBe(true);
});
```

- [ ] **Step 2: Run test red**

Run: `pnpm vitest run tests/integration/ecommerce-order-number.test.ts --bail=1`  
Expected: FAIL when deterministic `Math.random` produces `23505`.

- [ ] **Step 3: Backfill and implement transactional allocation**

Create an organization-keyed `bigint CHECK(next_value > 0)` counter. Migration backfills each tenant to `max(valid numeric ORD suffix)+1`, reports nonconforming legacy values without colliding, and is tested from populated 0010 for independent tenants, large values, idempotence, and rollback/reapply. Allocation locks/upserts through the caller’s checkout transaction and returns `ORD-${value.toString().padStart(6, "0")}`. Remove all use of `Math.random` for order identity.

- [ ] **Step 4: Run order tests and commit**

Run: `pnpm vitest run tests/integration/ecommerce-order-number.test.ts tests/integration/ecommerce-order-concurrency.test.ts --bail=1`  
Expected: PASS and no `23505`.

```bash
git add src/server/ecommerce/order-number.ts src/server/ecommerce/service.ts src/lib/db/schema.ts drizzle tests/integration/ecommerce-order-number.test.ts
git commit -m "feat(orders): allocate tenant-scoped order numbers"
```

### Task 11: Apply automatic repricing with durable disclosure

**Files:**
- Create: `src/server/ecommerce/pricing.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/server/ai/commands.ts`
- Test: `tests/unit/ecommerce-pricing.test.ts`
- Test: `tests/integration/ecommerce-repricing.test.ts`

**Interfaces:**
- Produces: `PriceChange` and `repriceItems(currentItems, lockedProducts)`.
- Consumes: Task 8 outbox and normalized cart items.

- [ ] **Step 1: Write checkout and merge repricing failures**

```ts
it("returns and discloses every automatic price change", async () => {
  await addAtPrice(productId, 100, 2);
  await changeCatalogPrice(productId, 777);
  const result = await confirmarPedido(context);
  expect(result).toMatchObject({ ok: true, priceChanges: [{ oldPrice: 100, newPrice: 777, quantity: 2 }] });
  expect(await lastOutboxText()).toContain("$100 → $777");
  expect(await lastOutboxText()).toContain("Total definitivo");
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/unit/ecommerce-pricing.test.ts tests/integration/ecommerce-repricing.test.ts --bail=1`  
Expected: FAIL because current results omit price changes.

- [ ] **Step 3: Implement pure repricing calculation**

```ts
export type PriceChange = {
  productId: string; name: string; presentation: string | null;
  source: string; oldPrice: number; newPrice: number; quantity: number; difference: number;
};
```

Lock products, calculate `difference = (newPrice - oldPrice) * quantity` for every preserved old-price/source bucket, and return changes from checkout and merge. Explicitly test add at 100, catalog 200, add again, checkout at 777. Keep stock, order, cart state, required ordered outbox notification, and resulting menu in one caller-owned domain transaction.

- [ ] **Step 4: Render exact customer disclosure**

For each change render `• Nombre — Presentación: $anterior → $nuevo × cantidad (diferencia ±$monto)` and finish with `Total definitivo: $... CLP`. For third+fourth merge state that the combined order replaces the former third active order.

- [ ] **Step 5: Run pricing, merge, and menu tests**

Run: `pnpm vitest run tests/unit/ecommerce-pricing.test.ts tests/integration/ecommerce-repricing.test.ts tests/integration/ecommerce-order-concurrency.test.ts tests/unit/slash-commands.test.ts --bail=1`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ecommerce/pricing.ts src/server/ecommerce/service.ts src/server/ai/commands.ts tests/unit/ecommerce-pricing.test.ts tests/integration/ecommerce-repricing.test.ts tests/unit/slash-commands.test.ts
git commit -m "feat(commerce): disclose automatic repricing"
```

### Task 12: Make Telegram bot configuration owner-only and compensating

**Files:**
- Modify: `src/app/api/settings/telegram/route.ts`
- Modify: `src/server/telegram/credentials.ts`
- Modify: `src/server/telegram/integrations.ts`
- Create: `scripts/rotate-telegram-webhook-secret.ts`
- Test: `tests/integration/telegram-settings-atomicity.test.ts`
- Test: `tests/unit/telegram-webhook-url.test.ts`

**Interfaces:**
- Produces: compensated `connectTelegramBot` workflow and URL/header secret hashes.
- Consumes: owner session and Task 2 bot uniqueness.

- [ ] **Step 1: Write role and compensation failures**

```ts
it("rejects a non-owner before calling Telegram", async () => {
  const response = await putTelegramSettings(memberSession, tokenRequest);
  expect(response.status).toBe(403);
  expect(setWebhook).not.toHaveBeenCalled();
});

it("restores the previous webhook when persistence fails", async () => {
  failCredentialSave();
  await expect(connectTelegramBot(input)).rejects.toThrow();
  expect(setWebhook).toHaveBeenLastCalledWith(expect.objectContaining({ url: previousUrl }));
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/integration/telegram-settings-atomicity.test.ts --bail=1`  
Expected: FAIL because any authenticated member can PUT and no compensation exists.

- [ ] **Step 3: Implement owner gate and staged configuration**

Return `403 forbidden` unless `session.role === "owner"`. Generate independent URL/header secrets, call `getMe`, reject a `botId` owned by another organization, persist a pending integration, set webhook with `secretToken`, set commands, then mark connected. On failure restore previous Telegram webhook and DB row; never return a webhook secret in API JSON.

`scripts/rotate-telegram-webhook-secret.ts` iterates every eligible `header_pending` row and any connected row missing a verified header. It stages encrypted active/previous route and header secret versions, rotates with the tenant token, verifies `getWebhookInfo`, and only then promotes hashes/status. Header enforcement begins only at 100% verified coverage; compensation decrypts the previous versions.

- [ ] **Step 4: Run settings tests and commit**

Run: `pnpm tsx scripts/rotate-telegram-webhook-secret.ts`  
Expected: every eligible integration reports rotated and verified; no messages are sent. Failures at pending persistence, webhook, commands, verification, and final promotion are independently tested.  
Run: `pnpm vitest run tests/integration/telegram-settings-atomicity.test.ts tests/unit/telegram-integrations.test.ts tests/unit/telegram-webhook-url.test.ts --bail=1`  
Expected: PASS.

```bash
git add src/app/api/settings/telegram/route.ts src/server/telegram/credentials.ts src/server/telegram/integrations.ts scripts/rotate-telegram-webhook-secret.ts tests/integration/telegram-settings-atomicity.test.ts tests/unit/telegram-webhook-url.test.ts
git commit -m "fix(telegram): make bot setup owner-only and atomic"
```

### Task 13: Remove the WhatsApp runtime and archive its schema

**Files:**
- Delete: `src/server/whatsapp/`
- Delete: `src/lib/meta/`
- Delete: `src/app/api/webhooks/wa/`
- Delete: `src/app/api/settings/whatsapp/`
- Delete: `src/app/api/templates/`
- Delete: `src/app/api/conversations/[id]/messages/template/`
- Delete: `src/app/api/dev/wa-mock/`
- Delete: `src/server/dev/wa-mock-inbound.ts`
- Delete: `src/server/dev/wa-mock-state.ts`
- Delete: `src/components/settings/whatsapp-wizard.tsx`
- Delete: `src/components/settings/templates-client.tsx`
- Delete: `src/components/inbox/template-sender.tsx`
- Delete: `src/app/(app)/settings/templates/`
- Delete: `tests/unit/credentials.test.ts`
- Delete: `tests/unit/meta-client.test.ts`
- Delete: `tests/unit/templates.test.ts`
- Delete: `tests/unit/webhook.test.ts`
- Delete: `tests/unit/window.test.ts`
- Delete: `tests/unit/status-monotonic.test.ts`
- Delete: `tests/e2e/us6-templates.md`
- Modify: `src/app/(app)/settings/whatsapp/page.tsx`
- Modify: `src/components/settings/settings-nav.tsx`
- Modify: `src/components/inbox/composer.tsx`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/db/schema.ts`
- Create: generated `drizzle/0014_*.sql`
- Test: `tests/unit/telegram-only-surface.test.ts`
- Test: `tests/integration/whatsapp-retirement-migration.test.ts`

**Interfaces:**
- Produces: Telegram-only runtime and static disabled WhatsApp settings notice.
- Consumes: migrated generic message identity from Task 5.

- [ ] **Step 1: Write runtime-surface failures**

```ts
it("exposes no WhatsApp or template API routes", () => {
  expect(routeFiles()).not.toEqual(expect.arrayContaining([
    expect.stringContaining("api/webhooks/wa"),
    expect.stringContaining("api/settings/whatsapp"),
    expect.stringContaining("api/templates"),
  ]));
});

it("shows only the disabled WhatsApp notice", () => {
  render(<WhatsappSettingsPage />);
  expect(screen.getByText("WhatsApp (deshabilitado)")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});
```

- [ ] **Step 2: Run tests red**

Run: `pnpm vitest run tests/unit/telegram-only-surface.test.ts --bail=1`  
Expected: FAIL because WhatsApp routes and wizard remain.

- [ ] **Step 3: Replace the settings page and remove runtime imports**

The page renders exactly:

```tsx
export default function WhatsappSettingsPage() {
  return <p className="text-sm text-muted-foreground">WhatsApp (deshabilitado)</p>;
}
```

Remove templates from the composer and navigation, delete Graph/WhatsApp code, remove Meta environment variables, window rules, template message types, tests that exclusively assert WhatsApp behavior, and dependencies no longer imported.

- [ ] **Step 4: Create and restore-test the external backup**

Stop the application, freeze/drain all queues, run a local external `pg_dump`, record SHA-256 and row counts, and restore it into a temporary database. Abort 0014 unless the restore drill passes. The in-database archive is not the backup.

- [ ] **Step 5: Archive and drop WhatsApp tables**

Migration 0014 must abort unless the migrator validates `CONFIRM_DROP_WHATSAPP_DATA=0014:<sha256-of-0014-sql>` and the backup manifest. Under an advisory lock, one transaction creates schema `retired_whatsapp`, copies `meta_credentials` and `template` with row counts/checksums, verifies them, then drops public tables and WhatsApp-only columns. Preserve contacts, conversations, generic messages, carts, and orders; test failed-copy rollback and forward restoration.

- [ ] **Step 6: Verify migration from a 0010 fixture**

Run: `CONFIRM_DROP_WHATSAPP_DATA=0014:<sha256> pnpm vitest run tests/integration/whatsapp-retirement-migration.test.ts tests/integration/whatsapp-backup-restore.test.ts --bail=1`  
Expected: PASS; external restore works, archive counts/checksums match fixtures, public WhatsApp tables are absent, generic history remains.

- [ ] **Step 7: Run source scan and focused tests**

Run: `rg -n "server/whatsapp|lib/meta|api/webhooks/wa|api/templates|waMessageId|window_closed" src`  
Expected: no output.  
Run: `pnpm vitest run tests/unit/telegram-only-surface.test.ts tests/unit/telegram-send.test.ts tests/unit/frontend-tenant-ui.test.ts --bail=1`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src drizzle tests package.json pnpm-lock.yaml
git commit -m "refactor: retire WhatsApp from Telegram edition"
```

### Task 14: Execute migration, API, regression, and red-team release gates

**Files:**
- Create: `tests/integration/telegram-reliability-chaos.test.ts`
- Create: `docs/qa/2026-07-23-telegram-reliability-report.md`
- Modify: `specs/002-migracion-chatbot-rag-telegram/plan.md`

**Interfaces:**
- Produces: release evidence and final go/no-go decision.
- Consumes: all prior tasks.

- [ ] **Step 1: Write the chaos matrix**

Cover these exact cases: crash before claim, crash after claim, expired lease, duplicate update, same update ID on replacement bot, same chat/message ID across tenants, `1,1`, `3,3`, delayed `3`, `I,R`, callback/text mixed burst, 20 double callbacks, timeout, 429, 500, 401, reversed sends, duplicate cart lines, duplicate active carts, 100 concurrent order numbers, repricing checkout, repricing third+fourth merge, stock change, sandbox, and non-private chats.

- [ ] **Step 2: Run chaos tests fail-fast**

Run: `pnpm vitest run tests/integration/telegram-reliability-chaos.test.ts --bail=1`  
Expected: PASS; stop immediately on the first failure and fix it in the owning task before continuing.

- [ ] **Step 3: Freeze/drain queues and rebuild with mandatory scripts**

Verify zero `processing` rows and active leases, then run: `./scripts/du.sh`  
Expected: PostgreSQL and application dependencies healthy.  
Run: `./scripts/run.sh`  
Expected: application listening only on port 3000.

- [ ] **Step 4: Verify actual schema and application health**

Run: `pnpm db:verify && curl --fail http://127.0.0.1:3000/api/health`  
Expected: verifier exits 0 and health returns `{"ok":true}`.

- [ ] **Step 5: Run all static and automated gates**

Run: `pnpm typecheck && pnpm lint && pnpm test -- --bail=1 && pnpm build`  
Expected: zero errors, all tests PASS, production build PASS. Existing unrelated lint warnings must be either removed in their owning files or documented with exact file and rule; no new warning is accepted.

- [ ] **Step 6: Execute the isolated real Telegram canary**

Run: `pnpm test:telegram:connection`, verify `getWebhookInfo` without secrets, then execute the authorized canary private-chat matrix with real button clicks and typed numeric inputs. Cover categories, enumerated product selection, quantity/cart, orders, old-menu input, return/start, and double clicks. Drain updates with a bounded timeout and decreasing trend rather than an instantaneous zero assertion.  
Expected: correct tenant bot, verified webhook, no current error, visible messages match DB transitions, old/burst inputs are silent, and no production chat is used.

- [ ] **Step 7: Run the same three red-team reviews**

FSM reviewer must approve revision bursts, exact transitions, quantity step, handoff, and delivery ordering. Commerce reviewer must approve cart uniqueness, aggregation, counters, repricing, stock, and third+fourth merge. API reviewer must approve durable receipts, timeout, identity, owner authorization, private-only policy, sandbox, outbox, pagination, and migrations.

Exit criterion: all three return `APPROVED`; any critical/high finding returns the release to the owning task.

- [ ] **Step 8: Write and commit release evidence**

The QA report records commit, migration tags, schema query results, test totals, API status, red-team verdicts, and rollback instructions.

```bash
git add tests/integration/telegram-reliability-chaos.test.ts docs/qa/2026-07-23-telegram-reliability-report.md specs/002-migracion-chatbot-rag-telegram/plan.md
git commit -m "test: certify Telegram reliability release"
```

## Rollback Gates

1. Before migration 0014, retain a database backup and the `retired_whatsapp` archive counts.
2. Additive migrations 0011-0013 may be rolled back only before new-format writes reach production.
3. After identity cutover, rollback requires a reverse data migration; never deploy old code against the new message uniqueness contract.
4. After WhatsApp retirement, application rollback must use a database snapshot or a forward restoration migration from `retired_whatsapp`; never recreate empty credential tables silently.
5. Outbox and receipts must be drained or deliberately frozen before rolling application versions.

## Final Definition of Done

- Schema migrations apply from an empty database and from a populated 0010 fixture.
- A second migration execution is idempotent.
- No public WhatsApp tables, routes, runtime imports, or environment requirements remain.
- `WhatsApp (deshabilitado)` is the only WhatsApp settings UI.
- Every Telegram update reaches `processed`, `ignored`, or `failed`; no receipt remains abandoned.
- Only one entry in a burst consumes an FSM revision.
- Only one active cart exists per tenant conversation.
- Duplicate product lines cannot bypass tenant limits.
- Order numbers do not collide under concurrency.
- Every automatic repricing is disclosed through a durable outbound message.
- Full suite, typecheck, lint, build, live health, read-only Telegram API, and all three red-team reviews pass.
