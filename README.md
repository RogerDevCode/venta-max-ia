# VentaMaxIA

**CRM de Inteligencia Artificial Omnicanal (Telegram & WhatsApp) con Motor RAG (`pgvector`), E-Commerce y Laboratorio de Auto-evaluación LLM.**

VentaMaxIA es una plataforma empresarial, soberana y self-hosted diseñada para gestionar ventas, atención al cliente y automatización de flujos conversacionales mediante Agentes de IA autónomos sobre **Telegram** y **WhatsApp**. Todo corre de forma nativa en tu propia infraestructura con un estricto aislamiento **Multi-Tenant (`organization_id`)**.

---

## 🚀 Características Principales

### 🌐 Omnicanalidad Sobresaliente: Telegram Bot API & WhatsApp Cloud API
- **Telegram Bot API:** Ingesta multi-tenant con rutas de webhook opacas e idempotentes (`/api/webhooks/telegram/[webhookToken]`). Soporte para teclados interactivos (`inline_keyboard`), menús y procesamiento de selecciones en tiempo real.
- **WhatsApp Cloud API:** Bandeja en tiempo real con ventana de 24 horas controlada, plantillas aprobadas por Meta y handoff fluido a agente humano con un solo clic.
- **Idempotencia y Seguridad:** Cada webhook verifica unicidad (`update_id` / `waMessageId` UNIQUE) para evitar reprocesamientos ante reintentos de red. Tokens cifrados en reposo (`AES-256-GCM`).

### 🧠 Motor RAG & Búsqueda Vectorial (`pgvector`)
- Ingesta y consulta dinámica del conocimiento del negocio respaldada por **PostgreSQL 18** y **`pgvector`**.
- Embeddings generados con modelos avanzados (Gemini, OpenAI, Nvidia, DeepSeek u OpenRouter) para inyectar únicamente el contexto exacto y relevante en cada respuesta del Agente.

### ⚙️ Máquina de Estados Duradera (FSM / GADK) & Acciones de E-Commerce
- **Flujos Deterministas:** Gestión de variables y transiciones de sesión acumuladas de forma estructurada (`stateMetadata`).
- **Catálogo y Carrito Inteligente:** Acciones autónomas del Agente (`actions.ts`) para consultar inventario por SKU, armar carritos de compra y generar pedidos (`order`) vinculados al pipeline de ventas.

### 🧪 Laboratorio de Auto-evaluación con Juez LLM
- Un entorno de pruebas automatizado (*Sandbox*) donde arquetipos de clientes simulados (el comprador decidido, el preguntón de precios, el cliente molesto, etc.) conversan contra tu Agente.
- Un **Juez LLM** independiente audita cada conversación, otorga un puntaje (Score 0-100), detecta alucinaciones o huecos en la base de conocimiento y propone correcciones aplicables con un clic.
- **Cero Riesgo:** Las pruebas en el Laboratorio jamás envían peticiones reales a Telegram ni a WhatsApp (`isTest: true`).

### 💬 Bandeja Web en Tiempo Real (SSE) & Pipeline Kanban
- **Bandeja de 3 columnas:** Sincronización ultrarrápida mediante Server-Sent Events (SSE) en ≤2 segundos.
- **Kanban de Ventas:** Visualización clara del ciclo de vida del lead (`Nuevo` → `En conversación` → `Interesado` → `Cliente` → `Perdido`). El Agente mueve las tarjetas automáticamente al detectar intención de compra o generar un pedido.

---

## 🛠️ Stack Tecnológico
- **Frontend & API:** Next.js 15 (App Router) + React 19 + TypeScript Estricto.
- **Base de Datos & ORM:** PostgreSQL 18 (con soporte nativo de `pgvector`) + Drizzle ORM.
- **Autenticación & Seguridad:** Better Auth + Cifrado en reposo `AES-256-GCM`.
- **Tiempo Real:** Server-Sent Events (SSE) sin sobrecarga de WebSockets externos.
- **Pruebas y Calidad:** Vitest (140+ pruebas unitarias) & Playwright (E2E).

---

## 📦 Arquitectura Soberana y Despliegue Local

VentaMaxIA opera con su propia infraestructura autocontenida usando Docker. No requiere Redis ni S3 externos.

### Requisitos Previos
- Node.js >= 20 y `pnpm`
- Docker & Docker Compose

### Levantando el Entorno de Desarrollo
```bash
# 1. Clonar el repositorio
git clone git@github.com:RogerDevCode/venta-max-ia.git && cd venta-max-ia

# 2. Configurar variables de entorno
cp .env.example .env

# 3. Levantar PostgreSQL 18 con pgvector
docker compose -f docker-compose.dev.yml up -d postgres

# 4. Instalar dependencias y aplicar migraciones
pnpm install
pnpm db:migrate

# 5. Iniciar el servidor de desarrollo
pnpm dev
```

La aplicación estará disponible en `http://localhost:3000`.

---

## 🧪 Pruebas y Verificación del Sistema

El proyecto sigue prácticas estrictas de TDD/SDD. Para ejecutar la suite completa de pruebas:

```bash
# Ejecutar todas las pruebas unitarias (Vitest)
pnpm test

# Verificación de tipos en TypeScript
pnpm typecheck

# Linter
pnpm lint
```

---

## 📄 Licencia
[MIT](LICENSE) — Proyecto self-hosted y open source.
Repositorio Oficial: [RogerDevCode/venta-max-ia](https://github.com/RogerDevCode/venta-max-ia)

