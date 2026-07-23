export type MenuState =
  | "menu:main"
  | "menu:catalog"
  | "menu:promos"
  | "menu:recommended"
  | "menu:cart"
  | "menu:orders";

export const submenuNavigation = {
  inline_keyboard: [[
    { text: "↩ Retornar", callback_data: "catalog:return" },
    { text: "⌂ Inicio", callback_data: "catalog:home" },
  ]],
} as const;

export function appendSubmenuNavigation(
  markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
) {
  return { inline_keyboard: [...markup.inline_keyboard, ...submenuNavigation.inline_keyboard] };
}

export function isMenuActionAllowed(state: unknown, action: string): boolean {
  if (action === "catalog:home" || action === "catalog:return") return true;
  // Menús generados por la FSB/LLM quedan autorizados por la lista durable del
  // menú activo; los payloads de navegación propios sí requieren una transición.
  if (!action.startsWith("menu:") && !action.startsWith("catalog:")) return true;
  if (state === "menu:main") return action.startsWith("menu:");
  if (state === "menu:catalog") return action.startsWith("catalog:category:");
  return false;
}
