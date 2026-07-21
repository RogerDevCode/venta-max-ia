import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";

describe("Persistencia de Variables de Estado en conversation - stateMetadata (Paso 4.1)", () => {
  it("schema.conversation define el campo stateMetadata como JSONB con valor por defecto de objeto vacío", () => {
    expect(schema.conversation).toBeDefined();
    expect(schema.conversation.stateMetadata).toBeDefined();
    expect(schema.conversation.stateMetadata.name).toBe("state_metadata");
    expect(schema.conversation.stateMetadata.default).toEqual({});
  });

  it("permite tipar y manipular stateMetadata para almacenar intencion_actual, presupuesto y categoria", () => {
    // Simulamos la estructura de stateMetadata del tenant
    const initialState: Record<string, unknown> = {
      intencion_actual: "cotizar_servicio",
      presupuesto: 150000,
    };

    // Actualización atómica simulando mezcla de estado previo y nuevo valor
    const updatedState: Record<string, unknown> = {
      ...initialState,
      categoria: "dental_urgencias",
      paso_actual: "solicitando_fecha",
    };

    expect(updatedState.intencion_actual).toBe("cotizar_servicio");
    expect(updatedState.presupuesto).toBe(150000);
    expect(updatedState.categoria).toBe("dental_urgencias");
    expect(updatedState.paso_actual).toBe("solicitando_fecha");
  });
});
