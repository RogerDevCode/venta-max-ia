# Botillería y pedidos naturales Implementation Plan

> **For agentic workers:** Execute each task with its tests before continuing.

**Goal:** Sembrar una botillería demo por tenant y validar pedidos conversacionales, modificaciones, cancelaciones y concurrencia.

**Architecture:** Cada presentación será un SKU existente de `product`; el seed será explícito por organización y usará los servicios de comercio actuales. Los tests ejercitarán catálogo, FSM/IA y rutas de frontend contra una base aislada, sin canales externos reales.

**Tech Stack:** TypeScript, Drizzle, PostgreSQL, Vitest, Next.js y Docker Compose.

## Global Constraints

- No borrar datos de otra organización ni ejecutar seed automático al iniciar.
- Cada presentación tiene SKU, stock y precio independiente.
- Las pruebas no llaman Telegram, WhatsApp, pagos ni delivery externos.
- Un pedido cancelado restaura stock una vez; los pedidos no editables no cambian.

### Task 1: Crear seed seguro de Botillería

**Files:**
- Create: `scripts/seed-botilleria.ts`
- Modify: `package.json`
- Test: `tests/integration/botilleria-seed.test.ts`

- [ ] Escribir pruebas que creen dos organizaciones, siembren solo una y comprueben categorías, SKU únicos, tres presentaciones de una misma marca, stock/precio propios e idempotencia sin `--replace`.
- [ ] Implementar `pnpm seed:botilleria -- --organization <id> [--replace]`; rechazar organización vacía y no borrar catálogo sin `--replace`.
- [ ] Cargar categorías Cervezas, Vinos, Destilados, Bebidas, Energía, Snacks y Promociones; incluir al menos Cristal lata/botella/six-pack, cerveza sin alcohol, vino, pisco, bebida, hielo y snack.
- [ ] Ejecutar `pnpm vitest run tests/integration/botilleria-seed.test.ts` y confirmar que ningún producto de otro tenant cambia.

### Task 2: Sembrar perfil y FAQ editables

**Files:**
- Create: `scripts/seed-botilleria-agent.ts`
- Test: `tests/integration/botilleria-faq.test.ts`

- [ ] Definir FAQ de horario, delivery demo, pagos, retiro, mayores de edad, productos agotados, cambios, promociones, factura y atención humana.
- [ ] Incluir instrucciones del agente para confirmar presentación ambigua y no inventar precios, stock, despacho ni edad.
- [ ] Ejecutar pruebas de FAQ por tenant, reimportación idempotente y ausencia de datos sensibles.

### Task 3: Endurecer comandos de pedido natural

**Files:**
- Modify: `src/server/ai/commands.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `src/server/ecommerce/service.ts`
- Test: `tests/integration/botilleria-natural-orders.test.ts`

- [ ] Escribir casos para agregar, quitar, cambiar cantidad, cambiar presentación, cancelar y crear nuevo pedido.
- [ ] Rechazar cantidades cero, negativas, fraccionarias, excesivas, texto sobredimensionado, SKU inactivo e inventario insuficiente.
- [ ] Cuando una marca tenga varias presentaciones, responder con opciones y no seleccionar una automáticamente.
- [ ] Permitir modificación/cancelación solo en estados editables; hacer la cancelación idempotente y restaurar stock una sola vez.
- [ ] Ejecutar la suite natural contra DB aislada y confirmar que no produce tráfico externo.

### Task 4: Validar frontend de catálogo y pedidos

**Files:**
- Modify: `src/app/(app)/settings/catalog/**`
- Modify: `src/components/**` relacionados con catálogo/pedidos
- Test: `tests/unit/frontend-botilleria-catalog.test.tsx`

- [ ] Mostrar nombre, presentación, precio, SKU y estado de stock sin mezclar variantes.
- [ ] Deshabilitar acción de pedido para productos inactivos o agotados y mostrar un mensaje accionable.
- [ ] Probar navegación, lectura de variantes, modificación y cancelación desde la interfaz sin asumir datos demo globales.

### Task 5: Ejecutar pruebas paranoicas y concurrencia

**Files:**
- Create: `tests/integration/botilleria-commerce-chaos.test.ts`
- Modify: `tests/integration/ecommerce-order-concurrency.test.ts`

- [ ] Ejecutar veinte checkouts simultáneos por el último stock y verificar que no exista stock negativo ni pedidos duplicados.
- [ ] Simular reintentos, líneas duplicadas, repricing, tercer/cuarto pedido, cancelación simultánea y modificación después de cancelar.
- [ ] Validar claves foráneas, `organization_id`, contador de pedido y restauración de stock con queries SQL de integridad.
- [ ] Ejecutar `pnpm typecheck && pnpm test && pnpm test:db && pnpm build`, luego reconstrucción Docker y smoke HTTP.
