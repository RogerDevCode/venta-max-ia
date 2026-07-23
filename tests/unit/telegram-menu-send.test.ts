import { describe, expect, it } from "vitest";
import { encodeTelegramMenuMarkup } from "@/server/telegram/menu-store";

describe("Telegram menu emission", () => {
  it("replaces business actions with instance-scoped indexes", () => {
    const result = encodeTelegramMenuMarkup({ inline_keyboard: [[
      { text: "Catálogo", callback_data: "menu:categorias" },
      { text: "Carrito", callback_data: "menu:carrito" },
    ]] }, "tgm_0123456789abcdefghij");
    expect(result.allowedActions).toEqual(["menu:categorias", "menu:carrito"]);
    expect(result.markup.inline_keyboard[0]?.map((button) => button.callback_data)).toEqual([
      "m:tgm_0123456789abcdefghij:0", "m:tgm_0123456789abcdefghij:1",
    ]);
  });

  it("preserves URL buttons and rejects empty callback menus", () => {
    const urlOnly = { inline_keyboard: [[{ text: "Web", url: "https://example.com" }]] };
    expect(() => encodeTelegramMenuMarkup(urlOnly, "tgm_0123456789abcdefghij")).toThrow();
  });
});
