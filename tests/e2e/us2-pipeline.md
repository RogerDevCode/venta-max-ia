# Guion E2E — US2: Contactos y pipeline kanban

> Conducido con Playwright (MCP) contra `pnpm dev` con el entorno de pruebas
> interno. Continúa el estado del guion de US1 (contactos ya creados por
> mensajes entrantes).

## Auto-registro (FR-010)

1. Abrir `/contacts`.
   ✅ Los remitentes de US1 ("Cliente E2E", "Cliente Frio") existen como
   contactos con su nombre de perfil y teléfono.
2. Abrir `/pipeline`.
   ✅ Cada contacto tiene su tarjeta en la etapa "Nuevo" con última actividad.

## Kanban (FR-011/FR-012)

3. Arrastrar la tarjeta "Cliente E2E" de "Nuevo" a "En conversación".
   ✅ La tarjeta cambia de columna.
4. Recargar la página.
   ✅ La tarjeta sigue en "En conversación" (persistencia).
5. La tarjeta muestra contacto + última actividad + enlace que abre su
   conversación en la bandeja (`/inbox?contact=...`).

## Gestión de etapas (FR-011)

6. "Gestionar etapas": renombrar una etapa, agregar "Cotizado", verificar que
   las anclas ganado/perdido no se pueden eliminar.
7. Eliminar "Cotizado" (vacía) → desaparece.

## Contactos (FR-013)

8. Buscar por "Frio" → filtra; editar notas → persiste; archivar → desaparece
   de la lista (visible con "Ver archivados"); desarchivar → vuelve.
