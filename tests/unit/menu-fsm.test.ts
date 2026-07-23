import { describe, expect, it } from "vitest";
import {
  appendSubmenuNavigation,
  isMenuActionAllowed,
  submenuNavigation,
} from "@/server/ai/menu-fsm";

describe("política FSB de menús", () => {
  it("acepta sólo las acciones válidas para el estado actual", () => {
    expect(isMenuActionAllowed("menu:main", "menu:categorias")).toBe(true);
    expect(isMenuActionAllowed("menu:catalog", "catalog:category:cat_1")).toBe(true);
    expect(isMenuActionAllowed("menu:cart", "catalog:category:cat_1")).toBe(false);
    expect(isMenuActionAllowed("menu:orders", "catalog:home")).toBe(true);
  });

  it("añade Retornar e Inicio como última fila de cada submenú", () => {
    expect(appendSubmenuNavigation({
      inline_keyboard: [[{ text: "Categoría", callback_data: "catalog:category:cat_1" }]],
    }).inline_keyboard.at(-1)).toEqual(submenuNavigation.inline_keyboard[0]);
  });
});
