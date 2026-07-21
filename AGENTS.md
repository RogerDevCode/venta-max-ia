# AGENTS.md — Contrato Operativo y Hoja de Ruta de Migración (Venta Max IA)

## 1. Identidad y Origen del Repositorio
- **Nombre del Producto:** Venta Max IA
- **Repositorio Git Origen:** `git@github.com:RogerDevCode/venta-max-ia.git` (históricamente `https://github.com/kevinrivm/vocero-crm.git`)
- **Ubicación Local:** `/home/manager/Sync/python_proyects/venta-max-ia`
- **Proyecto Hermano (Fuente de Lógica Migrada):** `/home/manager/Sync/python_proyects/chatbot` (Backend Python/FastAPI)

---

## 2. Visión Estratégica: ¿Qué esperamos hacer?
Nuestro objetivo es **consolidar la tecnología de los dos mundos en un producto de grado empresarial supremo**:
1. **Conservar e inyectarnos sobre el chasis de `venta-max-ia`:** Mantenemos intacta su arquitectura superior en TypeScript/Next.js 15/React 19, su motor Drizzle ORM sobre PostgreSQL, su estricto modelo **Multi-Tenant real (`organization_id` + `scoped()`)**, su seguridad con cifrado en reposo (`AES-256-GCM`), su bandeja web en tiempo real (SSE), su Kanban de ventas y su estelar **Laboratorio de auto-evaluación con Juez LLM (`judge.ts`)**.
2. **Migrar e integrar las capacidades avanzadas de `chatbot`:** Traemos hacia el motor y *pipeline* de Venta Max IA (`src/server/ai/` y `src/lib/`) los algoritmos avanzados de tu proyecto Python:
   - **Canal Telegram:** Reemplazo/expansión de WhatsApp Cloud API por la **Telegram Bot API** (sin ventanas de 24h ni plantillas restrictivas).
   - **Menús e Interactividad:** Teclados (`inline_keyboard` y `reply_markup`) generados por el Agente y visualizados con pastillas interactivas en la bandeja web.
   - **RAG y Búsqueda Vectorial (`pgvector`):** Extracción e inyección dinámica de contexto con embeddings y búsqueda de similitud.
   - **Flujos y Variables de Estado (FSB / GADK):** Acumulación estructurada de variables en sesión (`stateMetadata`) y transiciones controladas.
   - **E-Commerce / Catálogo y Carrito:** Acciones del Agente (`actions.ts`) para buscar productos, armar carritos y generar pedidos vinculados al Kanban.
3. **Sinergia Suprema:** El Laboratorio de auto-evaluación (`judge.ts`) pondrá a prueba automáticamente el RAG, los flujos y los menús migrados utilizando arquetipos de clientes guionados antes de salir a producción.

---

## 3. Infraestructura Soberana y Autocontenida (PostgreSQL + `pgvector`)
Respetando el **Principio II (Soberanía y Self-Hosted)**, `venta-max-ia` tiene y opera **su propia infraestructura independiente** y su propio `docker-compose.dev.yml` / `docker-compose.yml`:
- **Imagen Docker de Base de Datos:** `pgvector/pgvector:pg18` (PostgreSQL 18 con soporte vectorial nativo integrado).
- **Host y Puerto Local:** `127.0.0.1:5432`
- **Usuario:** `postgres`
- **Contraseña:** `postgres` (o según `.env`)
- **Base de Datos Destino:** `vocero`
- **Cadena de Conexión (`DATABASE_URL`):** `postgresql://postgres:postgres@127.0.0.1:5432/vocero`

Para levantar o apagar la base de datos de desarrollo propia de `venta-max-ia`:
```bash
# Levantar BD de desarrollo
docker compose -f docker-compose.dev.yml up -d postgres

# Apagar y limpiar servicios
docker compose -f docker-compose.dev.yml down
```

---

## 4. Reglas No Negociables (Constitución y Disciplina)
Todo agente de IA o desarrollador operando en este repositorio **debe cumplir estrictamente** con la constitución (`.specify/memory/constitution.md` y `CLAUDE.md`):
1. **Multi-Tenancy Real (Principio III):** Toda tabla de dominio lleva `organization_id NOT NULL` e índices compuestos (`org-first`). Toda query en Drizzle pasa por `scoped(organization_id)` (`src/lib/db/tenant.ts`).
2. **Soberanía y Simplicidad (Principio II):** Prohibido introducir dependencias pesadas externas como Redis, S3, o colas externas en runtime. Todo corre in-process con SSE sobre Node.js/Next.js.
3. **Idempotencia (Principio IV):** Toda ingesta desde webhooks verifica unicidad (`telegramMessageId` / `waMessageId` UNIQUE) para no duplicar acciones en reintentos de red.
4. **Sandbox del Laboratorio:** Las conversaciones de prueba (`is_test: true`) **jamás** envían peticiones reales a Telegram o WhatsApp. Existe un bloqueo en la capa saliente (`send.ts`).
5. **Calidad y Verificación en Vivo (Principios V y IX):** Una tarea no está terminada hasta pasar el ciclo: **Paso → Test (Vitest/Playwright) → Verde (`PASS`)**. Prohibido delegar la prueba al usuario o dejar código optimista sin verificar.

---

## 5. Ubicación del Plan Detallado
El Plan Maestro de Implementación paso a paso (con casillas de verificación para seguimiento TDD/SDD) reside en:
👉 `specs/002-migracion-chatbot-rag-telegram/plan.md`

---

## 6. Anexo Operativo — Renombre a Venta Max IA (2026-07-21)
- **Renombre completado:** la carpeta raíz pasó de `vocero-crm` a
  `/home/manager/Sync/python_proyects/venta-max-ia`; el paquete npm es
  `venta-max-ia` y la marca visible es **Venta Max IA**.
- **Alcance aplicado:** se actualizaron UI, marca por defecto, documentación,
  ejemplos, mocks, pruebas y metadatos de imagen Docker. La clave de
  `localStorage` de la bandeja es `venta-max-ia.panelOpen`.
- **Compatibilidad preservada intencionalmente:** no renombrar la base
  PostgreSQL `vocero` ni los volúmenes/redes/servicios Docker con prefijo
  `vocero` hasta que se migren esos recursos externos. El remoto Git fue
  actualizado por el propietario a `git@github.com:RogerDevCode/venta-max-ia.git`.
- **Referencias históricas:** los directorios e IDs de especificaciones como
  `specs/001-vocero-core` permanecen para no romper enlaces ni trazabilidad;
  no representan la marca actual.
- **Verificación del renombre:** `pnpm test` pasó con 29 archivos y 131 tests.
- **Bloqueos conocidos ajenos al renombre:** `pnpm typecheck` falla en
  `src/server/ai/rag/embeddings.ts` porque `opts.provider` no está declarado
  en su tipo; `pnpm lint` y `pnpm build` fallan por tres usos de `any` en
  `src/lib/telegram/client.ts`. Diagnosticar y corregirlos en una tarea
  separada, conservando el ciclo completo de verificación.
