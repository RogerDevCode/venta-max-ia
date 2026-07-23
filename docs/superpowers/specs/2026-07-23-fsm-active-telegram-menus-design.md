# Menús Telegram activos y transiciones FSB

## Objetivo

Impedir que botones de menús Telegram antiguos alteren una conversación y hacer
que los flujos de menú respeten los estados permitidos de la FSB. Cada submenú
ofrecerá siempre las acciones Inicio y Retornar, disponibles tanto como botones
como mediante los textos `i`/`I` y `r`/`R`.

## Estado durable del menú

`conversation.stateMetadata.activeMenu` contendrá:

- `telegramMessageId`: ID numérico del único mensaje Telegram cuyo teclado está
  activo.
- `version`: contador creciente del menú.
- `state`: estado FSB en el que se emitió el menú.
- `allowedActions`: payloads que ese menú puede aceptar.
- `parent`: estado o ámbito anterior, para resolver Retornar.

Al enviar un teclado Telegram, el servidor recibirá su `message_id` y persistirá
el nuevo menú activo. La escritura será una mutación PostgreSQL `jsonb_set`
scoped por organización que reemplaza exclusivamente la clave `activeMenu` del
JSONB almacenado. Nunca reconstruirá `stateMetadata` desde el objeto de
conversación recibido por el emisor, porque ese objeto puede ser anterior a la
transición FSB que originó el mensaje.

La versión se calculará dentro de PostgreSQL a partir del menú persistido, y los
campos `state` y `parent` se tomarán del `current_state` vigente en la misma
sentencia. Así, una respuesta tardía no revierte `current_state`, `active_step`,
identificadores del catálogo ni otras variables acumuladas.

## Ingreso y consumo de callbacks

El webhook conservará el `message_id` del mensaje que originó el callback. Antes
de crear un mensaje entrante o iniciar el turno de IA, validará en una operación
atómica que:

1. el callback procede de `activeMenu.telegramMessageId`;
2. la acción pertenece a `allowedActions`;
3. la transición está permitida desde el estado FSB actual;
4. el menú no fue consumido por otro callback concurrente.

Un callback válido consume el menú antes de ejecutar la acción. Un callback
inválido no llega a la IA y responde con el aviso de menú no activo. Los teclados
anteriores permanecen visibles en Telegram para conservar el historial visual,
pero no pueden ejecutar transiciones ni llegar a la IA.

## Transiciones y navegación

La política central define, por estado, las acciones de menú permitidas y su
estado destino. Las entradas globales `/start`, `/reset` y `/menu` reinician o
abren el menú principal de forma explícita. `catalog:home`, `i` e `I` van al
menú principal. `catalog:return`, `r` y `R` vuelven al ámbito padre almacenado;
si no existe padre, vuelven al menú principal.

Todo submenú Telegram incluirá al final una fila con los botones `↩ Retornar` y
`⌂ Inicio`. Las respuestas sin teclado no cambian por sí solas el menú activo.

## Límites y compatibilidad

- No se añaden servicios externos ni colas.
- Se mantiene el aislamiento multi-tenant y el sandbox `is_test`.
- Los mensajes de texto numéricos continúan siendo compatibles, pero se resuelven
  solamente contra el estado FSB vigente.
- WhatsApp conserva su navegación textual; la persistencia FSB es compartida.

## Pruebas de aceptación

1. Un callback de un menú reemplazado no crea mensaje ni dispara IA.
2. Dos clics simultáneos sobre el mismo botón producen una sola transición.
3. Una acción no permitida por el estado vigente se rechaza.
4. Todo submenú Telegram contiene Retornar e Inicio; `r`/`R` e `i`/`I` tienen el
   mismo resultado que sus botones.
5. Los teclados usados y vencidos permanecen visibles, pero sus callbacks no
   alteran el estado ni ingresan al agente.
6. La matriz real de Telegram acepta las seis opciones del menú principal y
   mantiene coherentes `current_state` y `activeMenu.state`.
7. Categoría → Retornar vuelve al listado; Retornar desde el listado e Inicio
   vuelven al menú principal; un callback de un `message_id` previo se rechaza.

## Evidencia previa al ajuste

La prueba E2E contra `@ventamaxiabot` mostró que las seis acciones principales
fueron rechazadas. Después de `/menu`, el mensaje activo conservó
`current_state=menu:catalog`: el emisor había sobrescrito la transición
`menu:main` con un snapshot anterior. Esta regresión es el caso obligatorio que
debe fallar antes del cambio y pasar después de `jsonb_set`.
