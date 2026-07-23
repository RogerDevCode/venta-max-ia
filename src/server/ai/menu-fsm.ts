export type MenuStateMetadata = Record<string, unknown> & {
  current_state?: string;
  active_step?: string;
  menu_scope?: string;
  menu_stack?: string[];
  numeric_options?: string[];
};

export type MenuInput =
  | { type: "home" }
  | { type: "back" }
  | { type: "number"; value: number }
  | { type: "quantity"; value: number }
  | { type: "action"; action: string };

export type MenuDecision =
  | { kind: "action"; action: string }
  | { kind: "navigate"; scope: string; stack?: string[] }
  | { kind: "quantity"; value: number }
  | { kind: "ignore" };

type TransitionRule = {
  exactActions?: readonly string[];
  actionPrefixes?: readonly string[];
  quantity?: boolean;
};

const MAIN_ACTIONS = [
  "menu:categorias",
  "menu:promociones",
  "menu:mas_vendidos",
  "menu:carrito",
  "menu:pedidos",
  "menu:humano",
] as const;

export const MENU_TRANSITIONS: Readonly<Record<string, TransitionRule>> = {
  "menu:main/main_menu": { exactActions: MAIN_ACTIONS },
  "menu:catalog/viewing_catalog": { actionPrefixes: ["catalog:category:"] },
  "menu:catalog/viewing_category": { actionPrefixes: ["catalog:product:"] },
  "menu:promos/viewing_promos": { actionPrefixes: ["catalog:product:"] },
  "menu:recommended/viewing_recommended": { actionPrefixes: ["catalog:product:"] },
  "cart:awaiting_quantity/awaiting_product_quantity": { quantity: true },
  "menu:cart/viewing_cart": {
    exactActions: ["cart:checkout", "menu:categorias", "cart:clear"],
  },
  "menu:orders/viewing_orders": { actionPrefixes: ["order:detail:"] },
  "menu:order_detail/viewing_order_detail": {
    actionPrefixes: ["order:refresh:", "order:edit:", "order:cancel:"],
  },
  "handoff:humano/awaiting_human": {},
};

const DEFAULT_STEPS: Readonly<Record<string, string>> = {
  "menu:main": "main_menu",
  "menu:catalog": "viewing_catalog",
  "menu:promos": "viewing_promos",
  "menu:recommended": "viewing_recommended",
  "menu:cart": "viewing_cart",
  "menu:orders": "viewing_orders",
  "menu:order_detail": "viewing_order_detail",
  "cart:awaiting_quantity": "awaiting_product_quantity",
  "handoff:humano": "awaiting_human",
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

export function stateKey(state: MenuStateMetadata | null | undefined): string {
  const currentState = typeof state?.current_state === "string" ? state.current_state : "menu:main";
  const activeStep = typeof state?.active_step === "string"
    ? state.active_step
    : (DEFAULT_STEPS[currentState] ?? "unknown");
  return `${currentState}/${activeStep}`;
}

function actionAllowed(rule: TransitionRule, action: string, numericOptions: string[]): boolean {
  if (!numericOptions.includes(action)) return false;
  if (rule.exactActions?.includes(action)) return true;
  return Boolean(
    rule.actionPrefixes?.some((prefix) => action.startsWith(prefix) && action.length > prefix.length)
  );
}

export function resolveMenuInput(state: MenuStateMetadata, input: MenuInput): MenuDecision {
  const key = stateKey(state);
  const rule = MENU_TRANSITIONS[key];
  if (!rule) return { kind: "ignore" };

  if (input.type === "home") {
    return key === "handoff:humano/awaiting_human"
      ? { kind: "ignore" }
      : { kind: "navigate", scope: "menu:main" };
  }

  if (input.type === "back") {
    if (key === "menu:main/main_menu") return { kind: "ignore" };
    const stack = strings(state.menu_stack);
    if (stack.length < 2) return { kind: "ignore" };
    const previous = stack.at(-2);
    return previous
      ? { kind: "navigate", scope: previous, stack: stack.slice(0, -1) }
      : { kind: "ignore" };
  }

  if (input.type === "quantity") {
    return rule.quantity && Number.isSafeInteger(input.value) && input.value > 0
      ? { kind: "quantity", value: input.value }
      : { kind: "ignore" };
  }

  const action = input.type === "number"
    ? (Number.isSafeInteger(input.value) && input.value > 0
        ? strings(state.numeric_options)[input.value - 1]
        : undefined)
    : input.action;

  if (!action) return { kind: "ignore" };
  if (action === "nav:home") return resolveMenuInput(state, { type: "home" });
  if (action === "nav:back") return resolveMenuInput(state, { type: "back" });
  return actionAllowed(rule, action, strings(state.numeric_options))
    ? { kind: "action", action }
    : { kind: "ignore" };
}

export function enterMenuState(
  current: MenuStateMetadata,
  input: {
    currentState: string;
    activeStep: string;
    scope: string;
    numericOptions?: string[];
    stack?: string[];
  }
): MenuStateMetadata {
  const previousStack = input.stack ?? strings(current.menu_stack);
  let menuStack: string[];
  if (input.scope === "menu:main") {
    menuStack = ["menu:main"];
  } else {
    const base = previousStack.length > 0 ? previousStack : ["menu:main"];
    menuStack = base.at(-1) === input.scope ? base : [...base, input.scope];
  }
  return {
    ...current,
    current_state: input.currentState,
    active_step: input.activeStep,
    menu_scope: input.scope,
    menu_stack: menuStack,
    numeric_options: input.numericOptions ?? [],
  };
}
