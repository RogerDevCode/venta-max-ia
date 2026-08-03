import { describe, expect, it } from "vitest";
import { classifyConversationInput, guardReply } from "@/server/ai/conversation-guard";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

describe("guardas conversacionales de Botillería", () => {
  it("detecta garabatos normalizados sin bloquear consultas comerciales", () => {
    expect(classifyConversationInput("eres un weón")).toBe("offensive");
    expect(classifyConversationInput("W-E-O-N")).toBe("offensive");
    expect(classifyConversationInput("¿Cuánto cuesta una Cristal lata?")).toBeNull();
    expect(classifyConversationInput("hola, quiero algo sin azúcar")).toBeNull();
  });

  it("redirige temas externos evidentes y mantiene el límite amable", () => {
    expect(classifyConversationInput("¿Quién ganó el partido de fútbol?")).toBe("out_of_scope");
    expect(guardReply("offensive", 1)).toContain("Conversemos con respeto");
    expect(guardReply("offensive", 2)).toContain("atención humana");
    expect(guardReply("out_of_scope")).toContain("sólo sobre esta Botillería");
  });

  it("declara catálogo PostgreSQL y FAQ pgvector como fuentes de verdad", () => {
    const prompt = buildAgentSystemPrompt({
      profile: { name: "Botillería STAX", tone: null, instructions: null, escalationRules: null, greeting: null } as never,
      kb: [],
      stages: [],
    });
    expect(prompt).toContain("Sólo responde sobre esta Botillería");
    expect(prompt).toContain("consulta tenant-scoped a PostgreSQL");
    expect(prompt).toContain("FAQ recuperadas por pgvector");
    expect(prompt).toContain("No inventes productos, precios, stock, promociones, delivery ni condiciones");
  });
});
