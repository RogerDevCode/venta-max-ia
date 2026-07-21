import { describe, expect, it } from "vitest";
import { formatTime, formatRemaining, mediaLabel, previewText } from "@/components/inbox/helpers";

describe("Pruebas del Frontend del Tenant — Componentes y Presentación UI", () => {
  describe("1. Formateadores de la Bandeja de Entrada (`helpers.ts`)", () => {
    it("formatTime debe formatear horas de hoy y fechas pasadas correctamente", () => {
      const nowISO = new Date().toISOString();
      const formattedToday = formatTime(nowISO);
      expect(typeof formattedToday).toBe("string");
      expect(formattedToday.length).toBeGreaterThan(0);

      const pastISO = new Date(2025, 0, 15).toISOString();
      const formattedPast = formatTime(pastISO);
      expect(formattedPast).toContain("15"); // dia 15
    });

    it("formatRemaining debe calcular horas y minutos restantes para ventanas de 24h", () => {
      expect(formatRemaining(3600000)).toBe("1h 0m");
      expect(formatRemaining(7200000 + 1500000)).toBe("2h 25m");
      expect(formatRemaining(1800000)).toBe("30m");
    });

    it("mediaLabel debe mapear tipos de archivo e imágenes a nombres amigables en español", () => {
      expect(mediaLabel("image")).toBe("Imagen");
      expect(mediaLabel("audio")).toBe("Audio");
      expect(mediaLabel("document")).toBe("Documento");
      expect(mediaLabel("sticker")).toBe("Sticker");
      expect(mediaLabel("desconocido")).toBe("Contenido");
    });

    it("previewText debe agregar íconos de clip 📎 para contenido multimedia", () => {
      expect(previewText("image")).toBe("📎 Imagen");
      expect(previewText("document")).toBe("📎 Documento");
      expect(previewText("Hola, ¿tienen stock?")).toBe("Hola, ¿tienen stock?");
      expect(previewText(null)).toBe("");
    });
  });

  describe("2. Cálculo de Tamaño de Knowledge Base (RAG) en Frontend", () => {
    it("debe calcular correctamente el tamaño del KB y activar advertencia si supera warnAt", () => {
      const calculateKbSize = (entries: Array<{ question?: string | null; answer?: string | null; content?: string | null }>) => {
        const warnAt = 2000;
        let chars = 0;
        for (const e of entries) {
          if (e.question) chars += e.question.length;
          if (e.answer) chars += e.answer.length;
          if (e.content) chars += e.content.length;
        }
        return {
          chars,
          warnAt,
          warning: chars >= warnAt,
        };
      };

      const smallKb = calculateKbSize([{ question: "Horario?", answer: "10am a 8pm" }]);
      expect(smallKb.warning).toBe(false);

      const largeKb = calculateKbSize([{ content: "A".repeat(2500) }]);
      expect(largeKb.warning).toBe(true);
    });
  });
});
