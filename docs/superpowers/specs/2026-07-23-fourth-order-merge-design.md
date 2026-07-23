# Combinación autorizada del cuarto pedido

## Objetivo

Cuando un cliente ya tenga tres pedidos activos e intente confirmar un cuarto
carrito, ofrecerle editar el pedido activo más reciente y combinar ambos
contenidos, siempre con autorización explícita y sin perder, duplicar ni
reservar incorrectamente stock.

## Alcance

- El máximo continúa siendo tres pedidos activos por contacto y tenant.
- Son activos los estados `pending`, `confirmed` y `processing`.
- El pedido candidato es el activo con `created_at` más reciente.
- El carrito que no pudo confirmarse permanece activo hasta que el cliente
  acepte o descarte la combinación.
- El flujo no usa SKU; la identidad de producto es exclusivamente `productId`.

## Estado FSM

Se incorpora el estado compuesto:

`menu:order_merge / awaiting_merge_confirmation`

Sus únicas acciones numéricas son:

1. `order:merge:confirm:<orderId>` — autoriza editar y combinar.
2. `order:merge:keep` — conserva pedido y carrito sin modificaciones.

Además acepta `I` para Inicio y `R` para volver al carrito. Cualquier otro
número, acción o callback se ignora silenciosamente. La acción de confirmación
debe existir en `numeric_options` y el callback debe coincidir con la instancia,
estado y paso activos.

## Presentación al cliente

Al recibir `active_order_limit`, el sistema muestra:

> Ya tienes tres pedidos activos. ¿Deseas editar el pedido N° X y combinarlo
> con este carrito?

El mensaje incluye:

- resumen del pedido candidato;
- resumen del carrito actual;
- `1. Sí, editar y combinar`;
- `2. No, mantener mi carrito`;
- botones Inicio y Retornar.

El pedido se identifica por su ID interno y número público. Nunca se expone SKU.

## Resolución del pedido candidato

El servicio de checkout que detecta el límite retorna también el ID y número
del pedido activo más reciente, obtenido con:

- `organization_id`;
- `contact_id`;
- estado dentro del conjunto activo;
- orden `created_at DESC`, con `id DESC` como desempate estable.

El ID retornado sirve únicamente para construir la propuesta. La operación de
combinación vuelve a comprobar bajo bloqueo que ese pedido sigue siendo el
activo más reciente. Un payload manipulado o desactualizado no cambia datos.

## Combinación de artículos

Los artículos del pedido y del carrito se agrupan por `productId`.

- Si el producto aparece una sola vez, se conserva su cantidad.
- Si aparece en ambos, se crea una sola línea con la suma de cantidades.
- Nombre, presentación y precio unitario se recargan desde el producto vigente.
- La salida se ordena por `productId` para hacer deterministas los bloqueos y
  resultados.

Antes de modificar cualquier fila se valida para cada producto:

- ID válido y perteneciente al mismo tenant;
- producto activo y no eliminado;
- cantidad entera positiva;
- cantidad combinada no superior a `maxUnitsPerProduct` del tenant;
- cantidad combinada no superior al stock disponible después de devolver las
  unidades previamente descontadas por el pedido candidato.

La validación es todo-o-nada. Si falla un producto, pedido, carrito y stock
permanecen intactos.

## Transacción autorizada

`mergeLatestOrderIntoActiveCart()` ejecuta en serie:

1. Bloquea la conversación y el contacto.
2. Bloquea el carrito activo.
3. Resuelve y bloquea el pedido activo más reciente.
4. Verifica que su ID coincide con la propuesta autorizada.
5. Agrupa los artículos por `productId`.
6. Bloquea los productos en orden estable.
7. Calcula el stock efectivo como stock actual más las unidades del pedido.
8. Valida límite tenant, integridad y stock para todos los productos.
9. Cambia condicionalmente el pedido a `cancelled`.
10. Devuelve al stock las unidades del pedido.
11. Reemplaza los artículos del carrito activo por la combinación normalizada.
12. Registra `reopened_from_order_id` en el carrito.

La transacción confirma únicamente si todos los pasos terminan correctamente.
Tras el commit se invalida la caché del catálogo.

## Idempotencia y concurrencia

- El callback de Telegram es de un solo uso.
- El servicio exige que el pedido siga activo y sea el candidato más reciente.
- La actualización condicional del estado del pedido permite un solo ganador.
- Dos confirmaciones simultáneas no restauran stock ni suman cantidades dos
  veces.
- Si el carrito o la cola cambia entre la propuesta y la autorización, la
  operación se rechaza y se vuelve a mostrar el estado vigente.

## Rechazos

- `merge_limit_exceeded`: indica producto y máximo tenant.
- `merge_stock_changed`: indica producto, disponible efectivo y solicitado.
- `merge_candidate_changed`: cambió el tercer pedido candidato.
- `active_cart_missing`: el carrito ya no existe o fue convertido.
- `invalid_order_items`: los datos persistidos no son combinables.

Los errores no ejecutan cambios parciales. El usuario conserva navegación hacia
Carrito, Pedidos e Inicio.

## Pruebas

### FSM

- El estado de confirmación acepta solamente sus dos acciones visibles.
- Números fuera de rango y acciones de otros menús se ignoran.
- Inicio y Retornar navegan correctamente.
- Un callback de una propuesta anterior se rechaza por estado, paso o instancia.

### Negocio

- Con menos de tres pedidos no aparece la propuesta.
- El cuarto intento identifica el pedido activo más reciente.
- Repetidos se consolidan por `productId` y suman cantidades.
- Productos distintos permanecen como líneas independientes.
- El precio y presentación se recargan desde catálogo.
- Exceso del máximo tenant rechaza toda la combinación.
- Falta de stock rechaza toda la combinación.
- La opción No conserva pedido, carrito y stock.

### Concurrencia

- Veinte confirmaciones simultáneas producen una sola combinación.
- Cambio del candidato entre propuesta y confirmación se rechaza.
- Pedido y carrito de otro tenant o contacto se rechazan.
- Tras combinar, permanecen dos pedidos activos y un carrito editable.
- Stock, pedido cancelado y carrito combinado quedan consistentes tras commit.

### Regresión

- Suite completa de Vitest en PASS.
- Typecheck en PASS.
- ESLint sin errores.
- Migraciones aplicadas y aplicación saludable en puerto 3000.

