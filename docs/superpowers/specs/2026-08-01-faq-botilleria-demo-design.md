# FAQ de Botillería STAX Demo — Diseño

## Objetivo

Poblar el conocimiento recuperable del tenant de demostración con 32 preguntas y respuestas útiles para
una botillería con delivery en Santiago. El asistente debe responder con claridad, sin inventar stock,
precios, plazos garantizados ni políticas de un comercio real.

## Alcance y fuente

Las condiciones son demostrativas y editables por el tenant. Se inspirarán en patrones públicos de
botillerías con delivery de Santiago, pero no copiarán textos ni se atribuirán a esos negocios.

La cobertura demo será Ñuñoa, Providencia, Macul, La Reina y Santiago Centro. El horario, el costo de
delivery y los medios de pago quedarán expresamente sujetos a la confirmación que muestra el catálogo
o el operador del negocio.

## Contenido

Se crearán 32 entradas `kb_entry` de tipo `qa`, separadas para favorecer recuperación precisa:

- Horario de atención, horario de pedidos y qué ocurre cerca del cierre.
- Comunas cubiertas, dirección, referencias y zonas fuera de cobertura.
- Costo, plazo estimado, seguimiento y recepción del delivery.
- Retiro, datos necesarios y cambios de dirección.
- Transferencia, tarjeta/enlace y efectivo contra entrega, sujetos a disponibilidad del negocio.
- Catálogo, presentaciones, stock, sustituciones, promociones y precios finales.
- Crear, revisar, modificar, cancelar y confirmar pedidos.
- Atención humana, consumo responsable y venta exclusiva a mayores de edad.

Cada respuesta mencionará que se trata de la **Botillería STAX Demo** cuando el contexto pueda inducir a
confusión. Las respuestas no indicarán una tarifa fija ni prometerán una hora de entrega.

## Operación y seguridad

Un script de seed recibirá `--organization <id>` y no afectará otros tenants. Será idempotente: por
defecto reemplazará sólo las FAQ que el propio seed identifica como demo de Botillería. No alterará
productos, pedidos, contactos ni FAQ ajenas creadas por el operador.

Las entradas se insertarán como texto; el pipeline de embeddings existente las indexará de acuerdo con
la operación habitual de la aplicación. Si el conocimiento no cubre una pregunta, el agente deberá
indicarlo y ofrecer derivar al equipo humano, nunca rellenar la respuesta con una suposición.

## Validación

- Comprobar exactamente 32 FAQ demo para el tenant objetivo.
- Verificar aislamiento: otro tenant no recibe cambios.
- Probar recuperación de al menos horario, comuna, pago, delivery, cancelación y venta responsable.
- Ejecutar pruebas unitarias, tipos y regresión proporcional.
