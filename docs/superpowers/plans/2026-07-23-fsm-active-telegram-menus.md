# Menús Telegram activos y transiciones FSB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechazar callbacks vencidos o inválidos por estado FSB, limpiar sus teclados y añadir Inicio/Retornar a cada submenú.

**Architecture:** La política FSB central define acciones permitidas. El emisor Telegram persiste el menú activo al recibir su ID; el webhook lo valida y consume antes de la ingesta. La limpieza del teclado es asíncrona.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM/PostgreSQL, Vitest, Telegram Bot API.

## Global Constraints

- Consultas tenant con `organization_id` y `scoped()`.
- Sin dependencias runtime externas.
- `is_test: true` no llama a Telegram.
- Efectos en segundo plano usan `.catch()`.

---

### Task 1: Política FSB y navegación

**Files:** Create `src/server/ai/menu-fsm.ts`; modify `src/server/ai/commands.ts`; test `tests/unit/menu-fsm.test.ts`.

- [ ] Escribir pruebas para una acción permitida, una transición inválida, `r`/`R`, `i`/`I` y la fila `[↩ Retornar, ⌂ Inicio]`.
- [ ] Ejecutar `pnpm vitest run tests/unit/menu-fsm.test.ts` y verificar fallo inicial.
- [ ] Implementar `isMenuActionAllowed`, `resolveTextNavigation` y la fila común de navegación; añadirla al final de cada teclado de submenú.
- [ ] Ejecutar la prueba y verificar PASS.

### Task 2: Menú activo y limpieza Telegram

**Files:** Modify `src/lib/telegram/client.ts`, `src/server/inbox/send.ts`; test `tests/unit/telegram-send.test.ts`.

- [ ] Escribir prueba que compruebe `activeMenu.telegramMessageId` persistido tras `sendMessage` y `editMessageReplyMarkup` con teclado vacío.
- [ ] Ejecutar `pnpm vitest run tests/unit/telegram-send.test.ts` y verificar fallo inicial.
- [ ] Implementar `clearInlineKeyboard` y persistir `{ telegramMessageId, version, state, allowedActions, parent }` scoped por organización tras cada envío con teclado.
- [ ] Ejecutar la prueba y verificar PASS.

### Task 3: Guard de callback atómico

**Files:** Create `src/server/inbox/telegram-menu-guard.ts`; modify `src/server/inbox/telegram-webhook.ts`; test `tests/unit/telegram-menu-guard.test.ts`.

- [ ] Escribir pruebas para callback válido, mensaje de menú viejo, acción inválida y doble clic.
- [ ] Ejecutar `pnpm vitest run tests/unit/telegram-menu-guard.test.ts` y verificar fallo inicial.
- [ ] Implementar actualización conditional scoped que consume `activeMenu` sólo si el ID Telegram, acción y estado FSB vigentes coinciden; rechazar antes de `ingestInboundMessage` e intentar limpiar el teclado con `.catch()` para ambos resultados.
- [ ] Ejecutar la prueba y verificar PASS.

### Task 4: Regresión

**Files:** Modify `tests/unit/slash-commands.test.ts`, `tests/unit/telegram-update.test.ts`.

- [ ] Cubrir Inicio y Retornar por texto y botón, y preservar sandbox e idempotencia.
- [ ] Ejecutar `pnpm vitest run tests/unit/menu-fsm.test.ts tests/unit/telegram-menu-guard.test.ts tests/unit/telegram-send.test.ts tests/unit/slash-commands.test.ts tests/unit/telegram-update.test.ts` y verificar PASS.
- [ ] Ejecutar `pnpm test` y verificar PASS.
