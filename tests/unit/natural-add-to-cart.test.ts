import { describe, expect, it } from "vitest";
import { parseNaturalAddToCart, parseSlashCommand } from "@/server/ai/commands";

describe("Reconocimiento de intenciones de agregar al carrito", () => {
  it("parsea frases naturales como 'quiero 1 botella'", () => {
    const res = parseNaturalAddToCart("quiero 1 botella");
    expect(res).not.toBeNull();
    expect(res?.quantity).toBe(1);
    expect(res?.query).toBe("botella");
  });

  it("parsea frases naturales como 'dame 2 merlot'", () => {
    const res = parseNaturalAddToCart("dame 2 merlot");
    expect(res).not.toBeNull();
    expect(res?.quantity).toBe(2);
    expect(res?.query).toBe("merlot");
  });

  it("parsea frases naturales como 'agrega 1 gato negro'", () => {
    const res = parseNaturalAddToCart("agrega 1 gato negro");
    expect(res).not.toBeNull();
    expect(res?.quantity).toBe(1);
    expect(res?.query).toBe("gato negro");
  });

  it("filtra intenciones complejas o de confirmación directa", () => {
    const res = parseNaturalAddToCart("Quiero comprar 2 unidades y confirmar");
    expect(res).toBeNull();
  });
});

describe("Reconocimiento de intenciones de mostrar y cancelar pedido/carro", () => {
  it("detecta intenciones de mostrar carrito/carro", () => {
    expect(parseSlashCommand("ver mi carro")).toBe("menu:carrito");
    expect(parseSlashCommand("ver el carrito")).toBe("menu:carrito");
    expect(parseSlashCommand("mostrar carro")).toBe("menu:carrito");
    expect(parseSlashCommand("que tengo en mi carro")).toBe("menu:carrito");
  });

  it("detecta intenciones de mostrar pedido", () => {
    expect(parseSlashCommand("ver mi pedido")).toBe("menu:pedidos");
    expect(parseSlashCommand("mostrar pedido")).toBe("menu:pedidos");
    expect(parseSlashCommand("estado de mi pedido")).toBe("menu:pedidos");
  });

  it("detecta intenciones de cancelar pedido", () => {
    expect(parseSlashCommand("cancelar mi pedido")).toBe("order:cancel:active");
    expect(parseSlashCommand("anular pedido")).toBe("order:cancel:active");
    expect(parseSlashCommand("cancela mi pedido")).toBe("order:cancel:active");
  });
});

