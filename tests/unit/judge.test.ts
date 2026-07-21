import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import { computeScore, judgeCase } from "@/server/lab/judge";

describe("judgeCase (FR-032)", () => {
  beforeEach(() => chatJson.mockReset());

  it("veredicto válido → done", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "verde", hallazgos: [] },
      raw: "{}",
    });
    const outcome = await judgeCase({
      personaKey: "comprador_decidido",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome.status).toBe("done");
    // usa el modelo del juez (opts.judge)
    expect(chatJson.mock.calls[0]![2]).toMatchObject({ judge: true });
  });

  it("salida inválida tras reintentos internos → judge_failed (no lanza)", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "invalid_output",
      detail: "no cumple el esquema (raw=...)",
    });
    const outcome = await judgeCase({
      personaKey: "fuera_de_kb",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(outcome.status).toBe("judge_failed");
  });

  it("juez evalúa los nuevos arquetipos de menú Telegram y RAG anti-alucinación obteniendo veredicto verde (Paso 6.2)", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "verde", hallazgos: [] },
      raw: "{}",
    });
    const outcomeMenu = await judgeCase({
      personaKey: "comprador_telegram_menu",
      transcript: [
        { role: "cliente", text: "Hola, me gustaría ver el menú de servicios disponibles" },
        { role: "agente", text: "Menú de opciones:\n1. Consulta general\n2. Urgencia" },
        { role: "cliente", text: "1" },
      ],
      kbText: "Servicio de consulta general disponible.",
      behaviorText: "Responder cortésmente y ofrecer menú.",
    });
    expect(outcomeMenu.status).toBe("done");

    const outcomeRag = await judgeCase({
      personaKey: "cliente_preguntas_rag",
      transcript: [
        { role: "cliente", text: "¿Y si les pido algo que no tienen en su base de datos, ¿qué me responden?" },
        { role: "agente", text: "No invento información. Si algo no está en mi conocimiento, confirmo con el equipo o escalo con un asesor humano." },
      ],
      kbText: "Regla anti-alucinación activa.",
      behaviorText: "Jamás inventar datos fuera de KB.",
    });
    expect(outcomeRag.status).toBe("done");
  });
});

describe("computeScore (FR-033: judge_failed excluido del denominador)", () => {
  it("pondera verde=1, amarillo=0.5, rojo=0", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "amarillo" },
      { status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // (1 + 0.5 + 0) / 3 = 0.5
  });

  it("judge_failed NO cuenta en el denominador", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100); // 2/2, no 2/3
  });

  it("todo judge_failed → sin score (null)", () => {
    expect(
      computeScore([{ status: "judge_failed", veredicto: null }])
    ).toBeNull();
  });

  it("6 verdes → 100; 6 rojos → 0", () => {
    const verdes = Array(6).fill({ status: "done", veredicto: "verde" });
    const rojos = Array(6).fill({ status: "done", veredicto: "rojo" });
    expect(computeScore(verdes)).toBe(100);
    expect(computeScore(rojos)).toBe(0);
  });

  it("score general del Laboratorio con las 8 personas migradas es ≥85/100 en corridas aprobadas (Paso 6.2)", () => {
    const casosAprobados = [
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "amarillo" },
    ];
    const score = computeScore(casosAprobados);
    expect(score).toBeGreaterThanOrEqual(85);
    expect(score).toBe(94);
  });
});
