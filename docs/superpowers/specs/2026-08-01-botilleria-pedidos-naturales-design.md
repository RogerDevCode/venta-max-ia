# Botillería: catálogo de presentaciones y pruebas de pedidos

## Objetivo

Crear una semilla de demostración de botillería para Venta Max IA y probar de
punta a punta los pedidos conversacionales sin modificar el modelo de datos
antes de que sea necesario.

## Modelo de catálogo

- Cada presentación vendible es un `product`/SKU independiente, con precio,
  stock, estado y descripción propios.
- Los productos que pertenecen a la misma marca o familia comparten `name` y
  se distinguen por `description`: por ejemplo, Cerveza Cristal lata 350 ml,
  botella 330 ml y six-pack 6x330 ml.
- El seed usa categorías de botillería: cervezas, vinos, destilados, bebidas,
  energía, snacks y promociones. No mezcla suplementos ni datos del seed
  anterior.
- La semilla es explícita por organización, idempotente y no borra catálogos de
  otros tenants. Requiere `--replace` para reemplazar el catálogo de esa
  organización.

## FAQ de botillería

El seed agrega respuestas concretas sobre horario, cobertura y delivery,
medios de pago, costo/tiempo de despacho, retiro, verificación de mayoría de
edad, productos agotados, cambios, promociones, facturación y atención humana.
No inventa disponibilidad, precios o zonas: las FAQ de ejemplo se identifican
como datos demostrativos editables por el tenant.

## Pedidos por lenguaje natural

La prueba cubre frases como “quiero dos Cristal lata”, “cambia una por un
six-pack”, “agrega hielo”, “quita las bebidas”, “cancela mi pedido” y “quiero
pedir de nuevo”. La conversación debe confirmar la presentación si hay más de
una coincidencia; nunca elegir silenciosamente una lata, botella o pack.

Modificar un pedido solo es posible mientras está en estado editable. Cancelar
restaura stock una sola vez. El cuarto pedido se valida junto con las reglas
existentes de consolidación, numeración, repricing e idempotencia.

## Matriz de pruebas

- Happy path de catálogo, carrito, checkout, modificación, cancelación y nuevo
  pedido.
- Selección ambigua de presentación, SKU inexistente, producto inactivo,
  cantidad cero/negativa/fraccionaria, texto excesivo y valores límite.
- Stock insuficiente, agotamiento entre selección y checkout, líneas duplicadas,
  reintentos y veinte solicitudes concurrentes.
- Tercer/cuarto pedido, contador de pedidos, repricing, restauración de stock y
  aislamiento entre dos organizaciones.
- Frontend: grupo de presentaciones legible, precio/stock correcto, acciones
  deshabilitadas cuando corresponde y mensajes de error comprensibles.

## Fuera de alcance

No se implementa venta de alcohol real, pago real ni despacho real. La semilla
no reemplaza la verificación legal de edad, condiciones comerciales o el
catálogo real de un tenant.
