# Menús Telegram vigentes, silenciosos y de un solo uso

## Objetivo

Garantizar que únicamente una opción del menú Telegram vigente pueda producir
una acción. Los dobles clics, callbacks repetidos, opciones alteradas y botones
de menús anteriores reciben ACK vacío y terminan sin efectos. Los teclados
permanecen visibles en el historial.

## Garantías

- Como máximo un menú activo por organización y conversación.
- Como máximo un callback aceptado por instancia de menú.
- Ningún callback rechazado crea mensajes, SSE, acciones E-Commerce, turnos LLM
  ni transiciones FSB.
- El estado de menú no se guarda dentro de `conversation.stateMetadata` y nunca
  puede sobrescribir variables de la FSB.
- Una caída después de aceptar el callback no pierde la acción: queda durable en
  PostgreSQL para reanudación.

## Modelo de datos

### `telegram_menu_instance`

Tabla de ciclo de vida de cada teclado:

- `id`: token aleatorio compacto de al menos 96 bits.
- `organization_id NOT NULL`.
- `conversation_id NOT NULL`.
- `chat_id NOT NULL`.
- `telegram_message_id`: nulo mientras el envío está pendiente.
- `generation`: contador monotónico por conversación.
- `fsb_state`: estado requerido al aceptar una opción.
- `allowed_actions`: JSONB ordenado; el callback sólo transporta su índice.
- `status`: `pending`, `delivered`, `active`, `consumed`, `superseded` o
  `failed`.
- `created_at`, `delivered_at`, `activated_at`, `consumed_at`.

Índices:

- único `(organization_id, conversation_id, generation)`;
- único parcial `(organization_id, conversation_id) WHERE status = 'active'`;
- índice org-first `(organization_id, chat_id, telegram_message_id)`.

### `telegram_menu_action`

Outbox durable de callbacks aceptados:

- `id`, `organization_id`, `conversation_id`, `menu_instance_id`;
- `callback_query_id`, `telegram_update_id` y acción resuelta;
- `status`: `pending`, `processing`, `processed` o `failed`;
- contador de intentos, `available_at`, error seguro y timestamps.

Unicidad por `(organization_id, callback_query_id)` y por
`menu_instance_id`, porque una instancia es de un solo uso.

Todas las consultas usan `scoped(organization_id)` y todos los índices de
dominio comienzan por organización.

## Payload Telegram

Formato: `m:<instanceId>:<optionIndex>`.

- Debe ocupar como máximo 64 bytes en UTF-8.
- `instanceId` es impredecible y no contiene datos del tenant.
- `optionIndex` es numérico y se resuelve contra `allowed_actions` almacenado.
- Nunca se ejecuta una acción recibida directamente desde `callback_data`.

Los menús estáticos y los generados por el agente usan el mismo codec.

## Emisión sin carreras

1. Una transacción bloquea la conversación, reserva la siguiente `generation` e
   inserta la instancia `pending` con sus acciones y estado FSB.
2. Se llama a `sendMessage` fuera de la transacción.
3. Si Telegram falla, la instancia pasa a `failed`; el menú activo anterior no
   cambia.
4. Si Telegram responde, se guarda el `telegram_message_id` y la instancia pasa
   a `delivered`.
5. Una transacción promociona la generación entregada más alta a `active` y
   cambia el activo anterior a `superseded`.

Una respuesta tardía de un envío anterior nunca desplaza a una generación más
nueva ya entregada. Un menú visible cuya activación falló permanece inerte por
seguridad.

## Recepción, ACK y consumo

1. El webhook autentica la integración y registra `update_id` idempotente.
2. Obtiene el token Telegram cifrado de esa misma organización.
3. Envía `answerCallbackQuery` vacío lo antes posible con el token tenant. Un
   fallo se registra sin bloquear la respuesta HTTP.
4. Decodifica el payload con validación estricta. Datos desconocidos terminan.
5. Busca la conversación por organización y `chat_id`; callbacks sin
   `message_id` verificable terminan.
6. En una sola transacción PostgreSQL:
   - actualiza `active → consumed` sólo si coinciden instancia, organización,
     conversación, chat, mensaje, estado FSB e índice permitido;
   - inserta exactamente una `telegram_menu_action pending` con la acción
     resuelta.
7. Sólo si `UPDATE ... RETURNING` devuelve una fila se notifica al ejecutor
   in-process. Cero filas significa rechazo silencioso.

No se llama a `editMessageReplyMarkup`, no se modifica el mensaje antiguo y no
se envían alertas ni textos de expiración.

## Ejecución y recuperación

El ejecutor usa un mutex por conversación. Reclama acciones mediante una
actualización condicional `pending → processing`, ejecuta la transición FSB y
marca `processed`. Los fallos recuperables vuelven a `pending` con backoff; los
permanentes pasan a `failed` con error saneado.

Al iniciar Next.js y de forma periódica in-process se recuperan acciones
`pending` y `processing` cuyo lease expiró. No se añaden Redis ni workers
externos. Las tareas en segundo plano usan `.catch(logError)` o
`Promise.allSettled()`.

La garantía es aceptación única y ejecución reanudable. Las operaciones de
negocio llamadas por la acción conservan sus propias claves idempotentes.

## Receipt del webhook

`telegram_webhook_receipt` amplía su estado a `received`, `processing`,
`processed`, `retryable_failed` y `conflict`. `processed_at` se escribe al
terminar. Un receipt abandonado o `retryable_failed` puede ser reclamado; un
duplicado ya procesado sólo recibe ACK. Esto evita que una caída posterior al
registro descarte para siempre el reintento de Telegram.

## Política FSB

Una tabla tipada define acciones permitidas por estado. El guard compara el
estado persistido actual, no un snapshot capturado al enviar. `/start`, `/reset`
y `/menu` crean generaciones nuevas. Inicio y Retornar son acciones normales y
se validan contra el estado y la instancia vigentes.

Para chats grupales, la primera versión rechaza callbacks hasta definir una
política de identidad explícita. El alcance inicial son conversaciones privadas,
donde `from.id`, `chat.id` y el contacto esperado deben coincidir.

## Retención

Las instancias `consumed`, `superseded` y `failed`, las acciones procesadas y los
receipts antiguos se purgan con una tarea PostgreSQL/in-process configurable.
La retención inicial será de 30 días. Nunca se purgan filas `active`, `pending`
ni `processing` vigentes.

## Despliegue seguro

1. Migrar tablas e índices sin activar el guard.
2. Activar modo sombra: crear instancias y registrar qué callbacks serían
   aceptados o rechazados, sin cambiar el comportamiento actual.
3. Ejecutar pruebas unitarias, integración PostgreSQL y matriz Telegram real.
4. Comparar métricas de sombra; cero falsos rechazos en flujos válidos.
5. Activar enforcement por variable de entorno reversible.
6. Mantener el checkpoint Git previo como retorno operativo.

## Pruebas de aceptación

### Codec y seguridad

- Payload máximo de 64 bytes, índices fuera de rango y tokens manipulados.
- Cruce de organización, conversación, chat, usuario y `message_id`.
- Menú dinámico del LLM con payload hostil tratado sólo como dato almacenado.

### Concurrencia PostgreSQL real

- 20 callbacks simultáneos sobre una instancia: una acción y un consumo.
- Dos acciones diferentes pulsadas simultáneamente: sólo una gana.
- Dos menús enviados con respuestas Telegram invertidas: queda activo el de
  mayor generación entregada.
- Dos instancias concurrentes no violan el índice de activo único.

### Fallos inducidos

- Caída antes y después de `sendMessage`, entrega, activación, consumo, inserción
  de action y transición FSB.
- Reinicio de Next.js con acciones `pending` y leases `processing` vencidos.
- Telegram lento, 429, 500, token tenant inválido y PostgreSQL transitorio.

### Comportamiento

- Menú anterior, callback repetido y doble clic: ACK vacío y cero efectos.
- Primer clic válido: una sola transición.
- Los teclados viejos siguen visibles.
- Sandbox `is_test`: ninguna llamada Telegram real.

### E2E real

Desde un cliente Telegram real: menú principal, cada submenú, Inicio, Retornar,
doble clic y clic sobre un menú reemplazado. La inyección de webhook complementa
pero no sustituye esta prueba porque la Bot API no genera pulsaciones de usuario.
