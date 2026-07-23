# Diseño: selección de producto, cantidad y carrito en Telegram

**Fecha:** 2026-07-23  
**Estado:** aprobado

## Objetivo

Permitir que un cliente navegue productos desde Telegram, seleccione uno mediante un botón, escriba una cantidad válida y lo agregue al carrito con confirmación inmediata. El flujo no debe exponer SKU ni permitir que un carrito bloquee inventario indefinidamente.

## Alcance

- Listado numerado de productos por categoría con botones Telegram.
- Presentación tomada de `product.description`.
- Identificación pública e interna del producto por `product.id`; el SKU queda reservado exclusivamente para administración.
- Estado FSB explícito para esperar la cantidad.
- Validación de cantidad, límite del tenant y stock.
- Confirmación del artículo agregado y resumen del carrito.
- Configuración multi-tenant del máximo de unidades por producto.
- Eliminación de la reserva de inventario al agregar al carrito; la disponibilidad se confirma de forma atómica al formalizar el pedido.

## Experiencia del usuario

### Lista de productos

Al seleccionar una categoría, el mensaje usa el formato:

```text
🛍️ Productos
1. Coca-Cola — 2 litros — $2.500 CLP
2. Agua — 1 litro — $1.000 CLP

Selecciona un producto.
```

Cada producto tiene un botón numerado, por ejemplo `1. Coca-Cola — 2 litros`. El texto nunca muestra SKU ni la cadena `null`. Si la descripción está vacía, se omite la presentación y no se imprime un sustituto técnico.

La última fila del teclado contiene `↩ Retornar` y `⌂ Inicio`. Los mensajes `r/R` e `i/I` conservan el mismo comportamiento.

### Selección y cantidad

El callback del producto contiene una acción basada en `product.id`, protegida por la instancia de menú de un solo uso ya implantada. Al aceptarlo:

1. Se comprueba que el producto pertenece al tenant, está activo y no fue eliminado.
2. La conversación pasa a `cart:awaiting_quantity`.
3. `stateMetadata` guarda `selectedProductId` y los datos mínimos necesarios para presentar el contexto.
4. Se responde: `¿Cuántas unidades de Coca-Cola — 2 litros deseas agregar? Escribe un número.`

Mientras la conversación está en ese estado, el siguiente texto se procesa antes del LLM y solo como intento de cantidad.

### Confirmación

Una operación exitosa responde:

```text
✅ Agregamos Coca-Cola — 2 litros, cantidad 2, a tu carrito.

🛒 Carrito: 2 productos · Total: $5.000 CLP
```

Después, el estado pasa a `menu:cart` y se limpian `selectedProductId` y los campos temporales de cantidad.

## Validación y prevención de abuso

La cantidad se acepta únicamente si el mensaje completo coincide con un entero decimal positivo. Se rechazan texto mixto, exponentes, signos, cero, negativos, decimales y valores fuera del rango entero seguro.

El orden de validación es:

1. Formato de entero positivo.
2. Producto vigente y perteneciente al tenant.
3. Total acumulado del producto en el carrito menor o igual al límite del tenant.
4. Total acumulado menor o igual al stock disponible actual.

`commerce_settings.max_units_per_product` define el límite global por producto y carrito para cada tenant. Su valor predeterminado es `10`, debe ser un entero positivo y se configura desde la pantalla Catálogo.

Un rechazo no modifica el carrito ni el estado de selección. El usuario puede volver a escribir una cantidad. Los mensajes son específicos:

- Formato inválido: `Escribe una cantidad válida usando un número entero mayor que cero.`
- Límite: `Puedes agregar como máximo N unidades de este producto.`
- Stock: `La cantidad solicitada no está disponible. Disponibilidad actual: N.`
- Producto ya no disponible: se limpia la selección y se regresa al listado de la categoría.

## Inventario

Agregar un artículo al carrito no reserva ni descuenta stock. Esto evita que carritos abandonados o maliciosos bloqueen ventas.

Al confirmar el pedido se ejecuta una transacción PostgreSQL que bloquea las filas de productos relevantes, vuelve a validar todas las cantidades y descuenta el inventario únicamente si el pedido completo es viable. Si la disponibilidad cambió, no se crea el pedido y se informa qué artículo debe ajustarse.

La caché de catálogo muestra `stock` real; deja de restar cantidades de todos los carritos activos. El control final depende de PostgreSQL, no de la memoria del proceso.

## Persistencia multi-tenant

Se agrega `commerce_settings`:

- `organization_id TEXT NOT NULL`, clave primaria y referencia a `organization` con borrado en cascada.
- `max_units_per_product INTEGER NOT NULL DEFAULT 10` con restricción positiva.
- `created_at` y `updated_at`.
- Índice/clave org-first.

Toda consulta usa `scoped(organization_id)`. La creación es perezosa o mediante migración lógica, conservando el valor predeterminado cuando aún no existe una fila.

La selección temporal permanece en `conversation.stateMetadata`:

- `current_state: "cart:awaiting_quantity"`
- `active_step: "awaiting_product_quantity"`
- `selectedProductId`
- `catalogCategoryId`, para retornar al listado correcto

No se guarda ni se recibe SKU en callbacks o mensajes de cliente.

## Componentes

- `commands.ts`: nuevas acciones `catalog:product:<productId>` y manejo del estado de cantidad antes de la resolución general de comandos.
- Servicio de catálogo: consulta segura del producto por ID y tenant.
- Servicio de carrito: agrega por `productId`, aplica límite tenant y stock sin reservar inventario.
- Servicio de configuración comercial: lee y actualiza `maxUnitsPerProduct`.
- Confirmación de pedido: validación y descuento transaccional de stock.
- Configuración de Catálogo: campo numérico para el máximo por producto.

La lógica de validación y mutación vive en servicios de dominio; Telegram solo presenta botones y transporta acciones protegidas.

## Concurrencia e idempotencia

- El menú de productos es de un solo uso; callbacks viejos o dobles se reconocen silenciosamente sin efectos.
- Los mensajes entrantes mantienen la idempotencia por identificador Telegram.
- Dos mensajes de cantidad concurrentes sobre la misma conversación se serializan con el control existente por conversación; el segundo reevalúa el estado vigente y no duplica la operación.
- La confirmación de pedido usa bloqueo de filas y una sola transacción, evitando sobreventa.

## Pruebas

### Unitarias

- Productos enumerados y botones basados en ID.
- Presentación desde `description`, sin SKU ni `null`.
- Inicio y Retornar al final del teclado.
- Transición a `cart:awaiting_quantity`.
- Enteros válidos y rechazo de texto, cero, negativos, decimales, exponentes y desbordamiento.
- Límite predeterminado `10` y límite personalizado por tenant.
- Total acumulado del carrito contra límite y stock.
- Mensaje y resumen después de agregar.
- Producto eliminado entre selección y cantidad.

### Integración PostgreSQL

- Aislamiento entre tenants para producto y configuración.
- Dos cantidades concurrentes no duplican el artículo.
- Dos confirmaciones concurrentes no venden más stock que el disponible.
- Un carrito abandonado no reduce la disponibilidad de otro cliente.

### Telegram

- Navegación categoría → producto → cantidad → carrito.
- Callback antiguo, doble clic y botón de otro chat ignorados silenciosamente.
- Cantidad inválida permite reintento sin perder la selección.
- `r/R` e `i/I` siguen operativos.

## Criterios de aceptación

- Ningún mensaje o botón dirigido al cliente contiene SKU o `null`.
- Cada producto visible está numerado y tiene botón.
- Solo un entero positivo dentro del límite tenant y del stock modifica el carrito.
- El límite por defecto es 10 y puede modificarse por tenant.
- Los carritos no reservan inventario.
- La confirmación del pedido protege el stock de forma transaccional.
- Todas las pruebas unitarias, de integración y Telegram pasan con la aplicación activa en el puerto 3000.
