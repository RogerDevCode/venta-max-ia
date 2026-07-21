# FSM Ingress and Durable Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar y enrutar de forma segura cada actualización Telegram antes de que alcance la ingesta, el FSM, RAG o el agente.

**Architecture:** Una integración Telegram almacena un hash del token de ruta y su organización. El endpoint valida cuerpo y esquema, resuelve esa integración, registra un recibo idempotente y solo entrega actualizaciones nuevas y válidas al procesador existente. Las siguientes fases reemplazarán la ejecución en memoria por jobs PostgreSQL y añadirán FSM determinista.

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, Zod, Drizzle ORM, PostgreSQL 18, Vitest.

## Global Constraints

- Todas las tablas de dominio usan `organization_id NOT NULL` con índices org-first.
- Ningún tenant llega desde querystring ni desde una selección global de organizaciones.
- No añadir Redis, S3, colas externas ni dependencias nuevas.
- Los secretos se guardan cifrados o como hashes no reversibles; nunca en logs.
- Hecho exige `pnpm typecheck`, `pnpm lint`, `pnpm build` y pruebas verdes.

---

### Task 1: Contrato Telegram y pruebas de validación

**Files:**
- Create: `src/server/inbox/telegram-update.ts`
- Create: `tests/unit/telegram-update.test.ts`

- [x] Definir esquemas Zod para `message`, `callback_query` y `TelegramUpdate`.
- [x] Aceptar solo `message` o `callback_query`, IDs positivos y texto de hasta 4096 caracteres.
- [x] Exponer `parseTelegramUpdate(rawBody)` que devuelva un resultado tipado sin lanzar por datos externos.
- [x] Verificar cuerpo inválido, update sin contenido y callback válido con Vitest.

### Task 2: Integración e inbox Telegram multi-tenant

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/server/telegram/integrations.ts`
- Create: `tests/unit/telegram-integrations.test.ts`
- Create: `drizzle/0003_fat_jack_flag.sql`

- [x] Crear `telegram_integration` e `telegram_webhook_receipt` con claves únicas e índices organization-first.
- [x] Crear tokens con `randomBytes`, persistir solo SHA-256 y resolver la organización mediante el hash.
- [x] Registrar recibos `received`, `duplicate` y `conflict` usando `update_id` y hash de payload.
- [x] Probar que un token solo resuelve su organización y que un mismo update no se entrega dos veces.

### Task 3: Endpoint de webhook seguro

**Files:**
- Modify: `src/app/api/webhooks/telegram/[webhookToken]/route.ts`
- Create: `tests/unit/telegram-webhook-route.test.ts`

- [x] Rechazar token no registrado sin consultar organizaciones globales.
- [x] Limitar el body a 256 KiB y validar Zod antes de llamar a la ingesta.
- [x] Eliminar `orgId` por querystring y el fallback `organization.limit(1)`.
- [x] Registrar el receipt antes de programar el procesamiento y ACK idempotentemente los duplicados.
- [x] Probar ruta válida, malformada, duplicada, conflicto y token desconocido.

### Task 4: Verificación de entrega

**Files:**
- Modify: `tests/unit/telegram-webhook.test.ts` si cambian los contratos importados.

- [x] Ejecutar las pruebas unitarias Telegram.
- [x] Generar y aplicar migración en PostgreSQL local.
- [x] Ejecutar `pnpm test`, `pnpm typecheck`, `pnpm lint` y `pnpm build`.
- [x] Documentar cualquier fallo preexistente sin atribuirlo a esta feature.

## Fases posteriores

1. Worker/outbox PostgreSQL por conversación, con locks durables y reintentos.
2. FSM determinista persistido en `conversation.stateMetadata`.
3. Política RAG por intención y presupuestos de tokens/latencia.
4. Métricas P50/P95/P99 y nuevos casos del Laboratorio.
