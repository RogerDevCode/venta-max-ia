import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("actualizar_variable"),
    clave: z.string().min(1),
    valor: z.any(),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("enviar_menu_opciones"),
    titulo: z.string().min(1),
    botones: z
      .array(
        z.object({
          texto: z.string().min(1),
          payload: z.string().min(1),
        })
      )
      .min(1)
      .max(8),
  }),
  z.object({
    action: z.literal("buscar_producto"),
    query: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("agregar_al_carrito"),
    sku: z.string().min(1),
    cantidad: z.number().int().positive().optional(),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("confirmar_pedido"),
    reply: z.string().optional(),
  }),
]);

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
