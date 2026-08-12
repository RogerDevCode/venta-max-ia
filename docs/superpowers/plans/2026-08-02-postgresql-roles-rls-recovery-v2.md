# Venta Max IA PostgreSQL Roles, RLS and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar Venta Max IA a roles mínimos, RLS forzado, secretos obligatorios y recuperación real sin alterar los cambios locales de Botillería actualmente en desarrollo.

**Architecture:** PostgreSQL impone el tenant mediante `organization_id` y contexto local a transacción. Better Auth usa un rol exclusivo para identidad; webhooks resuelven organización con funciones mínimas; datos de dominio usan `venta_app`. Un servicio one-shot migra con `venta_migrator`, y backup/restore operan con credenciales aisladas.

**Tech Stack:** PostgreSQL 18 + pgvector, Node.js 22, TypeScript, Drizzle ORM/postgres-js, Better Auth, Next.js 15, Vitest, Docker Compose, `pg_dump` y `pg_restore`.

## Global Constraints

- Preservar sin editar los cambios locales existentes en Dockerfile, IA, tests de Botillería, seeds y planes no versionados fuera de este plan.
- No modificar migraciones históricas ni hashes aplicados; agregar una nueva migración `0019`.
- `venta_app`, `venta_auth` y `venta_ingress` nunca son owner, superuser ni `BYPASSRLS`.
- Todo acceso tenant usa `set_config(..., true)` dentro de una transacción exterior.
- Better Auth solo puede acceder a identidad, sesiones, membresías y organizaciones mediante `venta_auth`.
- Producción no usa fallbacks para credenciales, auth, cifrado, webhook ni túnel.
- Desarrollo aplica las mismas políticas con secretos aleatorios locales ignorados y permiso `0600`.
- Una tabla nueva sin clasificación RLS hace fallar CI.
- Un restore drill nunca apunta a `vocero`; solo usa una base temporal validada.

---

## File Structure

- `tests/helpers/postgres-isolated.ts`: bases temporales y clientes por rol.
- `infra/postgres/init/00-bootstrap-roles.sh`: bootstrap de un clúster nuevo.
- `scripts/bootstrap-postgres-roles.sh`: reconciliación explícita en volumen existente.
- `drizzle/0019_tenant_rls_foundation.sql`: preflight, funciones, constraints, grants y políticas.
- `src/lib/db/context.ts`: transacciones tenant/ingress/job.
- `src/lib/db/index.ts`: pools de aplicación y auth.
- `src/lib/env.ts`: secretos `VAR`/`VAR_FILE` y fail-closed.
- `scripts/verify-db-security.mjs`: inventario completo y detector de acceso directo.
- `scripts/backup-postgres.sh`, `verify-backup.mjs`, `backup-restore-drill.sh`: recuperación real general.
- `tests/integration/db-*.test.ts`: bootstrap, roles, RLS, auth, pgvector, concurrencia y restore.

### Task 1: Aislar las pruebas PostgreSQL reales

**Files:**
- Create: `tests/helpers/postgres-isolated.ts`
- Create: `tests/integration/db-bootstrap-empty.test.ts`
- Create: `tests/integration/db-schema-inventory.test.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces `withIsolatedDatabase(label, callback)` and `connectAs(role, databaseName)`.
- Produces `pnpm test:db` without changing the existing unit-test contract.

- [ ] **Step 1: Escribir el bootstrap y el inventario fallidos**

```ts
it("migra una base vacía sin seed", async () => {
  await withIsolatedDatabase("empty", async ({ databaseUrl, admin }) => {
    await runMigrations({ databaseUrl });
    expect(await count(admin, "organization")).toBe(0);
  });
});

it("clasifica cada tabla pública", async () => {
  expect(new Set(await publicTables(admin))).toEqual(
    new Set([...TENANT_TABLES, ...AUTH_TABLES, ...TECHNICAL_TABLES]),
  );
});
```

- [ ] **Step 2: Implementar identificadores seguros**

Validar `label` con `/^[a-z0-9_]{1,40}$/`, generar `venta_test_${label}_${randomUUID().replaceAll("-", "")}` y usar una función `quoteIdentifier` que duplica comillas. La URL administrativa llega solo por `TEST_DATABASE_ADMIN_URL`.

- [ ] **Step 3: Añadir script de prueba**

```json
"test:db": "vitest run tests/integration/db-*.test.ts"
```

No excluir suites existentes del `pnpm test`; el helper usa `describe.skipIf(!process.env.TEST_DATABASE_ADMIN_URL)` para el gate unitario y `test:db` exige la variable.

- [ ] **Step 4: Ejecutar y comprobar el fallo inicial**

Run: `pnpm vitest run tests/integration/db-bootstrap-empty.test.ts tests/integration/db-schema-inventory.test.ts`

Expected: inventario falla porque RLS no existe; bootstrap reproduce el estado real de 0014 sin tocar `vocero`.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/postgres-isolated.ts tests/integration/db-bootstrap-empty.test.ts tests/integration/db-schema-inventory.test.ts package.json vitest.config.ts
git commit -m "test: aislar gate PostgreSQL de VentaMax"
```

### Task 2: Eliminar fallbacks y separar credenciales

**Files:**
- Create: `src/lib/secret-file.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Create: `tests/unit/secret-file.test.ts`
- Create: `tests/unit/env.test.ts`
- Create: `scripts/generate-local-secrets.sh`

**Interfaces:**
- Produces `resolveSecret(name: string, env: NodeJS.ProcessEnv): string | undefined`.
- Env exposes `APP_DATABASE_URL`, `AUTH_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `BACKUP_DATABASE_URL`, `RESTORE_ADMIN_URL`.

- [ ] **Step 1: Escribir pruebas de ausencia, permisos y doble fuente**

```ts
expect(() => resolveSecret("APP_DATABASE_URL", {
  APP_DATABASE_URL: "inline",
  APP_DATABASE_URL_FILE: path,
})).toThrow(/solo una fuente/i);
expect(() => getEnvFrom({ NODE_ENV: "production" })).toThrow(/APP_DATABASE_URL/);
```

- [ ] **Step 2: Implementar archivos secretos fail-closed**

Rechazar symlink, archivo no regular, contenido vacío y modo con bits `0o077`. Recortar solo salto final. No incluir el valor en mensajes de error.

- [x] **Step 3: Eliminar fallback Neon/local**

Quitar la sustitución automática por `postgresql://postgres:postgres...` de `getEnv`, `scripts/migrate.mjs` y `scripts/verify-schema.mjs`. Los fallbacks de Neon han sido eliminados por completo en favor de PostgreSQL local / Docker.

- [ ] **Step 4: Endurecer secretos no PostgreSQL**

Producción exige `BETTER_AUTH_SECRET` de 32 caracteres, `ENCRYPTION_KEY` base64 de 32 bytes y los secretos requeridos por canales activados. Compose usa `${VAR:?message}` o `VAR_FILE`; no contiene valores predecibles.

- [ ] **Step 5: Generar secretos locales**

Crear `.secrets/local` con `umask 077`; generar valores aleatorios y no rotarlos salvo `CONFIRM_ROTATE_LOCAL_SECRETS=1`.

- [ ] **Step 6: Ejecutar tests**

Run 1: `pnpm vitest run tests/unit/secret-file.test.ts tests/unit/env.test.ts`

Run 2: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/secret-file.ts src/lib/env.ts .env.example tests/unit/secret-file.test.ts tests/unit/env.test.ts scripts/generate-local-secrets.sh scripts/migrate.mjs scripts/verify-schema.mjs
git commit -m "feat: exigir secretos de runtime en VentaMax"
```

### Task 3: Bootstrap de roles y Compose por responsabilidad

**Files:**
- Create: `infra/postgres/init/00-bootstrap-roles.sh`
- Create: `scripts/bootstrap-postgres-roles.sh`
- Create: `tests/integration/db-role-privileges.test.ts`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `Dockerfile`
- Modify: `scripts/du.sh`

**Interfaces:**
- Produces `venta_owner`, `venta_migrator`, `venta_app`, `venta_auth`, `venta_ingress`, `venta_backup`, `venta_restore`.
- Production app starts only after migrator exits successfully.

- [ ] **Step 1: Escribir pruebas de roles**

```ts
expect(await flags(admin, "venta_app")).toEqual({
  superuser: false, createDb: false, createRole: false,
  replication: false, bypassRls: false,
});
await expect(app.unsafe("set role venta_owner")).rejects.toThrow();
await expect(auth.unsafe("select * from contact")).rejects.toThrow();
```

- [ ] **Step 2: Crear roles idempotentes con SCRAM**

`venta_owner` es `NOLOGIN NOINHERIT`. Migrator puede `SET ROLE venta_owner`; app/auth/ingress no son miembros. Backup recibe lectura y `BYPASSRLS` sin escritura; restore recibe únicamente `CONNECT/CREATE` sobre el entorno de simulacro. Revocar `CREATE ON SCHEMA public FROM PUBLIC`.

- [ ] **Step 3: Separar servicio migrator**

Dockerfile produce target `migrator` que ejecuta solo `node migrate.mjs`; app ejecuta solo `node server.js`. Compose conecta app con `APP_DATABASE_URL`, Better Auth con `AUTH_DATABASE_URL` y migrator con `MIGRATOR_DATABASE_URL`. DB no publica puerto en producción; dev conserva `127.0.0.1:5432`.

- [ ] **Step 4: Actualizar script operativo**

`scripts/du.sh` genera/valida secretos locales, reconcilia roles, ejecuta migrator, levanta app y no imprime variables.

- [ ] **Step 5: Ejecutar gate**

Run 1: `pnpm vitest run tests/integration/db-role-privileges.test.ts`

Run 2: `docker compose config --quiet`

Expected: PASS y fallo intencional de `docker compose config --quiet` cuando se ejecuta sin archivo de secretos de producción.

- [ ] **Step 6: Commit**

```bash
git add infra/postgres/init/00-bootstrap-roles.sh scripts/bootstrap-postgres-roles.sh tests/integration/db-role-privileges.test.ts docker-compose.yml docker-compose.dev.yml Dockerfile scripts/du.sh
git commit -m "feat: separar roles PostgreSQL de VentaMax"
```

### Task 4: Añadir migración 0019 con integridad y RLS

**Files:**
- Create: `drizzle/0019_tenant_rls_foundation.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`
- Create: `tests/integration/db-rls-isolation.test.ts`
- Create: `tests/integration/db-schema-preflight.test.ts`
- Modify: `scripts/verify-schema.mjs`

**Interfaces:**
- Produces schema `app_security` and policies `<table>_organization_isolation`.
- Produces an explicit inventory for tenant, auth and technical tables.

- [ ] **Step 1: Escribir pruebas de CRUD y referencias cruzadas**

```ts
await withTenantTransaction(appSql, orgA, userA, async (tx) => {
  expect(await tx.select().from(schema.contact).where(eq(schema.contact.id, contactB))).toEqual([]);
  await expect(tx.insert(schema.message).values(messageForOrgB)).rejects.toThrow();
});
```

- [ ] **Step 2: Escribir prueba de preflight**

Insertar deliberadamente una conversación de A con contacto B en una base temporal anterior a 0019; migración debe abortar con nombre de relación y conteo, sin corregirla.

- [ ] **Step 3: Crear funciones de contexto**

```sql
CREATE SCHEMA app_security AUTHORIZATION venta_owner;
CREATE FUNCTION app_security.current_organization_id() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.organization_id', true), '') $$;
REVOKE ALL ON FUNCTION app_security.current_organization_id() FROM PUBLIC;
```

Crear usuario y actor equivalentes y conceder solo a app/ingress.

- [ ] **Step 4: Agregar uniques y FKs compuestas**

Cubrir `contact/conversation/message/lead`, Telegram receipt/menu/outbox,
`category/product/cart/order/payment`, KB y laboratorio. Validar primero y usar
índices `organization_id` al inicio.

- [ ] **Step 5: Aplicar RLS a todas las tablas clasificadas**

Dominio: igualdad por organización en `USING` y `WITH CHECK`. Organización,
member e invitation: políticas de organización/usuario. Better Auth: políticas
exclusivas para `venta_auth`; este rol no recibe grants sobre dominio. Tablas
de auditoría/outbox mantienen escrituras acotadas y sin políticas universales.

- [ ] **Step 6: Ampliar verificador**

Comprobar inventario exacto, RLS enabled/forced, políticas por rol, owner,
grants, ausencia de `PUBLIC`, extensiones y journal completo. Una tabla nueva
sin clasificación produce `Schema verification failed`.

- [ ] **Step 7: Ejecutar migración y pruebas**

Run 1: `pnpm db:migrate`

Run 2: `pnpm vitest run tests/integration/db-schema-preflight.test.ts tests/integration/db-rls-isolation.test.ts`

Run 3: `pnpm db:verify`

Expected: PASS en base válida; preflight falla solo en fixture corrupto.

- [ ] **Step 8: Commit**

```bash
git add drizzle/0019_tenant_rls_foundation.sql drizzle/meta/_journal.json src/lib/db/schema.ts tests/integration/db-rls-isolation.test.ts tests/integration/db-schema-preflight.test.ts scripts/verify-schema.mjs
git commit -m "feat: imponer RLS por organizacion en VentaMax"
```

### Task 5: Crear contextos transaccionales y aislar Better Auth

**Files:**
- Create: `src/lib/db/context.ts`
- Modify: `src/lib/db/index.ts`
- Modify: `src/lib/db/tenant.ts`
- Modify: `src/lib/auth/index.ts`
- Create: `tests/integration/db-context-pool.test.ts`
- Create: `tests/integration/db-auth-boundary.test.ts`

**Interfaces:**
- Produces `withTenantTransaction`, `withIngressTransaction`, `withJobTransaction`.
- Produces `getAuthDb()` using only `AUTH_DATABASE_URL`.

- [ ] **Step 1: Escribir pruebas de contexto y pool reuse**

```ts
await withTenantTransaction(orgA, userA, "user", async (tx) => {
  expect(await currentOrganization(tx)).toBe(orgA);
});
expect(await currentOrganization(getSql())).toBeNull();
```

Alternar A/B en la misma conexión y ejecutar 20 operaciones paralelas; cada
resultado debe corresponder al contexto esperado.

- [ ] **Step 2: Implementar transacción exterior**

```ts
return getSql().begin(async (sql) => {
  await sql`select set_config('app.organization_id', ${organizationId}, true)`;
  await sql`select set_config('app.user_id', ${userId ?? ""}, true)`;
  await sql`select set_config('app.actor_kind', ${actorKind}, true)`;
  return callback(drizzle(sql, { schema }));
});
```

Validar IDs y actor antes de abrirla. No exponer el cliente SQL fuera del
callback.

- [ ] **Step 3: Crear pool auth independiente**

`getAuthDb()` usa `AUTH_DATABASE_URL`; Better Auth recibe ese adapter. Sus hooks
abren una nueva transacción tenant solo después de resolver membresía. Auth no
puede consultar contactos, conversaciones, mensajes, pedidos ni KB.

- [ ] **Step 4: Mantener `scoped()` como primera barrera**

No eliminar filtros existentes. Añadir tipos que exijan `organizationId` y
tests que combinen `scoped()` con RLS.

- [ ] **Step 5: Ejecutar pruebas**

Run: `pnpm vitest run tests/integration/db-context-pool.test.ts tests/integration/db-auth-boundary.test.ts tests/unit/tenant.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/context.ts src/lib/db/index.ts src/lib/db/tenant.ts src/lib/auth/index.ts tests/integration/db-context-pool.test.ts tests/integration/db-auth-boundary.test.ts
git commit -m "feat: aplicar contexto transaccional en VentaMax"
```

### Task 6: Migrar dominio, webhooks, jobs y RAG al contexto

**Files:**
- Modify: `src/server/auth/on-signup.ts`
- Modify: `src/server/inbox/ingest.ts`
- Modify: `src/server/inbox/queries.ts`
- Modify: `src/server/inbox/send.ts`
- Modify: `src/server/inbox/telegram-update.ts`
- Modify: `src/server/inbox/telegram-webhook.ts`
- Modify: `src/server/telegram/update-processor.ts`
- Modify: `src/server/telegram/worker.ts`
- Modify: `src/server/ecommerce/service.ts`
- Modify: `src/server/ecommerce/catalog.ts`
- Modify: `src/server/ecommerce/cache.ts`
- Modify: `src/server/ecommerce/settings.ts`
- Modify: `src/server/ai/pipeline.ts`
- Modify: `src/app/api/orders/route.ts`
- Modify: `src/app/api/orders/[id]/route.ts`
- Modify: `src/app/api/pipeline/board/route.ts`
- Modify: `src/app/api/pipeline/stages/route.ts`
- Modify: `src/app/api/settings/team/route.ts`
- Modify: `src/app/api/settings/telegram/route.ts`
- Create: `scripts/verify-db-security.mjs`
- Create: `tests/integration/db-route-bypass.test.ts`
- Create: `tests/integration/db-pgvector-isolation.test.ts`

**Interfaces:**
- Domain functions consume a transaction-scoped Drizzle client; they do not call `getDb()` internally.
- Webhook resolution returns only integration ID and organization ID, then enters ingress context.

- [ ] **Step 1: Escribir pruebas de API y webhook A/B**

Probar sesión A sobre rutas B, Telegram token B con payload A, pedido B,
pipeline B y modificación de producto B. Esperar 404/403 o cero filas sin
revelar existencia.

- [ ] **Step 2: Migrar servicios por dependencia**

Pasar `tx` explícito desde el borde API/worker hacia inbox, Telegram,
ecommerce y RAG. Mantener transacciones SQL en serie; efectos externos se
ejecutan después del commit mediante outbox existente.

- [ ] **Step 3: Proteger resolución webhook**

Usar una función `SECURITY DEFINER` con hash/token normalizado y `search_path`
fijo. `venta_ingress` no recibe `SELECT` directo sobre integraciones.

- [ ] **Step 4: Cubrir búsqueda híbrida**

Sembrar FAQ/productos con embeddings idénticos en A y B. Búsquedas RAG de A no
pueden recuperar filas de B, aun cuando falle embeddings y opere fallback
textual.

- [ ] **Step 5: Añadir guard estático**

`verify-db-security.mjs --source` enumera importaciones de `getDb()` en dominio
y falla salvo allowlist exacta de auth, health y herramientas administrativas.

- [ ] **Step 6: Ejecutar tests focalizados**

Run: `pnpm vitest run tests/integration/db-route-bypass.test.ts tests/integration/db-pgvector-isolation.test.ts tests/unit/redteam-security-adversarial.test.ts tests/unit/redteam-fsm-ecommerce-chaos.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit sin incluir cambios ajenos**

Agregar únicamente los archivos efectivamente modificados por esta tarea; no
usar `git add -A`.

```bash
git commit -m "refactor: aplicar contexto RLS al dominio VentaMax"
```

### Task 7: Generalizar backup y ejecutar restore drill real

**Files:**
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/verify-backup.mjs`
- Create: `scripts/backup-restore-drill.sh`
- Create: `tests/integration/db-backup-restore.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces `pnpm db:backup`, `pnpm db:verify-backup -- <file>` and `pnpm db:restore-drill`.
- Manifiesto contains SHA-256, PostgreSQL version, migration hash, table counts and duration; no secret.

- [ ] **Step 1: Escribir tests de seguridad del destino**

Rechazar `vocero`, nombres sin prefijo `venta_restore_`, checksum incorrecto,
dump con permisos inseguros y ruta fuera de `BACKUP_DIR` resuelto.

- [ ] **Step 2: Implementar backup como `venta_backup`**

Usar `pg_dump --format=custom --no-owner --no-acl`, `umask 077`, checksum y
`pg_restore --list`. No imprimir `BACKUP_DATABASE_URL`.

- [ ] **Step 3: Implementar restore drill como `venta_restore`**

Crear una base temporal validada, restaurar dump, ejecutar migraciones si
corresponde, `verify-schema.mjs`, `verify-db-security.mjs`, comparar conteos y
correr tests RLS apuntando a la copia. Trap elimina solo el nombre generado.

- [ ] **Step 4: Ejecutar restauración real**

Run: `pnpm db:restore-drill`

Expected: PASS con checksum, conteos y duración; la base `vocero` permanece sin
cambios y no quedan bases temporales.

- [ ] **Step 5: Ejecutar prueba automatizada**

Run: `pnpm vitest run tests/integration/db-backup-restore.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/backup-postgres.sh scripts/verify-backup.mjs scripts/backup-restore-drill.sh tests/integration/db-backup-restore.test.ts package.json .gitignore README.md
git commit -m "feat: verificar restauracion real de VentaMax"
```

### Task 8: Gate completo y reconstrucción Docker

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Ejecutar checks de código**

Run 1: `pnpm lint`

Run 2: `pnpm typecheck`

Run 3: `pnpm test`

Run 4: `pnpm test:db`

Run 5: `pnpm build`

Expected: PASS para todas las suites, incluidas concurrencia, RAG y red team.

- [ ] **Step 2: Escanear configuración efectiva sin imprimir secretos**

Run 1: `docker compose config --quiet`

Run 2: `node scripts/verify-db-security.mjs --compose`

Expected: PASS; sin fallbacks sensibles, DB interna y credenciales separadas.

- [ ] **Step 3: Reconstruir con scripts operativos**

Run 1: `./scripts/dd.sh`

Run 2: `./scripts/du.sh`

Expected: postgres, migrator, app, proxy y tunnel requerido terminan en estado
esperado; app saludable y conectada como `venta_app`.

- [ ] **Step 4: Repetir restore drill contra la imagen final**

Run: `pnpm db:restore-drill`

Expected: PASS.

- [ ] **Step 5: Documentar evidencia local y commit focalizado**

Registrar commit, número de pruebas, checksum abreviado y duración, sin datos
de clientes ni secretos. No declarar aceptación VPS/TLS desde este gate local.

```bash
git add README.md
git commit -m "docs: registrar gate PostgreSQL de VentaMax"
```
