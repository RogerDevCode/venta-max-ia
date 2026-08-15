import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { applyHandoff } from "@/server/ai/pipeline";
import {
  ACTIVE_ORDER_STATUSES,
  addProductToCart,
  buscarProductos,
  cancelActiveOrder,
  clearActiveCart,
  confirmarPedido,
  editOrderAsCart,
  getOrderForCustomer,
  getProductForCustomer,
  listarCategorias,
  listActiveOrders,
  listCatalogProducts,
  mergeLatestOrderIntoActiveCart,
} from "@/server/ecommerce/service";
import { preloadCatalogCache } from "@/server/ecommerce/cache";
import { customerProductLabel, parsePositiveInteger } from "@/server/ecommerce/quantity";
import { renderPriceDisclosure } from "@/server/ecommerce/pricing";
import { enterMenuState, resolveMenuInput, type MenuStateMetadata } from "@/server/ai/menu-fsm";

export type SlashCommandType =
  | "start"
  | "menu"
  | "reset"
  | "humano"
  | "menu:categorias"
  | "menu:promociones"
  | "menu:mas_vendidos"
  | "menu:carrito"
  | "menu:pedidos"
  | "menu:humano"
  | "nav:back"
  | "nav:home"
  | "catalog:return"
  | "catalog:home"
  | `catalog:category:${string}`
  | `catalog:product:${string}`
  | `catalog:number:${string}`
  | "cart:checkout"
  | "cart:clear"
  | "order:cancel:active"
  | `order:detail:${string}`
  | `order:refresh:${string}`
  | `order:edit:${string}`
  | `order:cancel:${string}`
  | `order:merge:confirm:${string}`
  | "order:merge:keep";

export type NaturalAddToCartRequest = {
  quantity: number;
  query: string;
};

const SPANISH_QUANTITIES: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

/**
 * Reconoce una petición breve para sumar un producto, sin interpretar preguntas
 * generales ni elegir por el cliente cuando existen varias presentaciones.
 */
export function parseNaturalAddToCart(text?: string | null): NaturalAddToCartRequest | null {
  if (!text) return null;
  const clean = text
    .trim()
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,]/g, "")
    .replace(/\s+/g, " ");

  if (
    clean.includes("y confirmar") ||
    clean.includes("confirmar") ||
    clean.includes("cotizar") ||
    clean.includes("cotizacion") ||
    clean.includes("consultar") ||
    clean.includes("informacion") ||
    clean.includes("asesoria") ||
    clean.includes("agendar") ||
    clean.includes("reserva") ||
    clean.includes("saber") ||
    clean.includes("precio") ||
    clean.includes("garantia") ||
    clean.includes("horario") ||
    clean.includes("cuanto cuesta") ||
    clean.includes("cuanto vale") ||
    clean.startsWith("cual") ||
    clean.startsWith("como") ||
    clean.startsWith("donde") ||
    clean.startsWith("que") ||
    clean.length > 80
  ) {
    return null;
  }

  // Si tiene verbo explícito de compra/adición
  const match = clean.match(/^(?:agrega|anade|ponme|pon|dame|me llevo|llevo|quiero comprar|deseo comprar|comprar|compra|sumar|suma|pedir|pido|necesito|me das|quiero|deseo)\s*(?:(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?(?:de\s+)?(.+?)(?:\s+(?:al|a mi) carrito)?$/);
  
  // O si empieza con un número/cantidad explícita (ej. "2 cristal lata 350")
  const matchQuantityFirst = !match
    ? clean.match(/^(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:de\s+)?(.+?)(?:\s+(?:al|a mi) carrito)?$/)
    : null;

  const targetMatch = match || matchQuantityFirst;
  if (!targetMatch?.[2]) return null;

  const quantityToken = targetMatch[1];
  const quantityCandidate = quantityToken
    ? (/^\d+$/.test(quantityToken) ? Number(quantityToken) : SPANISH_QUANTITIES[quantityToken])
    : 1;
  const quantity = quantityCandidate ?? 1;
  const query = targetMatch[2].trim();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || query.length <= 1) return null;
  return { quantity, query };
}

/** Parsea un texto entrante o payload de botón callback para detectar comandos y menús. */
export function parseSlashCommand(text?: string | null): SlashCommandType | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. Manejo de Callback Payload exacto del menú
  if (
    clean.startsWith("menu:") ||
    clean.startsWith("nav:") ||
    clean.startsWith("catalog:category:") ||
    clean.startsWith("catalog:product:") ||
    clean.startsWith("cart:") ||
    clean.startsWith("order:")
  ) {
    return clean as SlashCommandType;
  }
  if (clean === "r" || clean === "R" || clean === "catalog:return") return "nav:back";
  if (clean === "i" || clean === "I" || clean === "catalog:home") return "nav:home";
  if (clean.toLowerCase() === "confirmar") return "cart:checkout";
  const natural = clean.toLocaleLowerCase("es-CL").replace(/[¿?¡!.,]/g, "").trim();
  if (/^(ver|mostrar|revisar|consultar|mi)?\s*(el|mi)?\s*(carro|carrito|carrito de compras)$/.test(natural) ||
      /^(que tengo en (el|mi) (carro|carrito)|ver mi carro|ver el carro|ver carro|mostrar carro|mostrar mi carro)$/.test(natural)) {
    return "menu:carrito";
  }
  if (/^(cancelar|anular|eliminar|borrar|cancela|anula)\s*(el|mi|mis)?\s*(pedido|pedidos|orden|compra)$/.test(natural) ||
      /^(quiero|deseo)\s*(cancelar|anular)\s*(mi|el)?\s*(pedido|orden|compra)$/.test(natural) ||
      natural === "cancelar mi pedido" || natural === "anular mi pedido" || natural === "cancelar pedido" || natural === "anular pedido" || natural === "cancela mi pedido") {
    return "order:cancel:active";
  }
  if (/^(ver|mostrar|revisar|consultar|mis)\s*(el|mi|mis)?\s*(pedido|pedidos|orden|compras)$/.test(natural) ||
      /^(estado de (mi|el) pedido|que pedi|ver mi pedido|ver el pedido|ver pedido|mostrar pedido|mostrar mi pedido|mis pedidos|mis compras|pedidos)$/.test(natural)) {
    return "menu:pedidos";
  }
  if (/^(confirmar|confirmar compra|confirmar pedido|quiero confirmar)$/.test(natural)) return "cart:checkout";
  if (/^(vaciar|limpiar|borrar) (mi )?carrito$/.test(natural)) return "cart:clear";

  // 2. Manejo de Comandos Slash clásicos (/start, /menu, /reset, /humano)
  if (clean.startsWith("/")) {
    const match = clean.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+.*)?$/);
    if (!match || !match[1]) return null;
    const cmd = match[1].toLowerCase();
    if (cmd === "start" || cmd === "menu" || cmd === "reset" || cmd === "humano") {
      return cmd as SlashCommandType;
    }
  }

  // 3. Selección numérica contextual: menú principal, categoría o producto.
  if (/^[1-9][0-9]*$/.test(clean)) return `catalog:number:${clean}`;
  return null;
}

type Conversation = typeof schema.conversation.$inferSelect;

/**
 * Constante del Menú Principal Transaccional (migrado desde chatbot)
 * Optimizado para 2 columnas en Telegram Inline Keyboard.
 */
export function buildMainMenuMarkup(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: "1. 🛍️ Ver Catálogo", callback_data: "menu:categorias" },
        { text: "2. ⚡ Promos del Día", callback_data: "menu:promociones" },
      ],
      [
        { text: "3. ⭐ Recomendados", callback_data: "menu:mas_vendidos" },
        { text: "4. 🛒 Mi Carrito (Pagar)", callback_data: "menu:carrito" },
      ],
      [
        { text: "5. 📋 Mis Pedidos", callback_data: "menu:pedidos" },
        { text: "6. 👤 Hablar con Humano", callback_data: "menu:humano" },
      ],
    ],
  };
}

/** Procesador central de comandos slash y menús interactivos de VentaMaxIA. */
export async function processSlashCommand(input: {
  command: SlashCommandType;
  conversation: Conversation;
  lastInboundExternalId?: string | null;
  profile?: typeof schema.agentProfile.$inferSelect | null;
  navigationStack?: string[];
}): Promise<{ handled: boolean }> {
  const { command, conversation } = input;
  const { organizationId, id: conversationId } = conversation;
  const db = getDb();
  const channel = "telegram" as const;

  // Precarga asíncrona no bloqueante del catálogo y stock en paralelo mientras se muestra el menú/comando
  void preloadCatalogCache(organizationId).catch(() => {});

  const currentState = ((conversation.stateMetadata as MenuStateMetadata) ?? {});
  const isTelegram = true;
  const navigationRow = [
    { text: "⌂ Inicio", callback_data: "nav:home" },
    { text: "↩ Retornar", callback_data: "nav:back" },
  ];

  async function updateState(newState: Record<string, unknown>) {
    const nextState = { ...currentState, ...newState };
    if (newState.current_state !== "cart:awaiting_quantity") {
      delete nextState.selectedProductId;
    }
    await db
      .update(schema.conversation)
      .set({
        stateMetadata: nextState,
        updatedAt: new Date(),
      })
      .where(
        and(
          scoped(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.id, conversationId)
        )
      );

    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversationId } },
    });
  }

  async function showMainMenu() {
    await updateState(enterMenuState(currentState, {
      currentState: "menu:main",
      activeStep: "main_menu",
      scope: "menu:main",
      numericOptions: [
        "menu:categorias",
        "menu:promociones",
        "menu:mas_vendidos",
        "menu:carrito",
        "menu:pedidos",
        "menu:humano",
      ],
    }));
    await deliverCommandReply(
      conversation,
      "📌 *Menú Principal — VentaMaxIA*\nSelecciona una opción:",
      { replyMarkup: isTelegram ? buildMainMenuMarkup() : undefined, channel }
    );
  }

  async function showCategories(stack?: string[]) {
    const categorias = await listarCategorias(organizationId);
    await updateState({
      ...enterMenuState(currentState, {
        currentState: "menu:catalog",
        activeStep: "viewing_catalog",
        scope: "menu:catalog",
        numericOptions: categorias.map((category) => `catalog:category:${category.id}`),
        stack,
      }),
      catalogCategoryIds: categorias.map((c) => c.id),
      catalogCategoryId: null,
      catalogProductIds: null,
    });
    const text = `📁 *Categorías de Productos*:\n${categorias.map((c, index) => `${index + 1}. *${c.name}*${c.description ? `: ${c.description}` : ""}`).join("\n")}\n\nElige una categoría con su botón o número.`;
    const rows = categorias.map((c, index) => [{ text: `${index + 1}. ${c.name}`, callback_data: `catalog:category:${c.id}` }]);
    rows.push(navigationRow);
    await deliverCommandReply(conversation, `${text}\n\nI. Inicio · R. Retornar`, {
      replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
      channel,
    });
  }

  async function showProductMenu(input: {
    title: string;
    emptyText: string;
    products: Awaited<ReturnType<typeof buscarProductos>>;
    currentState: "menu:promos" | "menu:recommended";
    activeStep: "viewing_promos" | "viewing_recommended";
    scope: "menu:promos" | "menu:recommended";
    stack?: string[];
  }) {
    const options = input.products.map((product) => `catalog:product:${product.id}`);
    await updateState(enterMenuState(currentState, {
      currentState: input.currentState,
      activeStep: input.activeStep,
      scope: input.scope,
      numericOptions: options,
      stack: input.stack,
    }));
    const text = input.products.length > 0
      ? `${input.title}\n${input.products.map((product, index) =>
          `${index + 1}. ${customerProductLabel(product)} — $${product.price.toLocaleString("es-CL")} CLP`
        ).join("\n")}\n\nSelecciona un producto.`
      : input.emptyText;
    const rows = input.products.map((product, index) => [{
      text: `${index + 1}. ${customerProductLabel(product)}`,
      callback_data: `catalog:product:${product.id}`,
    }]);
    rows.push(navigationRow);
    await deliverCommandReply(conversation, `${text}\n\nI. Inicio · R. Retornar`, {
      replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
      channel,
    });
  }

  async function showMergeProposal(input: {
    candidateOrder: { id: string; orderNumber: string; items: unknown; totalAmount: number };
    cart: { items: unknown };
    stack?: string[];
    prefix?: string;
  }) {
    const candidateItems = input.candidateOrder.items as Array<{ name: string; presentation?: string | null; quantity: number }>;
    const cartItems = input.cart.items as Array<{ name: string; presentation?: string | null; quantity: number }>;
    const mergeState = enterMenuState(currentState, {
      currentState: "menu:order_merge",
      activeStep: "awaiting_merge_confirmation",
      scope: `order:merge:${input.candidateOrder.id}`,
      numericOptions: [`order:merge:confirm:${input.candidateOrder.id}`, "order:merge:keep"],
      stack: input.stack,
    });
    await updateState({
      ...mergeState,
      mergeCandidateOrderId: input.candidateOrder.id,
      mergeCandidateOrderNumber: input.candidateOrder.orderNumber,
    });
    const orderSummary = candidateItems.map((item) =>
      `• ${[item.name, item.presentation].filter(Boolean).join(" — ")} x${item.quantity}`
    ).join("\n");
    const cartSummary = cartItems.map((item) =>
      `• ${[item.name, item.presentation].filter(Boolean).join(" — ")} x${item.quantity}`
    ).join("\n");
    const rows = [
      [{ text: "1. ✅ Sí, editar y combinar", callback_data: `order:merge:confirm:${input.candidateOrder.id}` }],
      [{ text: "2. Mantener mi carrito", callback_data: "order:merge:keep" }],
      navigationRow,
    ];
    const text = `${input.prefix ? `${input.prefix}\n\n` : ""}` +
      `Ya tienes tres pedidos activos. ¿Deseas editar el pedido N° ${input.candidateOrder.orderNumber} y combinarlo con este carrito?\n\n` +
      `*Pedido N° ${input.candidateOrder.orderNumber}:*\n${orderSummary}\n\n*Carrito actual:*\n${cartSummary}\n\n` +
      `1. Sí, editar y combinar\n2. No, mantener mi carrito\n\nI. Inicio · R. Retornar`;
    await deliverCommandReply(conversation, text, {
      replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
      channel,
    });
  }

  if (command.startsWith("catalog:product:")) {
    const productId = command.slice("catalog:product:".length);
    const product = await getProductForCustomer(organizationId, productId);
    if (!product) {
      await deliverCommandReply(conversation, "Este producto ya no está disponible. Selecciona otra opción.", { channel });
      await showCategories();
      return { handled: true };
    }
    await updateState({
      ...enterMenuState(currentState, {
        currentState: "cart:awaiting_quantity",
        activeStep: "awaiting_product_quantity",
        scope: `cart:quantity:${product.id}`,
        numericOptions: [],
      }),
      selectedProductId: product.id,
      catalogCategoryId: product.categoryId,
    });
    await deliverCommandReply(
      conversation,
      `¿Cuántas unidades de ${customerProductLabel(product)} deseas agregar? Escribe un número.`,
      { channel }
    );
    return { handled: true };
  }

  async function navigateTo(scope: string, stack?: string[]): Promise<{ handled: boolean }> {
    if (scope === "menu:main") {
      await showMainMenu();
      return { handled: true };
    }
    if (scope === "menu:catalog") {
      await showCategories(stack);
      return { handled: true };
    }
    if (scope === "menu:promos") {
      return processSlashCommand({ ...input, command: "menu:promociones", navigationStack: stack });
    }
    if (scope === "menu:recommended") {
      return processSlashCommand({ ...input, command: "menu:mas_vendidos", navigationStack: stack });
    }
    if (scope === "menu:cart") {
      return processSlashCommand({ ...input, command: "menu:carrito", navigationStack: stack });
    }
    if (scope === "menu:orders") {
      return processSlashCommand({ ...input, command: "menu:pedidos", navigationStack: stack });
    }
    if (scope.startsWith("catalog:category:")) {
      return processSlashCommand({ ...input, command: scope as `catalog:category:${string}`, navigationStack: stack });
    }
    if (scope.startsWith("order:detail:")) {
      return processSlashCommand({ ...input, command: scope as `order:detail:${string}`, navigationStack: stack });
    }
    return { handled: true };
  }

  if (command === "catalog:return" || command === "nav:back" || command === "catalog:home" || command === "nav:home") {
    const decision = resolveMenuInput(currentState, {
      type: command === "catalog:return" || command === "nav:back" ? "back" : "home",
    });
    if (decision.kind === "navigate") return navigateTo(decision.scope, decision.stack);
    return { handled: true };
  }
  let categoryId: string | null = null;
  if (command.startsWith("catalog:category:")) categoryId = command.slice("catalog:category:".length);
  if (command.startsWith("catalog:number:")) {
    const number = Number(command.slice("catalog:number:".length));
    const decision = resolveMenuInput(currentState, { type: "number", value: number });
    if (decision.kind === "action") {
      return processSlashCommand({ ...input, command: decision.action as SlashCommandType });
    }
    return { handled: true };
  }
  if (categoryId) {
    try {
      const products = await listCatalogProducts(organizationId, categoryId);
      await updateState({
        ...enterMenuState(currentState, {
          currentState: "menu:catalog",
          activeStep: "viewing_category",
          scope: `catalog:category:${categoryId}`,
          numericOptions: products.map((product) => `catalog:product:${product.id}`),
          stack: input.navigationStack,
        }),
        catalogCategoryId: categoryId,
        catalogProductIds: products.map((product) => product.id),
      });
      const text = products.length
        ? `🛍️ *Productos*:\n${products.map((p, index) => `${index + 1}. ${customerProductLabel(p)} — $${p.price.toLocaleString("es-CL")} CLP`).join("\n")}\n\nSelecciona un producto.`
        : "Esta categoría no tiene productos activos.";
      const productRows = products.map((product, index) => [{
        text: `${index + 1}. ${customerProductLabel(product)}`,
        callback_data: `catalog:product:${product.id}`,
      }]);
      productRows.push(navigationRow);
      await deliverCommandReply(conversation, `${text}\n\nI. Inicio · R. Retornar`, {
        replyMarkup: isTelegram ? { inline_keyboard: productRows } : undefined,
        channel,
      });
    } catch { await showCategories(); }
    return { handled: true };
  }

  if (command === "order:merge:keep") {
    await deliverCommandReply(conversation, "Conservamos tu carrito y tus tres pedidos sin cambios.", { channel });
    const stack = Array.isArray(currentState.menu_stack)
      ? currentState.menu_stack.filter((entry): entry is string => typeof entry === "string").slice(0, -1)
      : ["menu:main", "menu:cart"];
    return processSlashCommand({ ...input, command: "menu:carrito", navigationStack: stack });
  }

  if (command.startsWith("order:merge:confirm:")) {
    const candidateOrderId = command.slice("order:merge:confirm:".length);
    const result = await mergeLatestOrderIntoActiveCart({ organizationId, conversationId, candidateOrderId });
    const stack = Array.isArray(currentState.menu_stack)
      ? currentState.menu_stack.filter((entry): entry is string => typeof entry === "string").slice(0, -1)
      : ["menu:main", "menu:cart"];
    if (result.ok) {
      await deliverCommandReply(
        conversation,
        `✅ Combinamos el pedido N° ${result.order.orderNumber} con tu carrito. Los productos repetidos quedaron sumados en una sola línea.`,
        { channel }
      );
      return processSlashCommand({ ...input, command: "menu:carrito", navigationStack: stack });
    }
    const errorText = result.error === "merge_limit_exceeded"
      ? `No se pudo combinar: un producto suma ${result.requested} unidades y el máximo es ${result.limit}. Ajusta las cantidades.`
      : result.error === "merge_stock_changed"
        ? `No se pudo combinar ${result.productName}: disponibilidad ${result.available}, solicitadas ${result.requested}.`
        : result.error === "active_cart_missing"
          ? "El carrito ya no está activo."
          : result.error === "invalid_order_items"
            ? "El pedido contiene artículos que no pueden combinarse."
            : "La cola de pedidos cambió. Prepararé una propuesta actualizada.";
    await deliverCommandReply(conversation, errorText, { channel });
    if (result.error === "active_cart_missing") {
      return processSlashCommand({ ...input, command: "menu:pedidos", navigationStack: ["menu:main"] });
    }
    return processSlashCommand({ ...input, command: "cart:checkout", navigationStack: stack });
  }

  if (command === "order:cancel:active") {
    const activeOrders = await listActiveOrders({ organizationId, contactId: conversation.contactId });
    if (activeOrders.length > 0) {
      const result = await cancelActiveOrder({ organizationId, conversationId, orderId: activeOrders[0]!.id });
      await deliverCommandReply(
        conversation,
        result.ok
          ? `✅ El pedido N° ${result.order.orderNumber} fue cancelado y sus unidades volvieron al stock.`
          : "Este pedido ya no está activo o no puede cancelarse.",
        { channel }
      );
      return processSlashCommand({
        ...input,
        command: "menu:pedidos",
        navigationStack: ["menu:main"],
      });
    }
    await clearActiveCart({ organizationId, conversationId });
    await deliverCommandReply(conversation, "🗑️ No tenías un pedido formal activo, pero vaciamos tu carrito de compras.", { channel });
    return processSlashCommand({ ...input, command: "menu:carrito" });
  }

  const orderCommand = command.match(/^order:(detail|refresh|edit|cancel):(.+)$/);
  if (orderCommand) {
    const action = orderCommand[1];
    const orderId = orderCommand[2]!;
    if (action === "edit") {
      const result = await editOrderAsCart({ organizationId, conversationId, orderId });
      if (!result.ok) {
        const text = result.error === "active_cart_not_empty"
          ? "Ya tienes un carrito con artículos. Confírmalo o vacíalo antes de editar este pedido."
          : "Este pedido ya no está activo o no puede editarse.";
        await deliverCommandReply(conversation, text, { channel });
        return { handled: true };
      }
      await deliverCommandReply(
        conversation,
        `✏️ El pedido N° ${result.order.orderNumber} ahora es un carrito editable. Puedes agregar más productos.`,
        { channel }
      );
      await showCategories(["menu:main"]);
      return { handled: true };
    }
    if (action === "cancel") {
      const result = await cancelActiveOrder({ organizationId, conversationId, orderId });
      await deliverCommandReply(
        conversation,
        result.ok
          ? `✅ El pedido N° ${result.order.orderNumber} fue cancelado y sus unidades volvieron al stock.`
          : "Este pedido ya no está activo o no puede cancelarse.",
        { channel }
      );
      return processSlashCommand({
        ...input,
        command: "menu:pedidos",
        navigationStack: ["menu:main"],
      });
    }

    const order = await getOrderForCustomer({ organizationId, contactId: conversation.contactId, orderId });
    if (!order) {
      await deliverCommandReply(conversation, "No encontré ese pedido.", { channel });
      return processSlashCommand({ ...input, command: "menu:pedidos", navigationStack: ["menu:main"] });
    }
    const isActive = ACTIVE_ORDER_STATUSES.includes(order.status);
    const numericOptions = isActive
      ? [`order:refresh:${order.id}`, `order:edit:${order.id}`, `order:cancel:${order.id}`]
      : [`order:refresh:${order.id}`];
    await updateState(enterMenuState(currentState, {
      currentState: "menu:order_detail",
      activeStep: "viewing_order_detail",
      scope: `order:detail:${order.id}`,
      numericOptions,
      stack: input.navigationStack,
    }));
    const items = order.items as Array<{
      name: string;
      presentation: string | null;
      quantity: number;
      unitPrice: number;
    }>;
    const detail = items.map((item) =>
      `• ${[item.name, item.presentation].filter(Boolean).join(" — ")} x${item.quantity}: $${(item.quantity * item.unitPrice).toLocaleString("es-CL")} CLP`
    ).join("\n");
    const optionsText = isActive
      ? "1. Ver estado actualizado\n2. Editar pedido\n3. Cancelar pedido"
      : "1. Ver estado actualizado";
    const rows = isActive
      ? [
          [{ text: "1. 🔄 Ver estado actualizado", callback_data: `order:refresh:${order.id}` }],
          [{ text: "2. ✏️ Editar pedido", callback_data: `order:edit:${order.id}` }],
          [{ text: "3. ❌ Cancelar pedido", callback_data: `order:cancel:${order.id}` }],
          navigationRow,
        ]
      : [
          [{ text: "1. 🔄 Ver estado actualizado", callback_data: `order:refresh:${order.id}` }],
          navigationRow,
        ];
    await deliverCommandReply(
      conversation,
      `📋 *Pedido N° ${order.orderNumber}*\nEstado: ${order.status}\n\n${detail}\n\n*Total:* $${order.totalAmount.toLocaleString("es-CL")} CLP\n\n${optionsText}\n\nI. Inicio · R. Retornar`,
      { replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined, channel }
    );
    return { handled: true };
  }

  if (command === "cart:clear") {
    await clearActiveCart({ organizationId, conversationId });
    await deliverCommandReply(conversation, "🗑️ Tu carrito quedó vacío.", { channel });
    return processSlashCommand({ ...input, command: "menu:carrito" });
  }

  if (command === "cart:checkout") {
    const result = await confirmarPedido({ organizationId, conversationId });
    if (!result.ok) {
      if (result.error === "active_order_limit") {
        await showMergeProposal({
          candidateOrder: result.candidateOrder,
          cart: result.cart,
          stack: input.navigationStack,
        });
        return { handled: true };
      }
      const text = result.error === "stock_changed"
          ? `Cambió el stock. Disponibilidad actual: ${result.available}; solicitadas: ${result.requested}.`
          : result.error === "tenant_limit_exceeded"
            ? `El máximo permitido es ${result.limit} unidades por producto.`
            : "No pudimos confirmar el pedido porque el carrito está vacío o contiene datos inválidos.";
      await deliverCommandReply(conversation, text, { channel });
      return { handled: true };
    }
    if (result.priceChanges?.length) {
      await deliverCommandReply(conversation, renderPriceDisclosure(result.priceChanges, result.order.totalAmount), { channel });
    }
    await deliverCommandReply(conversation, `✅ Pedido confirmado. Número: ${result.order.orderNumber}. Total definitivo: $${result.order.totalAmount.toLocaleString("es-CL")} CLP.`, { channel });
    return processSlashCommand({
      ...input,
      command: `order:detail:${result.order.id}`,
      navigationStack: ["menu:main", "menu:orders"],
    });
  }

  switch (command) {
    case "start":
    case "reset": {
      console.log(`[debug] processSlashCommand: case start - updating conversation`);
      await db
        .update(schema.conversation)
        .set({
          stateMetadata: enterMenuState({}, {
            currentState: "menu:main",
            activeStep: "main_menu",
            scope: "menu:main",
            numericOptions: [
              "menu:categorias", "menu:promociones", "menu:mas_vendidos",
              "menu:carrito", "menu:pedidos", "menu:humano",
            ],
          }),
          handoffAt: null,
          handoffReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            scoped(schema.conversation.organizationId, organizationId),
            eq(schema.conversation.id, conversationId)
          )
        );
      console.log(`[debug] processSlashCommand: case start - conversation updated`);

      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      console.log(`[debug] processSlashCommand: case start - fetching profile`);

      const profile = input.profile !== undefined
        ? input.profile
        : (await db
            .select()
            .from(schema.agentProfile)
            .where(scoped(schema.agentProfile.organizationId, organizationId))
            .limit(1))[0];
      console.log(`[debug] processSlashCommand: case start - profile fetched`);

      const welcomeText = profile?.greeting?.trim()
        ? profile.greeting.trim()
        : `¡Hola! Soy ${profile?.name || "tu asistente"} de VentaMaxIA. 🤖\n\n` +
          `He reiniciado la conversación. ¿En qué te puedo ayudar hoy?\n\n` +
          `Puedes escribirme lo que buscas o elegir una opción del menú.`;

      const isTelegram = true;
      console.log(`[debug] processSlashCommand: calling deliverCommandReply for /start`);
      if (isTelegram) {
        await deliverCommandReply(conversation, welcomeText, { replyMarkup: buildMainMenuMarkup(), channel });
      } else {
        await deliverCommandReply(conversation, welcomeText, { channel });
      }
      console.log(`[debug] processSlashCommand: deliverCommandReply completed!`);
      return { handled: true };
    }

    case "menu": {
      await showMainMenu();
      return { handled: true };
    }

    case "menu:categorias": {
      await showCategories(input.navigationStack);
      return { handled: true };
    }

    case "menu:promociones": {
      const productos = await buscarProductos({ organizationId, query: "promo" });
      await showProductMenu({
        title: "⚡ *Promociones del Día*:",
        emptyText: "Por el momento no hay promociones activas registradas.",
        products: productos,
        currentState: "menu:promos",
        activeStep: "viewing_promos",
        scope: "menu:promos",
        stack: input.navigationStack,
      });
      return { handled: true };
    }

    case "menu:mas_vendidos": {
      const productos = await buscarProductos({ organizationId, query: "*" });
      await showProductMenu({
        title: "⭐ *Productos Más Vendidos / Recomendados*:",
        emptyText: "No hay productos recomendados configurados.",
        products: productos,
        currentState: "menu:recommended",
        activeStep: "viewing_recommended",
        scope: "menu:recommended",
        stack: input.navigationStack,
      });
      return { handled: true };
    }

    case "menu:carrito": {
      const cartRows = await db
        .select()
        .from(schema.cart)
        .where(
          scoped(
            schema.cart.organizationId,
            organizationId,
            and(eq(schema.cart.conversationId, conversationId), eq(schema.cart.status, "active"))
          )
        )
        .limit(1);

      const cart = cartRows[0];
      const items = (cart?.items as Array<{ name: string; quantity: number; unitPrice: number }>) ?? [];
      const numericOptions = items.length > 0
        ? ["cart:checkout", "menu:categorias", "cart:clear"]
        : ["menu:categorias"];
      await updateState(enterMenuState(currentState, {
        currentState: "menu:cart",
        activeStep: "viewing_cart",
        scope: "menu:cart",
        numericOptions,
        stack: input.navigationStack,
      }));
      if (items.length === 0) {
        const rows = [
          [{ text: "1. 🛍️ Seguir comprando", callback_data: "menu:categorias" }],
          navigationRow,
        ];
        await deliverCommandReply(conversation, "🛒 Tu carrito de compras está vacío actualmente.\n\n1. Seguir comprando\n\nI. Inicio · R. Retornar", {
          replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
          channel,
        });
      } else {
        const total = items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
        const text =
          `🛒 *Tu Carrito Actual*:\n` +
          items.map((i) => `• ${i.name} x${i.quantity}: $${(i.quantity * i.unitPrice).toLocaleString("es-CL")} CLP`).join("\n") +
          `\n\n*Total:* $${total.toLocaleString("es-CL")} CLP\n\n` +
          `1. Confirmar compra\n2. Seguir comprando\n3. Vaciar carrito\n\nI. Inicio · R. Retornar`;
        const rows = [
          [{ text: "1. ✅ Confirmar compra", callback_data: "cart:checkout" }],
          [{ text: "2. 🛍️ Seguir comprando", callback_data: "menu:categorias" }],
          [{ text: "3. 🗑️ Vaciar carrito", callback_data: "cart:clear" }],
          navigationRow,
        ];
        await deliverCommandReply(conversation, text, {
          replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
          channel,
        });
      }
      return { handled: true };
    }

    case "menu:pedidos": {
      const orderRows = await listActiveOrders({ organizationId, contactId: conversation.contactId });
      const orderState = enterMenuState(currentState, {
        currentState: "menu:orders",
        activeStep: "viewing_orders",
        scope: "menu:orders",
        numericOptions: orderRows.map((order) => `order:detail:${order.id}`),
        stack: input.navigationStack,
      });
      await updateState(orderState);
      if (orderRows.length === 0) {
        await deliverCommandReply(conversation, "📋 No tienes pedidos activos.\n\nI. Inicio · R. Retornar", {
          replyMarkup: isTelegram ? { inline_keyboard: [navigationRow] } : undefined,
          channel,
        });
        return { handled: true };
      }
      if (orderRows.length === 1) {
        return processSlashCommand({
          ...input,
          command: `order:detail:${orderRows[0]!.id}`,
          conversation: { ...conversation, stateMetadata: orderState },
          navigationStack: orderState.menu_stack as string[],
        });
      }
      const rows = orderRows.map((order, index) => [{
        text: `${index + 1}. Pedido N° ${order.orderNumber}`,
        callback_data: `order:detail:${order.id}`,
      }]);
      rows.push(navigationRow);
      const text = `📋 *Tus Pedidos Activos*:\n${orderRows.map((order, index) =>
        `${index + 1}. N° ${order.orderNumber} — $${order.totalAmount.toLocaleString("es-CL")} CLP — ${order.status}`
      ).join("\n")}\n\nSelecciona un pedido.\n\nI. Inicio · R. Retornar`;
      await deliverCommandReply(conversation, text, {
        replyMarkup: isTelegram ? { inline_keyboard: rows } : undefined,
        channel,
      });
      return { handled: true };
    }

    case "humano":
    case "menu:humano": {
      await updateState({ current_state: "handoff:humano", active_step: "awaiting_human" });
      const profileRows = await db
        .select()
        .from(schema.agentProfile)
        .where(scoped(schema.agentProfile.organizationId, organizationId))
        .limit(1);
      const profile = profileRows[0];
      const humanAvailable = profile?.humanAvailable ?? true;

      if (humanAvailable) {
        const responseText = `Un agente humano revisará tu solicitud a la brevedad. Gracias por comunicarte con nosotros. 👋`;
        await deliverCommandReply(conversation, responseText);
        await applyHandoff(conversationId, organizationId, "cliente");
      } else {
        const responseText = `En este momento no contamos con un agente humano disponible en línea. Hemos tomado nota de tu solicitud para nuestro equipo, pero mientras tanto ¡puedes seguir consultándome cualquier duda o catálogo! 🙏`;
        await deliverCommandReply(conversation, responseText);
      }
      return { handled: true };
    }
  }
  return { handled: false };
}

export async function processPendingProductQuantity(input: {
  conversation: Conversation;
  text: string;
  lastInboundExternalId?: string | null;
}): Promise<boolean> {
  const state = (input.conversation.stateMetadata ?? {}) as Record<string, unknown>;
  if (state.current_state !== "cart:awaiting_quantity") return false;
  const organizationId = input.conversation.organizationId;
  const channel = "telegram" as const;
  const productId = typeof state.selectedProductId === "string" ? state.selectedProductId : null;
  const quantity = parsePositiveInteger(input.text);
  if (!productId) return false;
  if (quantity === null) {
    await deliverCommandReply(input.conversation, "Escribe una cantidad válida usando un número entero mayor que cero.", { channel });
    return true;
  }
  const result = await addProductToCart({
    organizationId, conversationId: input.conversation.id, productId, quantity,
  });
  if (!result.ok) {
    const message = result.error === "tenant_limit_exceeded"
      ? `Puedes agregar como máximo ${result.limit} unidades de este producto.`
      : result.error === "insufficient_stock"
        ? `La cantidad solicitada no está disponible. Disponibilidad actual: ${result.available}.`
        : result.error === "product_not_found"
          ? "Este producto ya no está disponible. Selecciona otra opción."
          : "No pudimos agregar el producto al carrito. Intenta nuevamente.";
    await deliverCommandReply(input.conversation, message, { channel });
    if (result.error === "product_not_found") {
      const { selectedProductId: _selected, ...cleanState } = state;
      await getDb().update(schema.conversation).set({
        stateMetadata: enterMenuState(cleanState, {
          currentState: "menu:catalog",
          activeStep: "viewing_catalog",
          scope: "menu:catalog",
          numericOptions: [],
        }),
        updatedAt: new Date(),
      }).where(and(scoped(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, input.conversation.id)));
    }
    return true;
  }
  const { selectedProductId: _selected, ...cleanState } = state;
  const previousStack = Array.isArray(cleanState.menu_stack)
    ? cleanState.menu_stack.filter((entry): entry is string => typeof entry === "string").slice(0, -1)
    : ["menu:main"];
  const cartState = enterMenuState({ ...cleanState, menu_stack: previousStack }, {
    currentState: "menu:cart",
    activeStep: "viewing_cart",
    scope: "menu:cart",
    numericOptions: ["cart:checkout", "menu:categorias", "cart:clear"],
  });
  await getDb().update(schema.conversation).set({
    stateMetadata: cartState,
    updatedAt: new Date(),
  }).where(and(scoped(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, input.conversation.id)));
  await deliverCommandReply(
    input.conversation,
    `✅ Agregamos ${customerProductLabel(result.product)}, cantidad ${quantity}, a tu carrito.\n\n🛒 Carrito: ${result.units} productos · Total: $${result.totalAmount.toLocaleString("es-CL")} CLP`,
    { channel }
  );
  await processSlashCommand({
    command: "menu:carrito",
    conversation: { ...input.conversation, stateMetadata: cartState },
    lastInboundExternalId: input.lastInboundExternalId,
    navigationStack: cartState.menu_stack,
  });
  return true;
}

/** Procesa pedidos naturales sólo cuando el producto tiene una única presentación coincidente. */
export async function processNaturalAddToCart(input: {
  conversation: Conversation;
  text: string;
  lastInboundExternalId?: string | null;
}): Promise<boolean> {
  const request = parseNaturalAddToCart(input.text);
  if (!request) return false;

  const { conversation } = input;
  const state = (conversation.stateMetadata ?? {}) as Record<string, unknown>;

  let products = (await buscarProductos({
    organizationId: conversation.organizationId,
    query: request.query,
  })) || [];

  const genericTokens = ["botella", "botellas", "unidad", "unidades", "producto", "este", "esta", "ese", "esa", "uno", "una", "gato"];
  if (
    Array.isArray(products) &&
    products.length !== 1 &&
    genericTokens.some((tok) => request.query.toLowerCase().includes(tok))
  ) {
    const fallbackId =
      typeof state.selectedProductId === "string"
        ? state.selectedProductId
        : Array.isArray(state.last_searched_product_ids) &&
          typeof state.last_searched_product_ids[0] === "string"
        ? state.last_searched_product_ids[0]
        : null;

    if (fallbackId) {
      const p = await getProductForCustomer(conversation.organizationId, fallbackId);
      if (p) products = [p];
    }
  }

  if (!products || products.length === 0) {
    await deliverCommandReply(
      conversation,
      `No encontré “${request.query}” en el catálogo. Puedes revisar las categorías o escribir el nombre de otra presentación.`,
      { channel: "telegram" }
    );
    return true;
  }
  if (products.length > 1) {
    const options = products.slice(0, 5)
      .map((product) => `• ${customerProductLabel(product)} · $${product.price.toLocaleString("es-CL")} CLP`)
      .join("\n");
    await deliverCommandReply(
      conversation,
      `Encontré varias presentaciones de “${request.query}”. Indícame una para no equivocarme:\n${options}\n\nPor ejemplo: “agrega 2 Cristal lata 350”.`,
      { channel: "telegram" }
    );
    return true;
  }

  const product = products[0]!;
  const result = await addProductToCart({
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    productId: product.id,
    quantity: request.quantity,
  });
  if (result && !result.ok) {
    const message = result.error === "tenant_limit_exceeded"
      ? `Puedes agregar como máximo ${result.limit} unidades de este producto.`
      : result.error === "insufficient_stock"
        ? `La cantidad solicitada no está disponible. Disponibilidad actual: ${result.available}.`
        : "No pudimos agregar ese producto al carrito. Intenta nuevamente.";
    await deliverCommandReply(conversation, message, { channel: "telegram" });
    return true;
  }

  if (result?.ok && result?.product) {
    await deliverCommandReply(
      conversation,
      `✅ Agregamos ${customerProductLabel(result.product)}, cantidad ${request.quantity}, a tu carrito.\n\n🛒 Carrito: ${result.units} productos · Total: $${result.totalAmount.toLocaleString("es-CL")} CLP`,
      { channel: "telegram" }
    );
    await processSlashCommand({
      command: "menu:carrito",
      conversation,
      lastInboundExternalId: input.lastInboundExternalId,
    });
  }
  return true;
}

async function deliverCommandReply(
  conversation: Conversation,
  text: string,
  opts?: { replyMarkup?: unknown; channel?: "telegram" }
): Promise<void> {
  console.log(`[debug] deliverCommandReply started for ${conversation.id}. isTest=${conversation.isTest}`);
  if (conversation.isTest) {
    const db = getDb();
    await db.insert(schema.message).values({
      id: `msg_${Date.now()}`,
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      direction: "out",
      type: "text",
      text,
      status: "sent",
      aiGenerated: true,
    });
    return;
  }

  console.log(`[debug] deliverCommandReply: about to call sendText...`);
  await sendText({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    text,
    aiGenerated: true,
    replyMarkup: opts?.replyMarkup,
    channel: opts?.channel,
    row: { conversation },
  });
  console.log(`[debug] deliverCommandReply: sendText finished!`);
}
