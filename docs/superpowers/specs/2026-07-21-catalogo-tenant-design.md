# Diseño: catálogo administrable por tenant

## Objetivo

Dar a cada organización un catálogo administrable desde Configuración y una
navegación conversacional por categorías. El operador podrá administrar hasta
nueve categorías y sus productos sin que ninguna operación pueda cruzar los
límites de su tenant.

## Decisiones de producto

- Cada organización puede tener como máximo nueve categorías, incluida
  **General**.
- **General** es la categoría de respaldo. Se crea de forma idempotente al
  inicializar o usar el catálogo, no se puede editar ni eliminar y recibe los
  productos de una categoría eliminada.
- Eliminar una categoría ordinaria requiere confirmación e informa el número
  de productos que se moverán a General. La reasignación y el borrado ocurren
  en una única transacción.
- El menú de catálogo muestra las categorías como botones enumerados del 1 al
  9. El cliente puede pulsar un botón o enviar el número correspondiente.
- En una vista de categoría, el botón **Retornar** y los mensajes `r` / `R`
  vuelven a las categorías; el botón **Inicio** y `i` / `I` vuelven al menú
  principal.

## Arquitectura

### Datos e integridad

`category` mantiene `organization_id NOT NULL`. Se añadirá una restricción de
nombre único normalizado por organización y un índice/clave candidata compuesta
`(organization_id, id)`. `product` conservará su `organization_id` y tendrá una
clave foránea compuesta `(organization_id, category_id)` hacia `category`, de
modo que la base de datos impida asociar un producto a una categoría de otro
tenant.

El servicio de dominio será la única capa que cree, edite, borre o reasigne
categorías y productos. Toda consulta y mutación recibirá el `organizationId`
de la sesión y usará `scoped()`. La eliminación bloqueará la categoría General,
resolverá General en el mismo tenant y realizará `UPDATE product` seguido de
`DELETE category` dentro de una transacción.

### API y panel de tenant

Se expondrán rutas autenticadas de catálogo para listar y mutar categorías y
productos. Sus cuerpos se validarán con Zod; los errores usarán el contrato
`{ error: { code, message } }`. Las validaciones incluyen límite de nueve,
nombre requerido y único, SKU único, precio y stock enteros no negativos, y
una categoría válida del tenant al crear o editar un producto.

La nueva pestaña **Catálogo** en Configuración tendrá dos áreas: categorías y
productos. Permitirá alta, edición y eliminación confirmada; al eliminar una
categoría mostrará la reasignación a General. Las categorías protegidas tendrán
acciones deshabilitadas con explicación. La lista de productos permitirá elegir
una categoría, incluida General.

### Conversación

El procesador de comandos conservará el menú principal. Al elegir “Ver
Catálogo”, obtendrá las categorías del tenant, ordenadas de forma estable, y
enviará una botonera Telegram de hasta nueve opciones con payloads que contienen
el id de categoría. El canal de texto mapeará `1` a `9` a la categoría mostrada
en el estado de conversación, no a un índice global. La selección lista solo
los productos activos de esa categoría. `r` / `R` y el botón Retornar restauran
la lista de categorías; `i` / `I` y el botón Inicio restauran el menú principal.

Los callbacks y textos se validan contra el estado actual y el tenant; clicks
duplicados se someten al mecanismo de coalescencia existente. Si una categoría
deja de existir entre la visualización y la selección, se muestra el catálogo
actualizado sin fallar.

## Manejo de errores y concurrencia

- Una décima categoría devuelve conflicto de negocio y la UI mantiene los datos
  ingresados con un mensaje visible.
- Nombres duplicados, SKU duplicados, importes inválidos y referencias de otra
  organización devuelven errores controlados, sin filtrar datos.
- La transacción de eliminación evita estados intermedios y conserva productos.
- Las publicaciones SSE y efectos de mensajería independientes se ejecutan con
  captura explícita de errores, conforme a AGENTS.md.

## Pruebas y limpieza

Las pruebas unitarias cubrirán validaciones, límite, protección de General,
transacción de reasignación, aislamiento de tenant y navegación conversacional.

Una prueba Playwright iniciará sesión en un tenant de prueba, ejercerá CRUD de
categorías y productos, comprobará el límite de nueve y las combinaciones de
alta/edición/borrado, y verificará el movimiento de productos a General. También
recorrerá los controles conversacionales mediante el entorno mock: botón y
número de categoría, Retornar/r e Inicio/i. La preparación usará identificadores
únicos y el `finally` de la prueba eliminará, de forma tenant-scoped, todos los
datos creados incluso si una aserción falla.

## Fuera de alcance

- Importación masiva, imágenes de producto, descuentos, pagos y variaciones.
- Borrar productos automáticamente al eliminar una categoría.
- Cambiar el modelo de carrito/pedido existente.
