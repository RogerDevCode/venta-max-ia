import { describe, expect, it } from "vitest";
import {
  enterMenuState,
  resolveMenuInput,
  stateKey,
  type MenuStateMetadata,
} from "@/server/ai/menu-fsm";

const states: Array<[string, string, string]> = [
  ["menu:main", "main_menu", "menu:categorias"],
  ["menu:catalog", "viewing_catalog", "catalog:category:cat_1"],
  ["menu:catalog", "viewing_category", "catalog:product:prod_1"],
  ["menu:promos", "viewing_promos", "catalog:product:promo_1"],
  ["menu:recommended", "viewing_recommended", "catalog:product:recommended_1"],
  ["menu:cart", "viewing_cart", "cart:checkout"],
  ["menu:orders", "viewing_orders", "order:detail:ord_1"],
  ["menu:order_detail", "viewing_order_detail", "order:edit:ord_1"],
];

describe("menu FSM transition table", () => {
  it.each(states)("resuelve el número solo contra %s/%s", (currentState, activeStep, action) => {
    const state: MenuStateMetadata = {
      current_state: currentState,
      active_step: activeStep,
      menu_scope: `${currentState}:${activeStep}`,
      menu_stack: ["menu:main", `${currentState}:${activeStep}`],
      numeric_options: [action],
    };
    expect(resolveMenuInput(state, { type: "number", value: 1 })).toEqual({ kind: "action", action });
    expect(resolveMenuInput(state, { type: "number", value: 2 })).toEqual({ kind: "ignore" });
    expect(resolveMenuInput(state, { type: "number", value: 0 })).toEqual({ kind: "ignore" });
  });

  it("no permite que una opción principal se filtre a otro menú", () => {
    const state: MenuStateMetadata = {
      current_state: "menu:promos",
      active_step: "viewing_promos",
      numeric_options: ["menu:categorias"],
    };
    expect(resolveMenuInput(state, { type: "number", value: 1 })).toEqual({ kind: "ignore" });
    expect(resolveMenuInput(state, { type: "action", action: "menu:categorias" })).toEqual({ kind: "ignore" });
  });

  it("acepta cantidades solamente en el paso de cantidad", () => {
    const quantityState = {
      current_state: "cart:awaiting_quantity",
      active_step: "awaiting_product_quantity",
    };
    expect(resolveMenuInput(quantityState, { type: "quantity", value: 3 })).toEqual({ kind: "quantity", value: 3 });
    expect(resolveMenuInput(quantityState, { type: "number", value: 3 })).toEqual({ kind: "ignore" });
    expect(resolveMenuInput({ current_state: "menu:main", active_step: "main_menu" }, { type: "quantity", value: 3 }))
      .toEqual({ kind: "ignore" });
  });

  it("Inicio es global en estados IA y Retornar usa exclusivamente la pila", () => {
    const state: MenuStateMetadata = {
      current_state: "menu:catalog",
      active_step: "viewing_category",
      menu_scope: "catalog:category:cat_1",
      menu_stack: ["menu:main", "menu:catalog", "catalog:category:cat_1"],
    };
    expect(resolveMenuInput(state, { type: "home" })).toEqual({ kind: "navigate", scope: "menu:main" });
    expect(resolveMenuInput(state, { type: "back" })).toEqual({
      kind: "navigate",
      scope: "menu:catalog",
      stack: ["menu:main", "menu:catalog"],
    });
    expect(resolveMenuInput({ current_state: "menu:main", active_step: "main_menu", menu_stack: ["menu:main"] }, { type: "back" }))
      .toEqual({ kind: "ignore" });
    expect(resolveMenuInput({ current_state: "handoff:humano", active_step: "awaiting_human" }, { type: "home" }))
      .toEqual({ kind: "ignore" });
  });

  it("valida acciones de callback contra el estado exacto", () => {
    const state = { current_state: "menu:orders", active_step: "viewing_orders" };
    expect(resolveMenuInput(state, { type: "action", action: "order:detail:ord_1" }))
      .toEqual({ kind: "action", action: "order:detail:ord_1" });
    expect(resolveMenuInput(state, { type: "action", action: "catalog:product:prod_1" }))
      .toEqual({ kind: "ignore" });
  });

  it("construye la clave compuesta y persiste opciones exactas", () => {
    const entered = enterMenuState({}, {
      currentState: "menu:promos",
      activeStep: "viewing_promos",
      scope: "menu:promos",
      numericOptions: ["catalog:product:prod_1"],
    });
    expect(stateKey(entered)).toBe("menu:promos/viewing_promos");
    expect(entered.menu_stack).toEqual(["menu:main", "menu:promos"]);
    expect(entered.numeric_options).toEqual(["catalog:product:prod_1"]);
  });
});
