import { describe, expect, it } from "vitest";
import { PERSONAS, PERSONA_LABELS } from "@/server/lab/personas";

describe("Nuevas Personas Guionadas para el Laboratorio de IA (Paso 6.1)", () => {
  it("PERSONAS contiene los 8 arquetipos guionados incluyendo las 2 nuevas adiciones de Telegram/RAG", () => {
    expect(PERSONAS.length).toBe(8);

    const menuPersona = PERSONAS.find((p) => p.key === "comprador_telegram_menu");
    expect(menuPersona).toBeDefined();
    expect(menuPersona?.label).toBe("Comprador menú Telegram");
    expect(menuPersona?.script).toContain("1");
    expect(menuPersona?.script).toContain("Por favor confirma mi pedido");

    const ragPersona = PERSONAS.find((p) => p.key === "cliente_preguntas_rag");
    expect(ragPersona).toBeDefined();
    expect(ragPersona?.label).toBe("Cliente RAG anti-alucinación");
    expect(ragPersona?.script).toContain("Buenas, necesito información técnica detallada");
  });

  it("PERSONA_LABELS asigna las etiquetas legibles y todas tienen teléfonos sintéticos aislados", () => {
    expect(PERSONA_LABELS["comprador_telegram_menu"]).toBe("Comprador menú Telegram");
    expect(PERSONA_LABELS["cliente_preguntas_rag"]).toBe("Cliente RAG anti-alucinación");

    // Ningún teléfono debe colisionar y todos deben iniciar con prefijo de prueba o 521000...
    const phones = new Set(PERSONAS.map((p) => p.phone));
    expect(phones.size).toBe(8);
    for (const p of PERSONAS) {
      expect(p.phone).toMatch(/^521000000000\d$/);
    }
  });
});
