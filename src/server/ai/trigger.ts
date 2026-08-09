import { scheduleAgentTurn } from "@/server/ai/pipeline";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 */
export async function maybeRunAgentTurn(
  organizationId: string,
  conversationId: string,
  immediate = false
): Promise<void> {
  scheduleAgentTurn(organizationId, conversationId, immediate);
}
