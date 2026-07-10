# Guion E2E — US1: Bandeja de WhatsApp en tiempo real

> Conducido con Playwright (MCP) contra `pnpm dev` con el entorno de pruebas
> interno activo (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock).
> Requiere: usuario registrado y número conectado (mock, phoneNumberId `123456789`).

## Preparación

1. `DELETE /api/dev/wa-mock/outbox` — limpiar el harness.
2. Login en `/login` y abrir `/inbox`.

## Camino feliz

3. **Entrante en tiempo real (SC-001)**: `POST /api/dev/wa-mock/inbound`
   `{ phoneNumberId, from: "5215522223333", name: "Cliente E2E", text: "Hola, ¿tienen taladros?" }`.
   ✅ La conversación aparece en la lista en ≤2 s SIN recargar, con nombre y preview.
4. **Abrir el hilo**: clic en la conversación.
   ✅ El mensaje entrante se ve en burbuja; el contador de no-leídos se limpia.
5. **Responder**: escribir "¡Sí! ¿Qué modelo buscas?" y enviar.
   ✅ El mensaje aparece en el hilo (dirección out, reloj de pending).
   ✅ `GET /api/dev/wa-mock/outbox` contiene el envío con `to: 525522223333`
   (normalización MX) y el texto.
6. **Estados**: `POST /api/dev/wa-mock/status` con `delivered` y luego `read`.
   ✅ Los ticks progresan a ✓✓ y a ✓✓ azul sin recargar.
7. **Avatares**: la conversación muestra iniciales "CE" con color estable.

## Caminos infelices

8. **Dedup (SC-004)**: enviar dos veces el mismo `waMessageId` `wamid.dedup.1`.
   ✅ El hilo muestra UNA sola vez el mensaje.
9. **Ventana cerrada (SC-005)**: inbound de contacto nuevo con
   `timestamp` de hace 25 horas → abrir su conversación.
   ✅ El composer está bloqueado con la explicación de la ventana y ofrece
   plantillas (estado vacío si no hay aprobadas).
   ✅ `POST /api/conversations/:id/messages` responde 409 `window_closed`.
10. **Webhook segmento incorrecto**: `POST /api/webhooks/wa/token-falso` → 404
    y no aparece nada nuevo en la bandeja.
11. **Reconexión**: (cubierto por diseño: EventSource reconecta y el cliente
    refetch-ea con el evento `open`; verificación funcional en el checkpoint
    de compose).
