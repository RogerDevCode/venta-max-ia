# Guion E2E — US5: Conexión del número (wizard)

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock
> (`META_GRAPH_BASE_URL` → wa-mock/graph).

## Camino feliz

1. Abrir `/settings/whatsapp`.
   ✅ El wizard explica los DOS orígenes del token (modo directo / modo
   agencia Tech Provider).
2. Llenar WABA ID + Phone Number ID + token (sin sufijo `-invalid`) →
   "Probar conexión".
   ✅ "Token válido para +52 …". El botón Guardar se habilita SOLO tras la
   prueba.
3. Guardar.
   ✅ Estado "Conectado" con display number y token …last4; el token quedó
   cifrado en BD (unit test) y se llamó subscribed_apps (best-effort).
4. Sección Webhook:
   ✅ URL COMPLETA con el verify token como segmento + botón copiar; aviso
   informativo (no error) si META_APP_SECRET no está configurado; nota de
   seguridad del token en la URL.

## Caminos infelices

5. Token con sufijo `-invalid` → "Probar conexión".
   ✅ Error claro de token inválido; NO se guarda (la conexión previa queda
   intacta).
6. Webhook GET handshake con verify token correcto → challenge; segmento
   incorrecto → 404 (cubierto también en guion US1).
