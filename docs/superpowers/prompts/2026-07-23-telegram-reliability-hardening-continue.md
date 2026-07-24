# Prompt de continuación: Telegram Reliability Hardening

Actúa como ingeniero principal en el repositorio `/home/manager/Sync/python_proyects/venta-max-ia`. Debes continuar la ejecución del plan `docs/superpowers/plans/2026-07-23-telegram-reliability-hardening.md` desde el checkpoint ya documentado en la sección **Estado de ejecución**. No reinicies tareas ya realizadas ni reviertas cambios existentes.

## Objetivo

Completar únicamente el trabajo pendiente del plan y dejar evidencia verificable de release para Venta Max IA: Telegram-only, procesamiento durable ante crashes/reintentos, invariantes de comercio, multi-tenancy, sandbox de laboratorio y retiro seguro de WhatsApp.

## Estado conocido

- Migraciones `0011`–`0014` existen y están aplicadas.
- `pnpm db:migrate` es idempotente; `pnpm db:verify` pasa.
- Vitest completo: 46 archivos y 209 tests PASS.
- `pnpm typecheck` y `pnpm lint` pasaron antes de los últimos ajustes de clases Tailwind.
- `pnpm build` pasó antes de esos ajustes; repetirlo obligatoriamente.
- `./scripts/du.sh` dejó PostgreSQL saludable.
- `./scripts/run.sh` arrancó correctamente en puerto 3000 y fue detenido para pausar la sesión.
- No hay commits de esta ejecución; preserva el worktree y no uses `git reset --hard`, `git checkout --` ni comandos destructivos.

## Reglas operativas obligatorias

1. Lee `AGENTS.md` y el plan completo antes de editar.
2. Usa `./scripts/du.sh` para infraestructura y `./scripts/run.sh` para la aplicación; el puerto es siempre 3000.
3. Todo cambio debe tener prueba fail-first o una prueba de regresión equivalente.
4. No introduzcas Redis, S3, servicios externos ni runtime WhatsApp.
5. Mantén `organization_id NOT NULL`, índices org-first y consultas `scoped(organization_id)`.
6. `is_test: true` nunca puede llamar Telegram, incluyendo typing, callback ACK y outbox.
7. Las tareas asíncronas deben usar `.catch(logError)` o `Promise.allSettled()`.
8. No declares éxito sin comandos ejecutados y salida PASS. Si falta credencial para el canary real, documenta el bloqueo exacto sin inventar evidencia.

## Secuencia exacta de continuación

### 1. Inspección y gates rápidos

Ejecuta:

```bash
git status --short
pnpm db:migrate
pnpm db:verify
pnpm typecheck
pnpm lint
pnpm build
```

Corrige sólo regresiones introducidas por el trabajo actual. Después repite los comandos fallidos.

### 2. Health en vivo

Arranca con `./scripts/run.sh`, espera a que Next indique `Ready`, ejecuta:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

Comprueba que el JSON indique `ok: true` y que exponga las métricas de receipts, leases, conflicts, stale ignores, ambiguous deliveries, errores del worker y purge. Al terminar, detén el proceso limpiamente y registra el resultado.

### 3. Completar Task 14: chaos matrix

Revisa primero los tests existentes y crea `tests/integration/telegram-reliability-chaos.test.ts` sólo para huecos reales. Debe cubrir, como mínimo: crash antes/después de claim, lease expirado, duplicate update y payload conflict, reemplazo de bot, colisiones entre tenants, bursts `1,1`, `3,3`, número retrasado, `I,R`, callbacks duplicados (20), timeout/429/500/401, respuesta aceptada y perdida, ordering inverso del outbox, cart duplicado, 100 order numbers concurrentes, repricing en checkout y merge tercero/cuarto, cambio de stock, sandbox y chats no privados.

Usa:

```bash
pnpm vitest run tests/integration/telegram-reliability-chaos.test.ts --bail=1
```

Cada fallo debe arreglarse en el módulo propietario (`src/server/telegram`, `src/server/ai` o `src/server/ecommerce`) y cubrirse con una prueba enfocada antes de continuar.

### 4. Informe QA y plan maestro

Crea `docs/qa/2026-07-23-telegram-reliability-report.md` con: commit/hash de trabajo, migraciones aplicadas, resultado del verificador semántico, conteo de tests, typecheck/lint/build, health HTTP, matriz chaos, estado de colas, backup/restauración 0014, riesgos y rollback. Actualiza `specs/002-migracion-chatbot-rag-telegram/plan.md` para reflejar Telegram-only y la firma `agregar_al_carrito(productId, cantidad)` con snapshot inmutable.

### 5. Canary Telegram real (sólo con autorización y credenciales disponibles)

No uses producción. Ejecuta `pnpm test:telegram:connection` y, en un bot/chat privado aislado autorizado, prueba botones, entrada numérica, categorías, selección de producto, cantidad, carrito, orden, input de menú antiguo, `/start`, doble click y drain con timeout acotado y tendencia decreciente. `getMe/getWebhookInfo` por sí solos no son suficientes. Si no hay credenciales/chat autorizados, deja el canary como BLOCKED en el informe y continúa con todo lo demás.

### 6. Revisión y cierre

Haz tres revisiones explícitas (FSM, Commerce, API/reliability) y registra `APPROVED` o hallazgos críticos/altos. Ejecuta la suite final:

```bash
pnpm db:verify
pnpm typecheck
pnpm lint
pnpm test -- --bail=1
pnpm build
```

No ejecutes `git commit` automáticamente si el usuario no lo solicita; entrega el diff y la evidencia. Si sí se solicita commit, agrupa cambios con mensajes claros y no mezcles archivos ajenos.

## Formato de salida requerido

Responde en español y con máxima concisión: archivos modificados, comandos ejecutados con PASS/FAIL/BLOCKED, pendientes concretos y riesgos. No afirmes que el plan está completo mientras Task 14 no tenga evidencia suficiente.
