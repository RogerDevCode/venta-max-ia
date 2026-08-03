export const BOTILLERIA_FAQ_VERSION = "botilleria-demo-v1" as const;

export const BOTILLERIA_FAQS = [
  ["¿Cuál es el horario de atención de Botillería STAX Demo?", "La atención demo opera de lunes a jueves entre 10:00 y 00:00; viernes y sábado hasta 01:00; domingo hasta 22:30. Revisa el catálogo antes de pedir: el horario real siempre lo define el negocio."],
  ["¿Hasta qué hora puedo hacer un pedido?", "Para la demo, procura pedir hasta 45 minutos antes del cierre. La aceptación depende de que el negocio confirme que puede preparar y despachar tu pedido."],
  ["¿Qué comunas cubre el delivery de Botillería STAX Demo?", "La cobertura demo considera Ñuñoa, Providencia, Macul, La Reina y Santiago Centro. La dirección exacta se revisa antes de confirmar."],
  ["¿Hacen delivery fuera de las comunas demo?", "El asistente registra tu dirección y el equipo revisa si puede cubrirla. No confirma despacho fuera de cobertura sin validación del negocio."],
  ["¿Cuánto cuesta el delivery?", "El valor depende de la comuna y del horario. La Botillería STAX Demo informa el monto antes de confirmar el pedido."],
  ["¿Cuánto demora el delivery?", "El plazo es estimado y depende de preparación, tráfico y demanda. El negocio confirma la disponibilidad antes de despachar."],
  ["¿Puedo retirar mi pedido?", "Sí, la demo contempla retiro si el negocio lo habilita. Espera la confirmación antes de salir para evitar un viaje innecesario."],
  ["¿Qué datos necesitan para entregar mi pedido?", "Necesitamos nombre, teléfono, comuna, dirección y una referencia útil, como departamento, portón o conserjería."],
  ["¿Puedo cambiar la dirección de entrega?", "Puedes solicitar el cambio antes del despacho. El equipo revisará si la nueva dirección está en cobertura y si cambia el valor del delivery."],
  ["¿Qué medios de pago acepta Botillería STAX Demo?", "La demo considera transferencia, tarjeta mediante enlace y efectivo contra entrega. El negocio confirma los medios disponibles antes de cerrar el pedido."],
  ["¿Puedo pagar con transferencia?", "Sí, puedes solicitar datos de transferencia. Envía el comprobante sólo por el canal indicado por el negocio y espera confirmación de pago."],
  ["¿Puedo pagar con tarjeta?", "Puedes pedir un enlace de pago si el negocio lo tiene habilitado. Nunca compartas claves, códigos SMS ni datos completos de tu tarjeta por chat."],
  ["¿Puedo pagar en efectivo al recibir?", "Puedes solicitar efectivo contra entrega si está disponible para tu zona. Indica con cuánto pagarás para que el repartidor pueda preparar vuelto si corresponde."],
  ["¿Cómo sé si un producto está disponible?", "El catálogo muestra disponibilidad de referencia, pero el stock final se confirma al preparar el pedido."],
  ["¿Qué pasa si no hay stock de un producto?", "El equipo te avisará antes de reemplazarlo. Puedes aceptar una alternativa, quitar el producto o cancelar el pedido sin que el asistente lo cambie por su cuenta."],
  ["¿Puedo pedir una presentación específica?", "Sí. Indica la marca, formato y cantidad, por ejemplo: dos cervezas Cristal lata de 350 ml. Si hay varias presentaciones, el asistente te pedirá precisión."],
  ["¿Los precios del catálogo son definitivos?", "El catálogo orienta la compra. El total definitivo se confirma al momento de preparar el pedido, especialmente si hubo cambios de precio o stock."],
  ["¿Cómo uso una promoción?", "Agrega la promoción tal como aparece en el catálogo. Si tiene condiciones, el negocio las revisa antes de confirmar el total."],
  ["¿Puedo combinar productos en un solo pedido?", "Sí. Puedes agregar cervezas, bebidas, hielo y snacks al mismo carrito y revisar el resumen antes de confirmarlo."],
  ["¿Cómo confirmo mi pedido?", "Revisa productos, cantidades, dirección y medio de pago. Luego usa la opción Confirmar pedido; el negocio valida stock y condiciones antes de despachar."],
  ["¿Puedo modificar un pedido?", "Puedes solicitar cambios mientras el pedido no esté en despacho. El sistema mostrará el pedido para editar y recalculará el total si corresponde."],
  ["¿Puedo cancelar un pedido?", "Puedes pedir cancelación antes del despacho. Si el pedido ya fue preparado o salió, el equipo revisará el caso y te informará las opciones."],
  ["¿Cómo reviso mis pedidos?", "Escribe “mis pedidos” o usa el menú. Verás los pedidos asociados a esta conversación y podrás revisar su estado."],
  ["¿Puedo hacer otro pedido si ya tengo uno activo?", "Sí, puedes crear otro pedido dentro de los límites del negocio. El sistema te avisará si conviene editar uno existente en lugar de duplicarlo."],
  ["¿Puedo pedir para una hora futura?", "Puedes solicitar una hora aproximada. El negocio confirma si puede reservar preparación y despacho para ese horario."],
  ["¿Qué hago si mi pedido llega incompleto o con un problema?", "Conserva el comprobante y escribe al negocio con tu número de pedido y una descripción breve. Un operador revisará el caso."],
  ["¿Puedo hablar con una persona?", "Sí. Usa la opción Hablar con humano y deja tu consulta. El equipo responderá según su horario y disponibilidad; no se promete atención inmediata."],
  ["¿El asistente vende alcohol a menores de edad?", "No. La venta y entrega de alcohol es sólo para personas mayores de 18 años. El repartidor o negocio puede pedir verificación de edad."],
  ["¿Puedo pedir alcohol para otra persona?", "Sí, si la persona que recibe es mayor de 18 años y está disponible para recibir. El negocio puede rechazar la entrega si no puede verificarlo."],
  ["¿Venden bebidas sin alcohol y snacks?", "Sí. El catálogo demo incluye bebidas, energéticas, snacks, hielo y algunas alternativas sin alcohol. Revisa las presentaciones disponibles."],
  ["¿Qué pasa si nadie recibe el delivery?", "Contactaremos al teléfono indicado. Si no hay recepción, el negocio evaluará el reintento o retorno y te informará cualquier costo aplicable antes de cobrarlo."],
  ["¿Cómo cuidan mis datos?", "Los datos de contacto y dirección se usan para gestionar tu pedido y la atención asociada. No compartas claves ni información bancaria sensible por el chat."],
] as const satisfies ReadonlyArray<readonly [question: string, answer: string]>;

export function botilleriaFaqId(organizationId: string, index: number) {
  return `kb_botilleria_demo_${organizationId}_${String(index + 1).padStart(2, "0")}`;
}
