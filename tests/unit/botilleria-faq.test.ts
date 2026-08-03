import { describe, expect, it } from "vitest";
import { BOTILLERIA_FAQS, BOTILLERIA_FAQ_VERSION, botilleriaFaqId } from "@/server/seed/botilleria-faq";

describe("knowledge base de Botillería STAX Demo", () => {
  it("define 32 FAQ concretas para las dudas comerciales principales", () => {
    expect(BOTILLERIA_FAQ_VERSION).toBe("botilleria-demo-v1");
    expect(BOTILLERIA_FAQS).toHaveLength(32);
    expect(BOTILLERIA_FAQS.map(([question]) => question)).toEqual(expect.arrayContaining([
      "¿Cuál es el horario de atención de Botillería STAX Demo?",
      "¿Qué comunas cubre el delivery de Botillería STAX Demo?",
      "¿Qué medios de pago acepta Botillería STAX Demo?",
      "¿El asistente vende alcohol a menores de edad?",
    ]));
  });

  it("no promete tarifas, stock ni plazos garantizados y sus IDs no se cruzan entre tenants", () => {
    const text = BOTILLERIA_FAQS.flat().join(" ").toLocaleLowerCase("es-CL");
    expect(text).not.toContain("garantizado");
    expect(botilleriaFaqId("org_a", 0)).not.toBe(botilleriaFaqId("org_b", 0));
    expect(botilleriaFaqId("org_a", 31)).toBe("kb_botilleria_demo_org_a_32");
  });
});
