# Spec: Ingreso Telegram validado y enrutado por integración

## Objetivo

Antes de crear contactos, mensajes, contexto RAG o turnos de IA, el sistema
debe aceptar exclusivamente actualizaciones Telegram válidas, idempotentes y
asociadas de forma persistente a una organización.

## Comportamiento observable

1. Un webhook con token de ruta no registrado responde `404` y no genera
   efectos.
2. Una actualización malformada, no soportada o de más de 256 KiB responde
   `200 { received: true }`, se registra como rechazada cuando ya se conoce la
   integración y nunca alcanza la ingesta ni la IA.
3. Una actualización válida se asocia a la organización de la integración
   Telegram encontrada por el hash de su token de ruta; `orgId` en querystring
   no se acepta como fuente de tenant.
4. Cada `update_id` se registra en el inbox de la organización. Reintentos con
   el mismo hash son ACK idempotentes; el mismo ID con contenido distinto queda
   marcado como conflicto y no se procesa.
5. Solo una actualización `message` o `callback_query` válida y nueva invoca
   `processTelegramUpdate` para esa organización.

## Restricciones

- Todas las tablas nuevas llevan `organization_id NOT NULL` e índices
  organization-first.
- Los tokens de ruta se almacenan exclusivamente como SHA-256; el valor plano
  se entrega una sola vez al crear la integración.
- No se añaden Redis, colas externas ni nuevos proveedores runtime.
- Las conversaciones `is_test` conservan el bloqueo de salida existente.
- Esta fase no modifica el FSM ni el worker durable; son fases posteriores.

## Fuera de alcance

- UI de configuración de Telegram y almacenamiento de un bot token por
  organización.
- FSM de compra, política RAG y ejecución por worker PostgreSQL.
