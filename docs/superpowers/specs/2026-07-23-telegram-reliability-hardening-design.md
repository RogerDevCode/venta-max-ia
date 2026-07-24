# Diseño de adecuación Telegram-only y endurecimiento de fiabilidad

**Fecha:** 2026-07-23  
**Estado:** Aprobado para planificación  
**Base auditada:** `9c7d2a8`  
**Producto:** Venta Max IA, edición exclusivamente Telegram

## 1. Objetivo

Corregir los issues encontrados por el red team sin introducir Redis, colas externas ni servicios administrados. PostgreSQL será la fuente de verdad para idempotencia, serialización por conversación, recuperación, outbox y restricciones de comercio. La interfaz y el runtime dejarán de ofrecer WhatsApp; Configuración conservará únicamente el texto informativo `WhatsApp (deshabilitado)`.

## 2. Decisiones aprobadas

1. Esta edición admite exclusivamente Telegram.
2. Solo se procesan chats privados. `group`, `supergroup` y `channel` se ignoran sin efectos de dominio.
3. Los números escritos siguen admitidos.
4. Cada entrada numérica captura la revisión FSM vigente al ingresar. Solo una entrada puede consumir esa revisión; las restantes se registran como ignoradas silenciosamente.
5. El repricing es automático. El usuario recibe el precio anterior, el nuevo y la diferencia total.
6. La unión del tercer y cuarto pedido recalcula precios y notifica los cambios.
7. Todo cambio estructural de BD se entrega como migración Drizzle versionada, con preflight, reconciliación y verificación posterior.
8. No se envían mensajes reales desde sesiones `is_test`.

## 3. Alternativa seleccionada

Se adopta una bandeja durable PostgreSQL y un FSM revisionado. Los parches locales fueron descartados porque no cierran las ventanas entre receipt, ingesta, transición y envío. Event sourcing completo fue descartado por ampliar innecesariamente el alcance.

La solución queda dividida en unidades aisladas:

- **Ingreso Telegram durable:** autentica, valida, persiste y entrega trabajo recuperable.
- **Procesador serial por conversación:** reclama eventos con lease y aplica una única transición.
- **FSM revisionado:** decide usando `(current_state, active_step, revision, input)`.
- **Outbox Telegram:** entrega respuestas y activa menús solo después de confirmación de Telegram.
- **Comercio transaccional:** normaliza artículos, aplica límites agregados, repricing, stock y pedidos.
- **Migrador verificable:** reconcilia datos existentes, crea constraints y prueba que quedaron activos.

## 4. Modelo de datos objetivo

### 4.1 Integración y receipts Telegram

`telegram_integration` conservará una integración por organización y añadirá unicidad global sobre `bot_id`. Un bot no podrá ser reclamado por dos tenants.

La integración almacenará además `webhook_header_secret_hash`. El secreto del segmento URL y el secreto enviado en `X-Telegram-Bot-Api-Secret-Token` serán valores aleatorios distintos; ambos se guardan solo como SHA-256. La resolución del tenant usa el token URL y luego exige comparación constante del header contra su hash.

`telegram_webhook_receipt` será la cola durable de updates:

- unicidad `(integration_id, update_id)`;
- índice org-first `(organization_id, status, available_at)`;
- `payload jsonb NOT NULL`;
- estados `received | processing | processed | ignored | retry | failed`;
- `attempts`, `available_at`, `lease_expires_at`, `last_error`, `processed_at`;
- razón de descarte `ignored_reason` para `non_private`, `stale_revision`, `duplicate` o `unsupported`.

El endpoint solo considera aceptado un update después de persistir el payload. El trabajo puede continuar mediante `after()`, pero un drenador periódico reclama también receipts abandonados o con lease vencido. La recuperación no tendrá límite fijo de 50 tenants: usará paginación estable por organización y `available_at`.

### 4.2 Identidad externa de mensajes

La columna heredada `message.wa_message_id` se reemplazará por:

- `channel`, restringido a `telegram` en esta edición;
- `integration_id` nullable únicamente para mensajes históricos anteriores a la migración;
- `external_message_id`;
- unicidad parcial `(integration_id, external_message_id)` cuando ambos valores existan.

Los IDs se almacenarán sin prefijos ambiguos. Para entradas serán `message:<chatId>:<messageId>` y para callbacks `callback:<callbackQueryId>`. La organización seguirá presente e indexada primero en todas las consultas.

### 4.3 FSM revisionado

`conversation` añadirá `fsm_revision bigint NOT NULL DEFAULT 0`.

Cada receipt soportado captura `expected_fsm_revision` y `expected_fsm_state_key` dentro de la misma transacción que lo encola. El procesador bloquea la conversación `FOR UPDATE` y aplica esta regla:

1. Si la revisión esperada difiere de la actual, marca `ignored/stale_revision` y no responde.
2. Si estado y paso no aceptan la entrada, marca `ignored/invalid_transition` y no responde.
3. Si la transición es válida, actualiza estado y aumenta `fsm_revision` mediante compare-and-swap.
4. La misma revisión no puede ser consumida dos veces.

Para texto numérico, dos entradas de una ráfaga capturan la misma revisión. La primera transición válida la incrementa; las demás quedan obsoletas. `/start` y `/reset` son comandos de recuperación explícitos y crean una revisión nueva. `I` y `R` también requieren la revisión capturada; no atraviesan un menú posterior.

La cantidad utilizará la misma tabla exacta y exigirá `cart:awaiting_quantity/awaiting_product_quantity`. No existirá un atajo que valide solo `current_state`.

### 4.4 Menús y callbacks

`telegram_menu_instance` conservará generación, estado FSM y acciones permitidas; añadirá la revisión FSM exacta. La aceptación de callback comprobará organización, integración, chat privado, usuario, message ID, estado, paso, revisión, generación, status activo y acción permitida.

El callback se consume y genera trabajo durable, pero no se marca procesado hasta que el efecto determinista finalice. `answerCallbackQuery` tendrá timeout corto y no bloqueará la ejecución del efecto. Un fallo temporal producirá retry; un error terminal quedará visible como `failed` con evidencia.

### 4.5 Outbox Telegram

Se añadirá `telegram_outbox` con:

- `organization_id`, `integration_id`, `conversation_id`;
- payload, texto, markup y revisión FSM asociada;
- estados `pending | sending | delivered | retry | failed | superseded`;
- intentos, lease, disponibilidad y error;
- clave idempotente de dominio.

La transición y el outbox se escriben en la misma transacción. Un menú nuevo no invalida el menú visible anterior hasta que Telegram confirme `sendMessage`. Después de recibir `message_id`, una transacción activa el nuevo menú y marca los anteriores como `superseded`. Si falla el envío, el estado visible anterior permanece coherente y el outbox reintenta.

El cliente Telegram usará timeout, clasificación retryable y backoff con jitter. El token siempre provendrá de `telegram_integration`; `sendChatAction` no usará el bot administrativo. El cambio global de `dns.lookup` se elimina y cualquier preferencia IPv4 se limita al transporte Telegram.

## 5. Comercio fiable

### 5.1 Un solo carrito activo

La BD impondrá un índice único parcial `(organization_id, conversation_id) WHERE status = 'active'`.

Antes de crearlo, una reconciliación transaccional detectará duplicados, bloqueará sus conversaciones, agrupará artículos por `productId`, conservará como activo el carrito más reciente y marcará los restantes `abandoned`. Si la suma resultante viola stock o límite tenant, la migración se detendrá con un reporte explícito; no truncará cantidades ni perderá artículos silenciosamente.

### 5.2 Normalización e invariantes

Toda entrada de carrito o pedido se normaliza por `productId` antes de validar. Las cantidades repetidas se suman y luego se comprueban:

- entero seguro mayor que cero;
- máximo configurable del tenant sobre el total agregado;
- stock efectivo;
- producto activo del mismo tenant;
- total monetario dentro del rango admitido.

Los carritos legacy que solo tengan SKU serán migrados a `productId` mediante una asociación tenant-scoped. La ejecución normal de cliente no aceptará SKU.

### 5.3 Numeración de pedidos

`commerce_order_counter` tendrá `organization_id` como PK y `next_value bigint`. La confirmación bloqueará/incrementará el contador dentro de la misma transacción del pedido. El número visible será `ORD-` más un valor decimal de seis posiciones como mínimo; al superar seis dígitos seguirá creciendo sin colisión.

No se utilizará `Math.random`. La unicidad `(organization_id, order_number)` continuará como defensa adicional.

### 5.4 Repricing automático y notificación

En checkout y unión 3.º+4.º se bloquean los productos y se compara `unitPrice` almacenado con el precio actual. El pedido se calcula con precio actual. El resultado de dominio devuelve una lista `priceChanges` con `productId`, nombre, presentación, precio anterior, precio nuevo, cantidad y diferencia.

La confirmación del pedido y el mensaje de notificación se escriben junto al outbox. El texto muestra cada cambio y el total definitivo. En la unión, el pedido firme anterior y el carrito se consolidan por `productId`, se recalculan al precio vigente y se informa expresamente que el pedido combinado reemplaza al tercer pedido anterior.

## 6. Telegram-only y retiro de WhatsApp

Se eliminarán del runtime:

- `/api/webhooks/wa/*`;
- `/api/settings/whatsapp` y su endpoint de test;
- `/api/templates/*` y envío de plantillas;
- mocks de Graph/WhatsApp;
- cliente Meta, credenciales, templates y eventos WhatsApp;
- componentes de conexión, sincronización y envío de plantillas;
- variables de entorno Meta/WhatsApp;
- lógica de ventana de 24 horas y errores asociados.

La página `/settings/whatsapp` quedará estática y sin formularios, credenciales ni peticiones, mostrando únicamente `WhatsApp (deshabilitado)`. El acceso de navegación conservará ese rótulo. La sección Plantillas desaparece de Configuración y del composer.

La migración de retiro hará backup previo verificable de tablas WhatsApp, exigirá `CONFIRM_DROP_WHATSAPP_DATA=YES` y después eliminará `meta_credentials`, `template` y columnas exclusivamente WhatsApp. Los datos generales de contactos, conversaciones y mensajes no se eliminan. Los nombres genéricos de mensaje se migran antes del drop para conservar historial Telegram.

## 7. Autorización y aislamiento

- Solo `owner` puede conectar, reemplazar o desconectar un bot.
- La ruta pública deriva organización exclusivamente del secreto persistido y valida además `X-Telegram-Bot-Api-Secret-Token`.
- `setWebhook` envía el secret header y la configuración se compensa si falla cualquier paso.
- Todas las consultas de dominio incluyen `organization_id` mediante `scoped()`.
- `bot_id` es único globalmente.
- Contactos Telegram se identifican por organización y chat privado; no existe autodetección por parecido con un teléfono.
- Sesiones `is_test` persisten mensajes simulados y nunca crean outbox real, `sendChatAction` ni llamadas a Telegram.

## 8. Política de errores

- **Ignorados silenciosos:** chat no privado, revisión obsoleta, opción ajena al estado, callback viejo, doble clic, número fuera de rango.
- **Retry automático:** timeout, conexión, HTTP 429 y 5xx, lease vencido, caída después de persistencia.
- **Fallo terminal visible a operadores:** token inválido, payload de dominio imposible, datos legacy que impiden migración.
- **Mensaje al cliente:** errores corregibles de cantidad, stock, límite tenant o repricing confirmado.

Ninguna excepción de infraestructura convierte un receipt en `processed`. Ningún efecto externo se ejecuta dentro de una transacción SQL abierta.

## 9. Estrategia de migración efectiva

Las migraciones se ejecutarán con `scripts/migrate.mjs` y quedarán registradas en `drizzle/meta/_journal.json`.

Orden obligatorio:

1. backup de tablas y conteos previos;
2. columnas nuevas nullable y tablas durables;
3. backfill tenant-scoped;
4. preflight de duplicados, IDs y carritos;
5. reconciliación de datos;
6. constraints e índices nuevos;
7. cambio de aplicación para leer/escribir el esquema nuevo;
8. verificación de producción local;
9. retiro de columnas y tablas obsoletas;
10. `ANALYZE` de tablas afectadas.

Cada migración incluye consultas postcondición sobre `pg_constraint`, `pg_indexes`, nulabilidad, conteos y duplicados. El pipeline debe probar tanto una BD vacía como una copia del esquema actual con fixtures legacy. Un arranque se considera fallido si la migración no termina; no se iniciará la aplicación contra un esquema parcial.

## 10. Verificación QA y red team

### Gates obligatorios

1. **Migración:** aplicar desde cero y desde `0010`; repetir sin cambios; comprobar constraints reales en PostgreSQL.
2. **Ingreso:** simular crash antes, durante y después de procesar; cada update termina una sola vez en `processed`, `ignored` o `failed`.
3. **Ráfagas:** mensajes `1,1`, `3,3`, `I,R`, callbacks dobles y combinaciones mixtas; solo una transición consume la revisión.
4. **Transporte:** timeout, 429, 500, token inválido, respuesta perdida y entrega invertida.
5. **Comercio:** líneas duplicadas, stock cambiante, repricing, dos carritos legacy, colisión de contador, tercer+cuarto pedido y veinte solicitudes concurrentes.
6. **Multi-tenant:** dos bots, mismo chat/message ID, reemplazo de bot y aislamiento de productos/pedidos.
7. **Sandbox:** cero requests Telegram desde `is_test` incluyendo typing, ACK y outbox.
8. **Telegram-only:** todas las rutas WhatsApp retiradas; Configuración solo muestra `WhatsApp (deshabilitado)`.

### Criterio de salida

- 100% de pruebas P0 y P1 en verde;
- cero issues críticos o altos abiertos;
- migraciones verificadas sobre BD vacía y BD con datos legacy;
- suite completa, typecheck, lint y build en verde;
- API real `getMe` y `getWebhookInfo` sin enviar mensajes;
- red team FSM, comercio y API aprueban el plan antes de implantar y repiten la auditoría después de implantar.

## 11. Trazabilidad de issues

| Issue red team | Adecuación |
|---|---|
| Updates perdidos | Receipt durable, estados, leases y drenador paginado |
| Números viejos/ráfagas | `fsm_revision` capturada y compare-and-swap |
| Callback procesado antes del efecto | Trabajo durable y estado final posterior al efecto |
| Menú muerto tras error de envío | Outbox y activación posterior a entrega |
| Cantidad sin `active_step` | Resolver único FSM exacto |
| Colisión multi-tenant de mensajes | Unicidad por integración |
| Dos tenants con el mismo bot | `UNIQUE(bot_id)` |
| Webhook no atómico | Compensación y secret header |
| Timeout Telegram | Abort, retry y backoff |
| Carritos activos duplicados | Reconciliación e índice parcial único |
| Límite evadido por líneas duplicadas | Normalización agregada por `productId` |
| Colisión de orden | Contador transaccional tenant-scoped |
| Repricing silencioso | Repricing automático más outbox informativo |
| Grupos con botones inválidos | Política private-only al ingreso |
| Dependencia WhatsApp | Retiro completo y página estática deshabilitada |
