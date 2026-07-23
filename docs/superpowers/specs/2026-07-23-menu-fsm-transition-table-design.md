# Tabla FSM única para menús de Telegram

## Objetivo

Centralizar la navegación de Telegram en una tabla determinista
`(current_state, active_step, input) -> transición`, conservando selección
numérica contextual por menú y rechazando silenciosamente cualquier entrada que
no pertenezca al estado activo.

## Decisiones

- Se implementará una FSM tipada propia, sin añadir dependencias de runtime.
- Solamente el estado y paso activos pueden resolver una entrada.
- No existirá fallback numérico global.
- Cada menú persistirá sus acciones numéricas visibles, en el mismo orden en que
  fueron mostradas al usuario.
- Números fuera de rango, callbacks antiguos, dobles clics y acciones no
  permitidas no producen transición ni mensaje.
- `I`/`i` siempre representa Inicio mientras la IA controle la conversación.
- `R`/`r` representa Retornar y usa una pila real de navegación.
- Los botones y el texto numérico se resuelven a la misma acción semántica.

## Arquitectura

### Resolver puro

`src/server/ai/menu-fsm.ts` será la única fuente de estados, eventos y
transiciones. Expondrá tipos para el estado compuesto, eventos normalizados y
decisiones, además de una tabla inmutable y un resolver puro.

El estado compuesto será la concatenación de `current_state` y `active_step`.
La tabla definirá los eventos permitidos en cada estado. Un evento inexistente
retornará `ignore`, sin buscar reglas de otro estado.

Los eventos serán:

- `home`;
- `back`;
- `number`, con entero positivo;
- `action`, con la acción semántica proveniente de un callback vigente;
- `quantity`, reservado para el estado de cantidad.

### Contexto persistido

`conversation.stateMetadata` conservará:

- `current_state`;
- `active_step`;
- `menu_scope`;
- `menu_stack`, como scopes suficientes para volver a renderizar el menú
  anterior;
- `numeric_options`, como lista ordenada de acciones semánticas exactas;
- contexto específico, como categoría, producto o pedido seleccionado.

Los scopes que requieren identidad incorporarán un ID interno, por ejemplo
`catalog:category:<id>` y `order:detail:<id>`. El SKU nunca se mostrará ni se
usará como identidad del flujo.

### Integración con Telegram

Las instancias de menú persistirán una clave FSB compuesta por
`current_state + active_step`. La aceptación de callbacks exigirá:

- tenant, conversación, chat y mensaje correctos;
- instancia `active`;
- acción incluida en `allowedActions`;
- coincidencia exacta de estado y paso;
- consumo atómico de la instancia.

Las instancias anteriores y los clics simultáneos seguirán siendo ignorados
silenciosamente.

## Tabla funcional

| Estado compuesto | Números del estado | Destino |
|---|---|---|
| `menu:main / main_menu` | seis opciones principales | submenú elegido |
| `menu:catalog / viewing_catalog` | categorías visibles | `menu:catalog / viewing_category` |
| `menu:catalog / viewing_category` | productos visibles | `cart:awaiting_quantity / awaiting_product_quantity` |
| `menu:promos / viewing_promos` | productos promocionados visibles | `cart:awaiting_quantity / awaiting_product_quantity` |
| `menu:recommended / viewing_recommended` | productos recomendados visibles | `cart:awaiting_quantity / awaiting_product_quantity` |
| `cart:awaiting_quantity / awaiting_product_quantity` | cantidad entera válida | `menu:cart / viewing_cart` |
| `menu:cart / viewing_cart` | acciones visibles del carrito | estado de la acción elegida |
| `menu:orders / viewing_orders` | pedidos activos visibles | `menu:order_detail / viewing_order_detail` |
| `menu:order_detail / viewing_order_detail` | actualizar, editar o cancelar | detalle actualizado, carrito o pedidos |
| `handoff:humano / awaiting_human` | ninguna | sin transición de IA |

`home` conduce al menú principal desde cualquier estado controlado por la IA.
`back` consume el scope actual y renderiza el anterior. En el menú principal es
una transición prohibida y se ignora.

## Productos promocionados y recomendados

Promociones y Recomendados mostrarán productos enumerados y botones. Cada
posición se persistirá como `catalog:product:<productId>`. Elegir el número o el
botón ejecutará exactamente el mismo flujo de cantidad y carrito que el
catálogo. Si la consulta no devuelve productos, `numeric_options` será vacío.

## Pedidos

### Listado y detalle

`Mis Pedidos` mostrará únicamente pedidos activos, ordenados del más reciente
al más antiguo. Son activos los estados `pending`, `confirmed` y `processing`.

- Con cero pedidos se muestra el estado vacío con Inicio y Retornar.
- Con un pedido se abre directamente su menú de detalle.
- Con dos o tres pedidos se muestran enumerados y seleccionables.

El detalle muestra artículos, cantidades, total y estado, seguido de:

1. Ver estado actualizado.
2. Editar pedido.
3. Cancelar pedido.

Retornar e Inicio se mantienen como controles no numéricos `R` e `I` y como
botones.

### Máximo de pedidos activos

Cada cliente dentro de un tenant puede mantener como máximo tres pedidos
activos, incluso si posee más de una conversación. `order` incorporará
`contact_id NOT NULL`, con backfill desde la conversación de los pedidos
existentes. La confirmación de compra bloqueará el contacto, contará pedidos
`pending`, `confirmed` o `processing` con `organization_id` y `contact_id`, y
rechazará el cuarto antes de descontar stock o convertir el carrito.

El esquema añadirá un índice compuesto org-first sobre
`(organization_id, contact_id, status)`.

### Editar pedido como carrito

La edición reabrirá el pedido como carrito y se ejecutará dentro de una
transacción:

1. Bloquear conversación y pedido.
2. Verificar tenant, conversación y estado activo.
3. Rechazar la edición si existe un carrito activo con artículos, evitando
   pérdida o mezcla silenciosa de datos.
4. Bloquear los productos del pedido en orden estable por ID.
5. Devolver al stock las unidades descontadas por el pedido original.
6. Crear un carrito activo nuevo con los mismos artículos y referencia al
   pedido de origen.
7. Marcar el pedido original como `cancelled`.
8. Abrir el catálogo para permitir agregar más productos.

El carrito no reserva stock. Al volver a confirmar se validarán nuevamente
existencia, límite tenant y stock disponible.

La operación será idempotente: dos ediciones simultáneas solo podrán crear
un carrito y restaurar el stock una vez.

### Cancelar pedido

Cancelar un pedido activo bloqueará pedido y productos, restaurará el stock una
sola vez, marcará el pedido como `cancelled` y regresará a `Mis Pedidos`. Un
pedido ya finalizado o cancelado no podrá cancelarse ni editarse.

## Errores y seguridad

- Los IDs siempre se validan con `organization_id` y `scoped()`.
- Las transacciones SQL y bloqueos se ejecutan en serie.
- Los efectos independientes posteriores al commit usan promesas controladas.
- Una acción manipulada, fuera de rango o incompatible con el estado se ignora.
- Los errores de negocio que sí provienen de una acción vigente —límite de tres
  pedidos, carrito activo, cambio de stock— se comunican al usuario y conservan
  un estado navegable.
- Las sesiones `is_test: true` nunca llaman a Telegram real.

## Pruebas

### Unidad

- Cobertura completa de la tabla por estado, paso y evento.
- Aserción de que cada número resuelve solamente `numeric_options` del estado
  actual.
- Números fuera de rango y acciones pertenecientes a otro menú retornan
  `ignore`.
- Promociones y Recomendados mantienen la relación visual
  número-producto-ID.
- Inicio y Retornar actualizan correctamente la pila.

### Integración con PostgreSQL

- El cuarto pedido activo del mismo cliente y tenant es rechazado.
- Pedidos completados o cancelados no cuentan para el límite.
- Clientes y tenants diferentes tienen límites independientes.
- Dos confirmaciones concurrentes no superan el máximo de tres.
- Dos ediciones o cancelaciones concurrentes restauran stock una sola vez.
- Editar crea un solo carrito con los artículos originales y cancela el pedido.

### Telegram

- Callback vigente y texto numérico producen la misma transición.
- Callback antiguo, estado/paso incorrecto y veinte dobles clics se ignoran; uno
  solo puede ejecutar efectos.
- Combinatoria completa de menús mediante updates simulados de Telegram.
- Suite completa de Vitest, typecheck y lint en PASS, seguida de verificación de
  salud en el puerto 3000.
