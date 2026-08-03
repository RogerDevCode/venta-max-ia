export type ConversationGuardKind = "offensive" | "out_of_scope";

const OFFENSIVE_TERMS = [
  "weon", "huevon", "huevon", "culiao", "culia", "maricon", "puta", "mierda", "conchetumadre",
];

const EXTERNAL_TOPICS = [
  "futbol", "partido", "presidente", "politica", "eleccion", "clima", "receta", "programacion",
  "codigo", "matematica", "historia", "pelicula", "serie", "noticia", "bitcoin", "criptomoneda",
];

const BUSINESS_TERMS = [
  "catalogo", "producto", "pedido", "carrito", "delivery", "despacho", "retiro", "pago", "horario",
  "comuna", "stock", "cerveza", "vino", "pisco", "bebida", "snack", "hielo", "humano", "mayor de edad",
  "precio", "cuesta", "vale", "promo", "promocion", "transferencia", "tarjeta", "efectivo", "direccion",
];

function normalizedWords(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Detecta sólo lenguaje ofensivo y temas claramente ajenos; las dudas comerciales ambiguas no se bloquean. */
export function classifyConversationInput(text: string): ConversationGuardKind | null {
  const normalized = normalizedWords(text);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, "");
  if (OFFENSIVE_TERMS.some((term) => compact.includes(term))) return "offensive";
  const mentionsBusiness = BUSINESS_TERMS.some((term) => normalized.includes(term));
  if (!mentionsBusiness && EXTERNAL_TOPICS.some((term) => normalized.includes(term))) return "out_of_scope";
  return null;
}

export function guardReply(kind: ConversationGuardKind, offensiveStrikes = 0) {
  if (kind === "offensive") {
    return offensiveStrikes >= 2
      ? "Puedo ayudarte con productos, pedidos, delivery y pagos de la Botillería. Conversemos con respeto, por favor. Si lo prefieres, puedes solicitar atención humana."
      : "Puedo ayudarte con productos, pedidos, delivery y pagos de la Botillería. Conversemos con respeto, por favor.";
  }
  return "Puedo orientarte sólo sobre esta Botillería: catálogo, pedidos, delivery, pagos y horarios. ¿Qué necesitas revisar?";
}
