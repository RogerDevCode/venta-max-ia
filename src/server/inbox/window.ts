/**
 * Ventana de servicio de 24 horas de WhatsApp: solo se puede enviar texto
 * libre dentro de las 24h siguientes al último mensaje ENTRANTE. Una
 * conversación sin entrantes (p. ej. iniciada por plantilla) tiene la
 * ventana cerrada.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

/** Milisegundos restantes de ventana (0 si está cerrada). */
export function windowRemainingMs(
  lastInboundAt: Date | null,
  now: Date = new Date()
): number {
  if (!lastInboundAt) return 0;
  const remaining = WINDOW_MS - (now.getTime() - lastInboundAt.getTime());
  return Math.max(0, remaining);
}
