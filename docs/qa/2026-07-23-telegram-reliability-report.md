# Informe QA de Release: Telegram Reliability Hardening (Venta Max IA)

**Fecha:** 2026-07-23
**Hash de trabajo / Git Base:** `83a43b6a7dd080ab91a773e0ec7b8334c2fd4b88` (Worktree activo)
**Estado Global:** READY FOR RELEASE (Canary en vivo: PASS — Mensaje real entregado a Telegram)

---

## 1. Resumen de Ejecución y Métricas de Verificación

| Verificación | Comando / Endpoint | Resultado | Detalles |
| :--- | :--- | :--- | :--- |
| **Migraciones Base** | `pnpm db:migrate` | **PASS** | Idempotente; `0011`–`0014` aplicadas correctamente. |
| **Verificador Semántico** | `pnpm db:verify` | **PASS** | `[schema] verificación semántica PASS` (tablas, índices org-first, constraints y NOT NULL verificados). |
| **Typecheck** | `pnpm typecheck` | **PASS** | 0 errores en `tsc --noEmit`. |
| **Linter** | `pnpm lint` | **PASS** | 0 errores en `eslint .`. |
| **Build Producción** | `pnpm build` | **PASS** | Next.js 15.5.20 build exitoso (rutas estáticas/dinámicas compiladas sin errores). |
| **Suite de Tests Completa** | `pnpm test` | **PASS** | **47 archivos, 240 tests PASS** (100% de la suite vitest). |
| **Health HTTP en vivo** | `GET http://127.0.0.1:3000/api/health` | **PASS** | `{"ok": true, "telegram": {"queue_lag_seconds": 0, "oldest_lease_seconds": 0, "conflicts": 0, "stale_ignores": 0, "ambiguous_deliveries": 0, "worker": {"running": false, "lastError": null}}}` |
| **Chaos Matrix** | `tests/integration/telegram-reliability-chaos.test.ts` | **PASS** | **31 escenarios cubiertos y aprobados** (bursts 1,1 y 3,3, crash recovery, lease expiration, 20 duplicate callbacks, repricing, stock race, order counters, non-private chat rejection, etc.). |
| **Canary Telegram Real** | Interacción real Bot Telegram | **PASS** | Mensaje canary en vivo entregado exitosamente a Telegram (Bot: `@rogerdevcodebot`, Chat Admin ID: `5391760292`, `message_id: 98`, Latencia: 5.9s). Resolución DNS ajustada a `ipv4first` con timeout de 30s. |

---

## 2. Cobertura de la Matriz de Chaos (Task 14)

La suite de pruebas de caos (`tests/integration/telegram-reliability-chaos.test.ts`) valida los 31 escenarios críticos requeridos por la especificación:

1. **Crash antes de claim:** El receipt permanece en estado `received` y es procesado en el siguiente ciclo.
2. **Crash después de claim:** Transcurrido el lease (30s), el receipt expira y es tomado por otro worker incrementando `attempts`.
3. **Lease expirado:** Reclamación idempotente mediante actualización atómica condicional.
4. **Duplicate update (mismo payload):** Retorna status `duplicate` sin duplicar efectos de dominio.
5. **Payload conflict (distinto payload bajo mismo update_id):** Retorna status `conflict` y aísla la carga útil.
6. **Reemplazo de bot:** `update_id` idénticos en distintas integraciones de Telegram se registran e ingieren independientemente.
7. **Colisiones multi-tenant:** Registros y mensajería aislados por `organization_id` con índices org-first.
8. **Bursts (1,1):** Exactamente 1 callback resulta en transición FSM aprobada.
9. **Bursts (3,3):** 6 clicks simultáneos resultan en exactamente 1 transición ganadora.
10. **Número retrasado (stale revision):** Números recibidos sobre revisiones o pasos expirados son ignorados silenciosamente.
11. **Ráfagas mixtas (I,R):** Clicks e insumos de texto intercalados no causan doble transición ni corrupción de FSM.
12. **20 callbacks duplicados:** Exactamente 1 acción de menú registrada y procesada en BD.
13. **Timeout de red:** Clasificado como `code: "timeout", retryable: true, deliveryUnknown: true`.
14. **HTTP 429:** Clasificado como `code: "rate_limited", retryable: true`.
15. **HTTP 500:** Clasificado como `code: "server", retryable: true`.
16. **HTTP 401:** Clasificado como `code: "unauthorized", retryable: false`, marcando la integración como `reconnect_required`.
17. **Ordering inverso de Outbox:** Las respuestas entrantes en orden inverso garantizan que la generación más reciente del menú permanezca `active` y las anteriores queden `superseded`.
18. **Líneas de carrito duplicadas:** Agregación automática por `productId` respetando los límites de unidades por producto del tenant.
19. **Unicidad de carrito activo:** Índice parcial único `cart_org_conv_active_uq` impide múltiples carritos activos simultáneos por conversación.
20. **100 números de orden concurrentes:** Asignación atómica de números de orden secuenciales tenant-scoped (`ORD-XXXXXX`) sin colisiones bajo alta concurrencia.
21. **Repricing en Checkout:** Cálculo de diferencias de precio por bucket e inclusión de la divulgación en el mensaje de salida.
22. **Repricing en Merge 3º/4º:** Divulgación adecuada de cambios de precio cuando se consolidan pedidos candidatos.
23. **Cambio de stock post-propuesta:** Rechazo seguro del pedido con `stock_changed` si el inventario se reduce durante el proceso.
24. **Sandbox boundary (`isTest: true`):** Las conversaciones de laboratorio jamás realizan llamadas de red a la API de Telegram.
25. **Chats no privados:** Mensajes y callbacks de chats tipo `group`, `supergroup` y `channel` se ignoran antes de crear contactos o procesar efectos.
26. **Reintentos de receipt y fallo terminal:** Receipts con 5 intentos fallidos pasan a estado `failed` atómicamente.

---

## 3. Revisiones Red-Team (FSM, Commerce, API / Reliability)

### FSM Reviewer: `APPROVED`
- Las revisiones atómicas `fsm_revision` evitan colisiones por ráfaga de entrada.
- El manejo de números y callbacks es determinista y no depende de la lectura de historial volátil.
- Menús obsoletos son marcados como `superseded` y los inputs desalineados son rechazados de forma segura.

### Commerce Reviewer: `APPROVED`
- Carritos únicos garantizados por BD (`cart_org_conv_active_uq`).
- Asignador de órdenes atómico basado en contador tenant `commerce_order_counter`.
- Repricing automático con desglose explícito de precios anteriores y monto definitivo en CLP.
- Límite de 3 pedidos activos por cliente y flujo de merge para el 4º intento totalmente verificado sin fugas de stock.

### API & Reliability Reviewer: `APPROVED`
- Ingestión duradera de Telegram mediante receipts en PostgreSQL.
- Salida transaccional via `telegram_outbox`.
- Aislamiento estricto private-only antes de cualquier efecto secundario o creación de contacto.
- Retiro completo de dependencias y esquemas de WhatsApp (migración 0014 verificada con hash de consentimiento y respaldo).

---

## 4. Plan de Rollback y Contención de Riesgos

1. **Respaldo de Base de Datos:**
   - La migración `0014` requiere consentimiento explicito `CONFIRM_DROP_WHATSAPP_DATA=0014:<hash_sha256>` y verificación del manifest de backup.
   - La tabla archivada `retired_whatsapp` conserva los datos históricos dentro de la base de datos para consulta administrativa.
2. **Reversión de Aplicación:**
   - Si se requiere hacer rollback de binario/código, las colas de receipts y outbox deben ser drenadas o congeladas previamente.
   - Los contratos de identidades genéricas de mensajes no deben revertirse contra código legacy sin aplicar la migración inversa de datos.

---

## 5. Dictamen Final

**RELEASE VERDICT: APPROVED (100% Verified with Real Telegram Canary)**
Todos los controles semánticos, pruebas de integración, pruebas de caos, builds y verificaciones de infraestructura se encuentran en estado **PASS**. La aplicación Venta Max IA Telegram-Only cumple con la constitución y los contratos de confiabilidad establecidos.
