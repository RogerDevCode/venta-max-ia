# Menús Telegram vigentes y de un solo uso

## Objetivo

Evitar que opciones de menús anteriores, callbacks repetidos o dobles clics
generen acciones. Los teclados permanecen visibles en Telegram y cualquier
interacción inválida se ignora silenciosamente.

## Modelo durable

Cada teclado emitido crea una instancia única almacenada en
`conversation.stateMetadata.activeMenu`:

- `instanceId`: identificador aleatorio de la instancia.
- `telegramMessageId`: ID del mensaje que contiene el teclado.
- `state`: estado FSB desde el cual se emitió.
- `allowedActions`: payloads autorizados para esa instancia.
- `createdAt`: fecha ISO para diagnóstico.

La persistencia modifica exclusivamente `activeMenu` dentro del JSONB vigente.
Nunca reconstruye `stateMetadata` desde un snapshot anterior de la conversación.
La escritura mantiene el scope por `organization_id`.

## Payload del callback

Los botones propios del sistema incluyen la instancia en `callback_data` sin
superar el límite de 64 bytes de Telegram. El formato será compacto y será
decodificado antes de buscar la acción de negocio. La acción original nunca se
ejecuta directamente desde datos externos sin pasar por el guard.

Los menús dinámicos generados por el agente se someten al mismo registro de
instancia y lista de acciones permitidas.

## Validación y consumo

Antes de crear un mensaje entrante o iniciar IA, el webhook realiza una
actualización condicional PostgreSQL que consume `activeMenu` únicamente cuando
coinciden:

1. `organization_id` y conversación del chat;
2. `instanceId` recibido;
3. `telegramMessageId` de origen;
4. acción incluida en `allowedActions`;
5. estado FSB actual compatible con el estado y la acción del menú.

La eliminación atómica de `activeMenu` constituye el consumo. Dos callbacks
concurrentes sólo pueden producir una fila actualizada: el ganador continúa y
los demás terminan sin efectos.

## Comportamiento silencioso

Telegram recibe `answerCallbackQuery` vacío tanto para callbacks aceptados como
rechazados, para detener el indicador visual. Un rechazo no:

- crea un registro `message`;
- emite eventos SSE;
- ejecuta comandos, E-Commerce o LLM;
- altera la FSB;
- elimina ni modifica el teclado visible.

No se envía texto, alerta ni mensaje indicando que el menú expiró.

## Navegación y comandos

`/start`, `/reset` y `/menu` invalidan cualquier instancia anterior al generar
un teclado nuevo. Inicio y Retornar se validan como cualquier otra acción según
el estado FSB. Las entradas textuales que no proceden de callbacks conservan su
comportamiento actual y no reutilizan una instancia de teclado.

## Concurrencia e idempotencia

La unicidad existente de `callback_query.id` sigue cubriendo reintentos del
mismo update. El consumo condicional cubre IDs diferentes provocados por dobles
clics o interacciones concurrentes. No se añaden Redis, workers externos ni
dependencias runtime.

## Pruebas de aceptación

1. El primer clic del menú vigente produce exactamente una transición.
2. Dos clics concurrentes producen una sola transición y una sola ingesta.
3. Un botón de un menú reemplazado recibe ACK pero no produce efectos.
4. Un callback repetido recibe ACK pero no produce efectos adicionales.
5. Una acción no permitida por el estado FSB se ignora.
6. Un menú de otra organización nunca valida.
7. Los teclados viejos permanecen visibles y no se llama a
   `editMessageReplyMarkup`.
8. El sandbox `is_test` continúa sin realizar llamadas reales a Telegram.
9. Una matriz E2E contra Telegram valida menú principal, submenús, Inicio,
   Retornar, menú antiguo y doble clic.
