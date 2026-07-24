
/**
 * Gate del entorno de pruebas interno (FR-080).
 * Los mocks de IA solo existen con AI_MOCK_ENABLED=true y fuera de producción;
 * en cualquier otro caso responden 404 incondicional, indistinguible de una
 * ruta inexistente.
 */
export function mockGuard(): Response | null {
  if (process.env.AI_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  return null;
}
