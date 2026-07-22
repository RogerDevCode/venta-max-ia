# AGENTS.md — Contrato Operativo (Venta Max IA)

## 1. Identidad
- **Producto:** Venta Max IA
- **Git Origen:** `git@github.com:RogerDevCode/venta-max-ia.git`
- **Ubicación Local:** `/home/manager/Sync/python_proyects/venta-max-ia`
- **Proyecto Origen (Lógica Migrada):** `/home/manager/Sync/python_proyects/chatbot` (Python/FastAPI)

---

## 2. Visión Estratégica
Consolidar la arquitectura TypeScript/Next.js 15/React 19 de Venta Max IA con la lógica de negocio de `chatbot`:
- **Chasis:** Multi-Tenant real (`organization_id` + `scoped()`), Drizzle ORM sobre PostgreSQL, cifrado `AES-256-GCM`, SSE en tiempo real y Juez LLM (`judge.ts`).
- **Capacidades Migradas:** Telegram Bot API, teclados e interactividad, RAG con `pgvector`, flujos de estado (FSB/GADK) y carrito/E-Commerce.

---

## 3. Infraestructura y Scripts de Control Obligatorios
Todo agente o desarrollador DEBE dar **uso preferencial a los siguientes scripts** frente a comandos aislados manuales.

### Scripts Principales
- `./scripts/dd.sh`: Apaga y limpia de forma segura todos los contenedores Docker (`docker-compose.dev.yml` y `docker-compose.yml`) y contenedores huérfanos.
- `./scripts/du.sh`: Invoca `./scripts/dd.sh` para limpiar el estado y luego levanta los servicios en segundo plano usando por defecto `docker-compose.dev.yml`. Verifica el estado de salud (`healthy`) de los servicios y muestra logs detallados si ocurre una falla.
- `./scripts/run.sh`: Inicia el servidor de desarrollo (`pnpm dev`). **LEY INVIOLABLE:** La aplicación debe correr SIEMPRE en el puerto `3000`. Si el puerto 3000 se encuentra ocupado, `./scripts/run.sh` identifica el proceso, lo liquida (`kill -9`) para liberar el puerto y posteriormente inicia la aplicación.

### Datos de Infraestructura Local
- **PostgreSQL + pgvector:** Contenedor `pgvector/pgvector:pg18` (BD `vocero`, puerto `5432`).
- **DATABASE_URL:** `postgresql://postgres:postgres@127.0.0.1:5432/vocero`

---

## 4. Reglas No Negociables (Constitución)
1. **Uso de Scripts sobre Comandos Manuales:** Usar obligatoriamente `./scripts/dd.sh`, `./scripts/du.sh` y `./scripts/run.sh` en lugar de comandos sueltos de Docker o Node.
2. **Ley del Puerto 3000:** La aplicación SIEMPRE opera en el puerto 3000 mediante `./scripts/run.sh`. Si el puerto está ocupado, se libera antes de iniciar.
3. **Cero Verbosidad:** Prohibido incluir explicaciones intermedias o relleno en las respuestas. Devolver únicamente la confirmación final de archivos modificados, diffs o el resultado directo.
4. **Multi-Tenancy Real:** Toda tabla de dominio debe incluir `organization_id NOT NULL` e índice compuesto `org-first`. Toda consulta Drizzle se filtra con `scoped(organization_id)`.
5. **Soberanía y Self-Hosted:** Sin dependencias externas en runtime (sin Redis ni S3 externos). Todo corre in-process con SSE sobre Node.js y PostgreSQL.
6. **Idempotencia:** Ingesta de webhooks verificando unicidad (`telegramMessageId` / `waMessageId` UNIQUE).
7. **Sandbox del Laboratorio:** Sesiones con `is_test: true` NUNCA envían peticiones reales a Telegram/WhatsApp.
8. **Verificación en Vivo:** Tarea terminada = Paso → Test (`Vitest`/`Playwright`) → `PASS`. Prohibido delegar pruebas al usuario.
9. **Concurrencia y Paralelismo:**
   - **Garantía de Ejecución:** Tareas en segundo plano DEBEN llevar `.catch(logError)` o `Promise.allSettled()`. Ningún proceso debe abandonarse a su suerte.
   - **Paralelo:** APIs externas y efectos secundarios (mensajes, SSE, métricas) usan `Promise.all` o llamadas asíncronas no bloqueantes.
   - **Serie:** Transacciones SQL y operaciones con dependencias directas de datos.
   - **Control de Concurrencia (Mutex):** Proteger ráfagas sobre un mismo recurso con semáforos por clave (ej. `coalesceMap` por `conversation_id`).

---

## 5. Plan de Implementación
Plan maestro TDD/SDD: `specs/002-migracion-chatbot-rag-telegram/plan.md`

---

## 6. Anexo Operativo (Renombre Venta Max IA)
- Marca y paquete renombrados a **Venta Max IA**.
- Mantenidos por compatibilidad: base de datos `vocero` y directorio `specs/001-vocero-core`.
