# Guardas conversacionales de Botillería STAX Demo — Diseño

## Objetivo

Evitar que el asistente responda garabatos, invente productos, precios o condiciones, o se desvíe del
negocio de Botillería STAX Demo. Las respuestas comerciales provienen exclusivamente del catálogo del
tenant, de las FAQ recuperadas mediante pgvector y del estado de pedido del cliente.

## Defensa en capas

1. Un guard local, normalizado y determinista se ejecuta antes del LLM.
2. Detecta lenguaje ofensivo chileno/español, incluso con mayúsculas, acentos, repeticiones y separadores.
3. Detecta preguntas fuera del ámbito: no relacionadas con catálogo, pedidos, delivery, retiro, pagos,
   atención humana, productos sin alcohol, venta responsable o las FAQ del tenant.
4. Las solicitudes de productos, precios y disponibilidad se resuelven exclusivamente con consultas
   tenant-scoped a PostgreSQL. Una búsqueda sin resultados no genera sugerencias inventadas.
5. El prompt mantiene la misma política como segunda barrera, pero no sustituye las guardas locales.

## Respuestas y reincidencia

- Primer garabato: “Puedo ayudarte con productos, pedidos, delivery y pagos de la Botillería. Conversemos
  con respeto, por favor.” No llama al LLM ni modifica pedidos.
- Segundo garabato consecutivo: mismo límite, más la alternativa de pedir atención humana. No bloquea ni
  sanciona al cliente automáticamente.
- Pregunta fuera de ámbito: “Puedo orientarte sólo sobre esta Botillería: catálogo, pedidos, delivery,
  pagos y horarios. ¿Qué necesitas revisar?” No responde el contenido externo.
- Producto o presentación inexistente: “No encontré ese producto en el catálogo actual. Puedo mostrarte
  las categorías disponibles.” No inventa precio, stock ni sustituto.

## Estado y privacidad

La cuenta de eventos consecutivos se conserva en `conversation.stateMetadata` bajo un campo interno de
guardas. Un mensaje válido reinicia la cuenta. No se almacena texto ofensivo adicional ni se comparte
información entre organizaciones.

## Validación

- Pruebas unitarias de normalización y de garabatos con variantes comunes.
- Pruebas del guard para primer y segundo evento, reinicio por mensaje válido y fuera de ámbito.
- Pruebas de regresión que confirman que no se consulta el LLM ni se cambia el carrito al activar una guarda.
- Pruebas de catálogo sin coincidencia que confirman ausencia de producto, precio o sustituto inventado.
