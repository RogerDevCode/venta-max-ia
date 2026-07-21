# Plan Maestro de Implantación Migratoria: Chatbot (Python) → Venta Max IA (TS)

**ID:** `002-migracion-chatbot-rag-telegram`  
**Metodología:** SDD / TDD (1 Paso → 1 Test → Verde)  
**Infraestructura Soberana:** PostgreSQL + `pgvector` propio (`docker-compose.dev.yml` en puerto `5432`)

---

## 🏛️ Fase 0: Cimiento e Infraestructura Vectorial Propia (`pgvector`)
*Preparar la base de datos soberana en el puerto 5432 con `pgvector/pgvector:pg18` y habilitar vectores en Drizzle ORM.*

- [x] **Paso 0.1: Levantar BD propia y verificar `.env` en Puerto 5432**
  - **Acción:** Levantar la base local de Venta Max IA (`docker compose -f docker-compose.dev.yml up -d postgres`) con `.env` apuntando a `postgresql://postgres:postgres@127.0.0.1:5432/vocero`.
  - **Test (0.1):** Verificar salud del contenedor y correr `pnpm db:migrate` constatando que las tablas multi-tenant originales se apliquen en verde en la base propia.
- [x] **Paso 0.2: Extensión `pgvector` en Esquema de Drizzle ORM**
  - **Acción:** En `src/lib/db/schema.ts`, añadir la extensión de base de datos `vector` de PostgreSQL (`pgvector`) y preparar una tabla/columna `embedding` (`vector(1536)`) con `organization_id NOT NULL` para la base de conocimiento RAG.
  - **Test (0.2):** `pnpm db:generate && pnpm db:migrate`. Verificar con test de Vitest que se puedan insertar y leer registros con vectores en la base propia (`pnpm test` en verde).

---

## 💬 Fase 1: Adaptador de Canal — Migración de WhatsApp a Telegram
*Portar la conectividad de `telegram_service.py` hacia `src/lib/telegram/` en TypeScript, eliminando la ventana de 24h y plantillas.*

- [x] **Paso 1.1: Cliente HTTP de Telegram Bot API (`src/lib/telegram/client.ts`)**
  - **Acción:** Implementar `sendMessage`, `sendVoice` y `sendChatAction` en TypeScript nativo con `fetch`, consumiendo el `TELEGRAM_BOT_TOKEN` cifrado (`lib/crypto`).
  - **Test (1.1):** Test unitario Vitest (`tests/unit/telegram-client.test.ts`) con mock HTTP validando el formato exacto de payload (`chat_id`, `text`, `parse_mode`).
- [x] **Paso 1.2: Ingesta Idempotente del Webhook de Telegram (`src/server/inbox/telegram-webhook.ts`)**
  - **Acción:** Crear endpoint POST `/api/webhooks/telegram/[token]` que reciba el `Update` de Telegram, extraiga `message.chat.id` y `message.text`, e invoque `ingestInbound()` mapeando a un contacto scoped por organización y verificando unicidad por `telegramMessageId`.
  - **Test (1.2):** Simular por API (`curl`) un webhook entrante de Telegram y validar con aserción en base de datos que la conversación y el mensaje aparezcan en `scoped(organizationId)`.

---

## ⌨️ Fase 2: Menús Interactivos y Callbacks de Telegram
*Portar los teclados (`reply_markup` / `inline_keyboard`) y visualizar las elecciones en la bandeja web en tiempo real.*

- [x] **Paso 2.1: Soporte de `reply_markup` en Salientes (`src/server/inbox/send.ts`)**
  - **Acción:** Ampliar `sendOutbound()` para aceptar opciones de menú (`menu?: { inline_keyboard: [...] }`) y formatearlas para Telegram API. Mantener bloqueo de seguridad si la conversación tiene `isTest: true`.
  - **Test (2.1):** Vitest validando que la estructura `reply_markup` se inyecte correctamente al enviar y que el guardarraíl bloquee el envío si `isTest` está encendido.
- [x] **Paso 2.2: Intercepción y Ruteo de `callback_query` (Clic en menú)**
  - **Acción:** En `telegram-webhook.ts`, capturar eventos `callback_query`, extraer la opción (`callback_data`) elegida por el usuario, registrarla como mensaje de evento y emitir notificación por SSE (`/api/events`).
  - **Test (2.2):** Test de integración donde un clic simulado en el menú (`callback_query`) se registre en la base de datos y aparezca como pastilla/badge en la UI de la bandeja.

---

## 🧠 Fase 3: RAG (Retrieval-Augmented Generation) y Embeddings Vectoriales
*Portar `rag_policy.py`, `rag_context_builder.py` y `embedding_service.py` hacia `src/server/ai/rag/`.*

- [x] **Paso 3.1: Servicio de Generación de Embeddings (`src/server/ai/rag/embeddings.ts`)**
  - **Acción:** Adaptador para generar vectores de 1536 dimensiones sobre fragmentos de texto del `knowledge_base` de cada organización.
  - **Test (3.1):** Test unitario comprobando la fragmentación (*chunking*) y la inserción del vector en la base de datos PostgreSQL local via Drizzle ORM.
- [x] **Paso 3.2: Búsqueda Vectorial por Similitud Coseno (`rag-builder.ts`)**
  - **Acción:** Implementar consulta `scoped()` con operador vectorial (`<=>`) para recuperar el top-K de fragmentos más cercanos a la consulta del usuario.
  - **Test (3.2):** Insertar 10 notas en la base de conocimiento local, buscar por un término semántico afín, y verificar que `buildRagContext()` retorne solo los fragmentos correctos con alta similitud.
- [x] **Paso 3.3: Inyección Dinámica en el Pipeline de IA (`pipeline.ts` & `prompts.ts`)**
  - **Acción:** Modificar `buildSystemPrompt()` para inyectar el contexto recuperado dinámicamente por el RAG cuando la pregunta del cliente lo requiera.
  - **Test (3.3):** Ejecutar una conversación simulada (`ai-mock`) y verificar con aserción de Vitest que el prompt final contenga la evidencia del RAG extraída de la base local.

---

## 🔀 Fase 4: Flujos, Filtros y Variables de Estado (FSB / GADK)
*Portar la lógica de acumulación de variables y transiciones de `root_agent.py` al chasis TypeScript.*

- [x] **Paso 4.1: Persistencia de Variables de Estado en `conversation` (`stateMetadata`)**
  - **Acción:** Añadir en `schema.ts` el campo `stateMetadata: jsonb` dentro de `conversation` para acumular claves como `intencion_actual`, `presupuesto`, o `categoria`.
  - **Test (4.1):** Test Drizzle verificando inserción, lectura y actualización atómica del JSON en la conversación del tenant.
- [x] **Paso 4.2: Herramientas (`actions.ts`) para manipular Variables y Menús**
  - **Acción:** Declarar con Zod en `actions.ts` las nuevas herramientas del LLM/Filtro: `actualizar_variable({ clave, valor })` y `enviar_menu_opciones({ titulo, botones })`. Conectar en `pipeline.ts`.
  - **Test (4.2):** Simular salida del modelo invocando `actualizar_variable` y constatar en la base de datos que `stateMetadata` refleje el cambio de inmediato.

---

## 📦 Fase 5: Módulo E-Commerce (Catálogo, Carrito y Pedidos)
*Portar `product_service.py`, `cart_service.py` y `order_service.py` al dominio multi-tenant.*

- [x] **Paso 5.1: Tablas de Dominio E-Commerce (`src/lib/db/schema.ts`)**
  - **Acción:** Crear tablas `product`, `category`, `cart` y `order` con `organization_id NOT NULL` + índice `org-first` cumpliendo el Principio III.
  - **Test (5.1):** `pnpm db:generate && pnpm db:migrate`. Test de aislamiento multi-tenant demostrando que `scoped()` impide cruce de productos entre organizaciones.
- [x] **Paso 5.2: Herramientas de Ventas en el Cerebro de IA (`actions.ts`)**
  - **Acción:** Definir acciones: `buscar_producto(query)`, `agregar_al_carrito(sku, cantidad)` y `confirmar_pedido()`. Al confirmar pedido, mover automáticamente la tarjeta en el Kanban a la etapa *"Interesado / Pedido"*.
  - **Test (5.2):** Test E2E de simulación de compra: la IA recibe la solicitud del cliente, ejecuta `agregar_al_carrito`, crea la orden en la BD y la tarjeta en el Kanban cambia de columna.

---

## 🧪 Fase 6: Verificación de Fuego con el Laboratorio de IA (`judge.ts`)
*Poner a prueba el nuevo chasis Telegram + RAG + E-Commerce con los 6 arquetipos del Laboratorio.*

- [x] **Paso 6.1: Nuevas Personas Guionadas en `personas.ts`**
  - **Acción:** Agregar al Laboratorio de auto-evaluación a `comprador_telegram_menu` (prueba interactividad de botones) y `cliente_preguntas_rag` (evalúa si el RAG extrae bien los datos sin alucinar).
  - **Test (6.1):** Ejecutar la suite de simulación del Laboratorio en local sin consumir peticiones de red reales (`isTest: true`).
- [x] **Paso 6.2: Veredicto del Juez y Cierre del Gate Técnico**
  - **Acción:** Correr `judgeCase()` del Laboratorio contra los flujos migrados. Verificar que el score general sea **≥85/100** con veredictos en verde.
  - **Test (6.2):** Ejecutar `pnpm typecheck && pnpm lint && pnpm build && pnpm test` con 100% en verde (`PASS`). ¡Implantación finalizada!
