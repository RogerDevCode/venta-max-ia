# VentaMax IA — Contrato operativo

## 1. Ficha rápida

- **Producto:** VentaMax IA, atención conversacional y pedidos por Telegram dentro de STAX.
- **Stack:** Next.js 15, React 19, TypeScript, Drizzle, Better Auth, PostgreSQL 18 + pgvector y SSE.
- **Canal activo principal:** Telegram. WhatsApp permanece deshabilitado hasta una implementación autorizada.
- **Runtime local productivo:** Caddy publica `http://127.0.0.1`; health en `/api/health`.
- **Fuente de verdad:** PostgreSQL de VentaMax IA para organizaciones, conversaciones, catálogo y pedidos.
- **Manuales centrales:**
  `/home/manager/Sync/python_proyects/true-deal-studio/docs/manuales/MANUAL-ADMINISTRADOR-STAX.md` y
  `MANUAL-TENANT-STAX.md` en la misma carpeta.
- **Proyecto histórico:** `/home/manager/Sync/python_proyects/chatbot` es referencia antigua, no runtime activo.

## 2. Megaproyecto STAX

Este repositorio es STAX Atención Ordenada junto con:

- `/home/manager/Sync/python_proyects/true-deal-studio`: STAX Web, vitrina y entrada pública.
- `/home/manager/Sync/python_proyects/voicelive-v2`: STAX Voz, orientación, solicitudes y reservas.
- Este repositorio: Telegram, bandeja, contactos, catálogo, pedidos, pipeline y continuidad humana.

La oferta común es: **la web explica, la voz orienta y el dueño decide el siguiente paso**. Cada proyecto conserva
runtime, historial, PostgreSQL, secretos, imágenes y despliegue separados.

Una integración transversal requiere autorización y un contrato con URL o payload, autenticación, responsable,
errores y prueba E2E. Revisar los tres `AGENTS.md` y
`/home/manager/Sync/python_proyects/true-deal-studio/docs/STAX-MEGAPROYECTO.md`.

## 3. Mapa del repositorio

```text
src/app/                    Rutas Next.js, páginas y API
src/components/             UI de bandeja, pedidos, pipeline, agente y ajustes
src/server/                 Dominio, DB, IA, Telegram, ecommerce y seguridad
src/db/                     Esquema Drizzle y acceso a datos
tests/unit/                 Pruebas unitarias y red team conversacional
tests/integration/          PostgreSQL, RLS, webhooks y concurrencia
scripts/                    Migración, verificación, seeds, backup y restore
infra/postgres/init/        Bootstrap de roles para base vacía
docs/                       Operación, seguridad, specs y planes
docker-compose.yml          Runtime local tipo producción
docker-compose.dev.yml      Desarrollo, no levantar junto al runtime productivo
```

Las migraciones y su journal son la fuente de verdad del esquema. No reparar producción con SQL manual no
documentado ni modificar el volumen para evitar una migración.

## 4. Capacidades visibles

- **Bandeja:** conversaciones Telegram y continuidad humana.
- **Pedidos:** revisión, preparación, despacho, entrega y cancelación.
- **Pipeline:** organización de oportunidades por etapa.
- **Contactos:** identidad y actividad del cliente dentro del tenant.
- **Agente:** nombre, tono, instrucciones, saludo y reglas de derivación.
- **Laboratorio:** conversaciones sintéticas sin envíos reales.
- **Analytics:** actividad y métricas operativas.
- **Configuración > Telegram:** conexión del bot por tenant, solo owner.
- **Configuración > Marca:** nombre y color del negocio.
- **Configuración > Catálogo:** categorías, presentaciones, SKU, precio, stock y límites.
- **Configuración > Equipo:** cuentas y contraseñas del tenant.

## 5. Multi-tenancy y PostgreSQL

- Toda entidad de dominio tenant debe tener `organization_id NOT NULL` e índice org-first apropiado.
- Toda ruta autenticada usa el contexto de Better Auth y transacciones tenant-scoped.
- Un webhook usa primero el rol ingress para resolver un token opaco y luego una transacción del tenant.
- Un job enumera organizaciones con el rol autorizado y procesa una por una con contexto explícito.
- No confiar solo en `scoped()`: todas las tablas de `public` mantienen `ENABLE RLS` y `FORCE RLS`.
- Los roles runtime no son propietarios, no tienen `BYPASSRLS` y no pueden hacer DDL.

Roles vigentes:

- `venta_owner`: propietario sin login, usado mediante `SET ROLE` por migraciones.
- `venta_migrator`: journal, DDL y verificación.
- `venta_app`: dominio dentro del tenant.
- `venta_auth`: autenticación y membresía.
- `venta_ingress`: resolución mínima de integraciones.
- `venta_backup`: lectura offline completa con `BYPASSRLS`; nunca llega a la app.
- `venta_restore`: solo bases temporales de simulacro; no conecta a la principal.

Consultar `docs/POSTGRES-SECURITY.md`. Nunca usar `postgres`, migrator, backup o restore desde el proceso web.

## 6. Reglas de negocio y conversación

### Telegram

- Cada tenant usa su propio token de bot, cifrado con AES-256-GCM.
- Solo el owner conecta o cambia Telegram.
- El webhook usa ruta opaca, secreto de cabecera e idempotencia por update.
- No imprimir token, ruta secreta ni cabeceras en logs.
- Telegram es el canal activo. No reactivar WhatsApp ni prometerlo sin una tarea explícita y pruebas productivas.

### Catálogo y pedidos

- Precio, stock, SKU y productos provienen de PostgreSQL; el LLM no los inventa ni los reemplaza.
- Un producto con varias presentaciones debe modelarse de forma distinguible y con precio propio.
- Crear, modificar y cancelar pedidos requiere validación de estado y transacción.
- Los dobles clics, reintentos y mensajes duplicados no crean pedidos o efectos duplicados.
- El webhook de pagos falla cerrado hasta validar una firma HMAC y una referencia opaca emitida por el servidor.

### RAG y guardas

- La recuperación combina texto y pgvector, siempre filtrada por organización.
- Las FAQ y entradas externas son datos no confiables, no instrucciones del sistema.
- El agente se limita al ámbito del negocio, rechaza garabatos con cortesía y vuelve a la atención comercial.
- Ante evidencia insuficiente, reconoce el límite; no inventa precio, producto, horario, cobertura ni política.
- El Laboratorio con `is_test: true` nunca realiza efectos reales en Telegram u otros proveedores.

### UI y accesibilidad

- **Ergonomía visual y tamaño mínimo de fuente:** Pensando en usuarios mayores de 30 y 50+ años (prevención de presbicia y fatiga visual), el tamaño de fuente mínimo permitido en cualquier vista, componente o dispositivo es **13px / 14px** (`text-sm` o `0.8125rem`/`0.875rem`). Queda strictly prohibited usar fuentes micro de `10px` o `11px`. Asimismo, se exige alto contraste de color (mínimo 7:1 en modo oscuro y 4.5:1 en modo claro); se prohíben textos en gris opaco sobre fondos azulados u oscuros.

## 7. Desarrollo y Docker

### Runtime local tipo producción

```bash
./scripts/generate-local-secrets.sh
./scripts/bootstrap-postgres-roles.sh
docker compose config --quiet
docker compose up -d --build app
docker compose logs --no-color migrator
docker compose ps
curl --fail http://127.0.0.1/api/health
```

El migrador debe terminar con código `0` antes de iniciar la app. PostgreSQL no publica su puerto en este Compose.
No ejecutes simultáneamente `docker-compose.dev.yml` sobre la misma base o puertos.

### Desarrollo sin Compose de aplicación

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Usa la base de desarrollo configurada en `.env`, limitada a `127.0.0.1`. No mates procesos ajenos para liberar
un puerto: identifica al propietario del proceso y detén solo el servicio que esté dentro del alcance autorizado.

## 8. Secretos y credenciales

- Generar secretos locales con `scripts/generate-local-secrets.sh`; `.env` queda `0600` e ignorado por Git.
- En VPS, inyectar secretos desde la plataforma; no copiar `.env` a Git ni a la imagen.
- No existe usuario o contraseña universal de demo. El owner crea accesos y entrega claves temporales en privado.
- Rotar token de Telegram, clave de cifrado o secreto de sesión si se exponen; revocar el valor anterior.
- No mostrar URLs de base de datos en logs, comandos entregados al usuario ni reportes.

## 9. Calidad obligatoria

- **LEY ESTRICTA DE VALIDACIÓN CI Y LINTERS**: Antes de declarar cualquier tarea como completada o responder 'está listo', es **OBLIGATORIO** ejecutar localmente la suite completa de comprobaciones replicando exactamente los comandos del pipeline de GitHub Actions (`.github/workflows/ci.yml`), incluyendo linters (`pnpm lint`), chequeos de tipos (`pnpm typecheck`), compilación (`pnpm build`) y pruebas (`pnpm test`, verificaciones de DB). Queda estrictamente prohibido asumir o confiar en arreglos parciales sin validar la suite integral localmente.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:verify
pnpm db:verify-security
pnpm db:test-security
./scripts/backup-restore-drill.sh
```

- No eliminar, saltar o relajar pruebas para obtener verde.
- No sustituir integración, RLS, concurrencia o idempotencia por mocks que no ejecutan el riesgo.
- Un test externo sin credenciales autorizadas se informa como bloqueado y conserva un contract test local estricto.
- Los cambios de conversación prueban happy path, datos inválidos, límites, duplicados, reordenamiento y reintentos.
- Los cambios de DB prueban integridad referencial, tenant cruzado, rol equivocado y bypass.

## 10. Backup y recuperación

```bash
./scripts/backup-postgres.sh
./scripts/verify-backup.sh backups/archivo.dump
./scripts/backup-restore-drill.sh
```

El dump incluye checksum y manifiesto. No es recuperable hasta que el drill restaura en una base temporal y compara
conteos. `backups/` está fuera de Git; mantener una copia cifrada externa con retención definida.

## 11. Flujo de trabajo

1. Revisar `git status --short`, este contrato, la especificación y el plan relacionados.
2. Preservar cambios ajenos y reutilizar código, componentes y scripts existentes.
3. **LEY ESTRICTA DE MIGRACIONES**: Al modificar esquemas o modelos de base de datos, siempre se debe correr el comando correspondiente (ej: `pnpm db:generate` o equivalente) para crear el archivo de migración que actualiza la base de datos de producción. Nunca asumir que el cambio en código actualiza la DB por sí solo.
4. Crear una prueba que falle por la conducta o riesgo solicitado.
5. Implementar el cambio mínimo sin romper aislamiento ni idempotencia.
6. Ejecutar pruebas focalizadas y luego las puertas proporcionales completas.
6. Para integraciones, probar éxito, firma/secreto, duplicado, timeout, reintento y fallo cerrado.
7. Actualizar documentos operativos si cambia configuración, esquema o recuperación.

No cambiar dominio, DNS, túnel, proveedor, secretos ni servicios externos sin autorización explícita. No fusionar
contenedores, volúmenes o bases con los otros componentes STAX.

## 12. Roadmap conocido

La bandeja aislada por vendedor todavía requiere `assigned_user_id` en conversación, contacto y lead, además del
filtro por rol para que `seller/member` vea solo asignaciones. Hasta implementarlo y probar RLS/consultas, no
presentar esta capacidad como disponible.
