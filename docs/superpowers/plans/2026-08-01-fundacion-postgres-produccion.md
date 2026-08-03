# Fundación PostgreSQL de producción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inicializar Venta Max IA desde una base PostgreSQL vacía y operar cada tenant con roles mínimos, RLS forzado, migraciones verificadas y recuperación comprobada.

**Architecture:** Separar el bootstrap de clúster, las migraciones y el tráfico de aplicación. PostgreSQL conserva el esquema y las políticas RLS; la app inicia una transacción por petición de dominio y fija el contexto tenant con `SET LOCAL`, mientras autenticación y webhooks usan rutas de acceso explícitas y mínimas. Docker ejecuta migraciones antes de la app, sin que la imagen de la app use el rol propietario.

**Tech Stack:** PostgreSQL 18 + pgvector, Drizzle ORM/postgres-js, Node.js 22, Next.js 15, Docker Compose, Vitest y `pg_dump`/`psql`.

## Global Constraints

- La base nueva empieza vacía: no se insertan usuarios, organizaciones ni datos demo durante bootstrap.
- `schema.ts` y las migraciones SQL versionadas son fuentes de verdad; no ejecutar DDL manual no registrado.
- Producción no publica un puerto de PostgreSQL y no usa valores por defecto para secretos o URLs de credenciales.
- `venta_app` nunca es dueño de tablas, nunca recibe `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` ni `BYPASSRLS`.
- Todo acceso de dominio usa contexto por transacción con `set_config(..., true)`; no usar `SET` persistente con conexiones del pool.
- Las migraciones destructivas fallan cerradas si falta consentimiento, dump, checksum o restore drill cuando hay datos heredados.
- No registrar tokens, credenciales, cuerpos completos de webhook, contraseñas ni datos de pago en logs o auditoría.
- Mantener el stack de desarrollo existente separado del Compose de producción; los secretos locales siguen en `.env` ignorado.

---

## File Structure

- `infra/postgres/init/00-bootstrap-roles.sh`: bootstrap idempotente del clúster vacío; crea roles y grants leyendo secretos de entorno, sin escribirlos al repositorio.
- `infra/postgres/init/10-security-schema.sql`: crea el esquema `app_security`, funciones de contexto seguras y ownership inicial.
- `drizzle/0019_tenant_rls_foundation.sql`: migración versionada que crea auditoría, FKs compuestas, grants, RLS y políticas de las tablas ya existentes.
- `scripts/migrate.mjs`: distingue bootstrap vacío, historial aplicado y migraciones destructivas; ejecuta verificaciones pre/post.
- `scripts/verify-schema.mjs`: conserva la verificación funcional e incorpora tablas, restricciones, roles, grants y políticas exigidas.
- `scripts/verify-db-security.mjs`: prueba SQL de roles, denegación por defecto, RLS, FKs cruzadas y auditoría sin exponer secretos.
- `scripts/backup-whatsapp-retirement.sh`: genera dump comprimido, checksum y restore drill sin registrar contenido sensible.
- `src/lib/db/context.ts`: único punto para abrir transacciones de tenant, auth, ingress y jobs internos.
- `src/lib/db/index.ts`: crea clientes separados por responsabilidad y elimina el uso de credenciales superusuario en runtime.
- `src/lib/db/tenant.ts`: conserva `scoped()` y exporta contratos de contexto requeridos.
- `src/server/auth/*`, `src/server/inbox/*`, `src/server/telegram/*`, `src/server/ecommerce/*`, `src/app/api/**`: adoptan los helpers transaccionales; no usan `getDb()` directo para datos tenant.
- `src/lib/env.ts`, `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`, `Dockerfile`: validan secretos, separan roles y convierten migración en servicio/job previo a la app.
- `tests/integration/db-bootstrap-empty.test.ts`, `tests/integration/db-rls-isolation.test.ts`, `tests/integration/db-role-privileges.test.ts`, `tests/integration/db-audit.test.ts`, `tests/integration/whatsapp-backup-restore.test.ts`: pruebas reales de base aislada.

### Task 1: Crear el harness de base aislada y las pruebas de bootstrap vacío

**Files:**
- Create: `tests/helpers/postgres-isolated.ts`
- Create: `tests/integration/db-bootstrap-empty.test.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `withIsolatedDatabase(testName, callback)` que crea una BD temporal, entrega `DATABASE_URL` y garantiza `DROP DATABASE` al finalizar.
- Produces `pnpm test:db`, que ejecuta solo suites que requieren PostgreSQL local.

- [ ] **Step 1: Escribir la prueba fallida de bootstrap vacío**

```ts
it("aplica todas las migraciones desde una base vacía sin datos demo", async () => {
  await withIsolatedDatabase("bootstrap_empty", async ({ databaseUrl, sql }) => {
    await runMigrations({ databaseUrl });
    const tables = await sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`;
    const organizations = await sql`select count(*)::int as count from organization`;
    expect(tables[0].count).toBeGreaterThan(10);
    expect(organizations[0].count).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba y comprobar que falla por el guard de 0014**

Run: `pnpm vitest run tests/integration/db-bootstrap-empty.test.ts`

Expected: falla antes de crear `drizzle.__drizzle_migrations`, demostrando el defecto de bootstrap actual.

- [ ] **Step 3: Implementar el helper aislado sin reutilizar la BD de desarrollo**

```ts
export async function withIsolatedDatabase(
  label: string,
  callback: (ctx: { databaseUrl: string; sql: Sql }) => Promise<void>,
) {
  const databaseName = `venta_test_${label}_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create database ${quoteIdent(databaseName)}`);
  try { await callback({ databaseUrl: replaceDatabase(adminUrl, databaseName), sql: postgres(replaceDatabase(adminUrl, databaseName)) }); }
  finally { await admin.unsafe(`drop database if exists ${quoteIdent(databaseName)} with (force)`); }
}
```

Validate `label` against `/^[a-z0-9_]+$/`; never interpolate test input into SQL identifiers without `quoteIdent`.

- [ ] **Step 4: Agregar script y excluir estas suites del `pnpm test` unitario cuando no haya BD**

```json
{
  "scripts": {
    "test": "vitest run --exclude tests/integration/db-*.test.ts",
    "test:db": "vitest run tests/integration/db-*.test.ts"
  }
}
```

- [ ] **Step 5: Ejecutar las suites de base y confirmar la falla inicial esperada**

Run: `pnpm test:db`

Expected: solo `db-bootstrap-empty` falla por el comportamiento que corregirá Task 3; las demás nuevas todavía no existen.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/postgres-isolated.ts tests/integration/db-bootstrap-empty.test.ts vitest.config.ts package.json
git commit -m "test: preparar bootstrap PostgreSQL aislado"
```

### Task 2: Separar bootstrap, propietario, migrador y aplicación

**Files:**
- Create: `infra/postgres/init/00-bootstrap-roles.sh`
- Create: `infra/postgres/init/10-security-schema.sql`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `.env.example`
- Create: `tests/integration/db-role-privileges.test.ts`

**Interfaces:**
- Produces roles `venta_owner`, `venta_migrator`, `venta_app` y `venta_ingress`.
- Requires `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`, `DB_INGRESS_PASSWORD` in production.
- `venta_app` and `venta_ingress` have `NOBYPASSRLS`; only `venta_migrator` can `SET ROLE venta_owner` during DDL.

- [ ] **Step 1: Escribir las pruebas de atributos y privilegios**

```ts
it("prohíbe privilegios administrativos al rol de aplicación", async () => {
  const role = await admin`select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname = 'venta_app'`;
  expect(role[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  await expect(appSql.unsafe("create table forbidden (id int)")).rejects.toThrow(/permission denied/i);
});
```

- [ ] **Step 2: Ejecutar y confirmar que la prueba falla porque la aplicación usa `postgres`**

Run: `pnpm vitest run tests/integration/db-role-privileges.test.ts`

Expected: falla al no encontrar `venta_app` o al comprobar que `DATABASE_URL` usa el rol administrador.

- [ ] **Step 3: Implementar bootstrap idempotente, con quoting de variables de psql**

`00-bootstrap-roles.sh` debe exigir variables no vacías con `: "${DB_APP_PASSWORD:?…}"`, ejecutar `psql --set app_password="$DB_APP_PASSWORD"`, y delegar la creación a SQL usando literales psql:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'venta_app') THEN
    CREATE ROLE venta_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
ALTER ROLE venta_app CONNECTION LIMIT 30;
ALTER ROLE venta_app PASSWORD :'app_password';
```

Crear `venta_owner NOLOGIN NOINHERIT` y `venta_migrator LOGIN NOBYPASSRLS NOINHERIT`; conceder a migrator únicamente `SET` sobre `venta_owner`. Revocar `CREATE` del esquema `public` para `PUBLIC`.

- [ ] **Step 4: Montar bootstrap solo en el primer `initdb` y separar servicios**

En producción, montar `./infra/postgres/init:/docker-entrypoint-initdb.d:ro` en `postgres`, crear servicio `migrator` con `DATABASE_URL=${MIGRATOR_DATABASE_URL}` y hacer que `app` dependa de `migrator: { condition: service_completed_successfully }`. La app recibe solo `${APP_DATABASE_URL}`. No añadir `ports:` a `postgres`.

- [ ] **Step 5: Endurecer `.env.example` y validación de Compose**

Usar variables requeridas sin fallback inseguro:

```yaml
DATABASE_URL: ${APP_DATABASE_URL:?APP_DATABASE_URL is required}
BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}
ENCRYPTION_KEY: ${ENCRYPTION_KEY:?ENCRYPTION_KEY is required}
```

La variante de desarrollo puede proveer valores locales documentados en un archivo no versionado, pero nunca copiar esos valores al Compose de producción.

- [ ] **Step 6: Ejecutar prueba de roles y revisión de configuración**

Run: `pnpm vitest run tests/integration/db-role-privileges.test.ts && docker compose config --quiet`

Expected: `venta_app` no tiene atributos administrativos; Compose rechaza secretos ausentes en modo producción.

- [ ] **Step 7: Commit**

```bash
git add infra/postgres docker-compose.yml docker-compose.dev.yml .env.example tests/integration/db-role-privileges.test.ts
git commit -m "feat: separar roles PostgreSQL de Venta Max"
```

### Task 3: Hacer las migraciones reproducibles y seguras desde una BD vacía

**Files:**
- Modify: `scripts/migrate.mjs`
- Modify: `scripts/backup-whatsapp-retirement.sh`
- Modify: `scripts/verify-schema.mjs`
- Modify: `tests/integration/db-bootstrap-empty.test.ts`
- Modify: `tests/integration/whatsapp-backup-restore.test.ts`
- Modify: `tests/integration/whatsapp-retirement-migration.test.ts`

**Interfaces:**
- `runMigrations({ databaseUrl?: string })` aplica el journal completo a una base nueva.
- `requireDestructiveConsent(sql, migrationsFolder)` pide dump/restauración solo si 0014 no está aplicada y las tablas heredadas existen.
- `verifySchema(sql)` verifica tanto integridad funcional como roles/grants/RLS tras la última migración.

- [ ] **Step 1: Reemplazar las pruebas simuladas por pruebas con PostgreSQL real**

```ts
it("exige restore drill cuando 0014 encuentra tablas WhatsApp heredadas", async () => {
  await withLegacyWhatsAppSchema(async ({ databaseUrl }) => {
    await expect(runMigrations({ databaseUrl })).rejects.toThrow("WHATSAPP_BACKUP_MANIFEST");
  });
});

it("no exige backup de datos inexistentes en un bootstrap vacío", async () => {
  await withIsolatedDatabase("fresh_0014", async ({ databaseUrl }) => {
    await expect(runMigrations({ databaseUrl })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutar y confirmar ambos fallos actuales**

Run: `pnpm vitest run tests/integration/db-bootstrap-empty.test.ts tests/integration/whatsapp-backup-restore.test.ts`

Expected: la BD nueva se bloquea en 0014 y la prueba heredada no realiza una restauración real.

- [ ] **Step 3: Corregir el guard de 0014 sin omitir el historial**

Antes de pedir consentimiento, detectar el estado inicial:

```js
const legacyTables = await sql`
  select to_regclass('public.meta_credentials') as meta_credentials,
         to_regclass('public.template') as template
`;
const hasLegacySchema = Boolean(legacyTables[0]?.meta_credentials && legacyTables[0]?.template);
if (!hasLegacySchema) return;
```

El guard solo se ejecuta antes del journal completo cuando las tablas ya existían. En una BD nueva, Drizzle crea las tablas de las migraciones previas y aplica 0014 dentro de la misma secuencia sin datos de cliente. Si hay una sola tabla heredada, fallar con diagnóstico de esquema parcial; no intentar reparar ni borrar automáticamente.

- [ ] **Step 4: Hacer backup/restauración verificables y confidenciales**

Cambiar el script para requerir un directorio de backup con permisos `0700`, usar `pg_dump --format=custom --no-owner --no-privileges`, guardar SHA-256 y probar `pg_restore --clean --if-exists` en una base temporal. El manifiesto contiene ruta, checksum, fecha, versión de PostgreSQL y conteos, nunca secretos. El script falla si el dump o la restauración no permiten comparar los conteos.

- [ ] **Step 5: Ampliar verificación post-migración**

`verifySchema` debe comprobar que todas las entradas del journal existen, que no quedan `meta_credentials`/`template`, y que las tablas retiradas existen en `retired_whatsapp` solo cuando la migración se aplicó sobre datos heredados.

- [ ] **Step 6: Ejecutar pruebas de bootstrap y retiro de WhatsApp**

Run: `pnpm vitest run tests/integration/db-bootstrap-empty.test.ts tests/integration/whatsapp-backup-restore.test.ts tests/integration/whatsapp-retirement-migration.test.ts`

Expected: BD vacía lista; base heredada sin manifiesto rechazada; base heredada con dump/restauración/consentimiento válida y retirada verificable.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate.mjs scripts/backup-whatsapp-retirement.sh scripts/verify-schema.mjs tests/integration/db-bootstrap-empty.test.ts tests/integration/whatsapp-backup-restore.test.ts tests/integration/whatsapp-retirement-migration.test.ts
git commit -m "fix: inicializar migraciones seguras desde base vacía"
```

### Task 4: Añadir integridad tenant, auditoría y RLS versionados

**Files:**
- Create: `drizzle/0019_tenant_rls_foundation.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`
- Create: `tests/integration/db-rls-isolation.test.ts`
- Create: `tests/integration/db-audit.test.ts`

**Interfaces:**
- Produces schema `app_security` with `current_organization_id()`, `current_user_id()`, `current_actor_kind()` and `write_audit_event(...)`.
- Produces table `audit_log` and composite tenant FKs for all relations that currently join IDs alone.
- Produces RLS policies named `<table>_tenant_isolation` for every table with `organization_id`.

- [ ] **Step 1: Escribir pruebas adversariales de aislamiento**

```ts
it("impide que tenant A lea, inserte, actualice o elimine datos del tenant B", async () => {
  await withTenantTransaction(appSql, tenantA, userA, async (db) => {
    await expect(db.select().from(schema.contact).where(eq(schema.contact.id, contactB.id))).resolves.toEqual([]);
    await expect(db.insert(schema.contact).values({ ...contactB, organizationId: tenantB })).rejects.toThrow();
  });
});

it("rechaza una conversación que referencia un contacto de otra organización", async () => {
  await expect(insertConversation(tenantA, contactB.id)).rejects.toThrow(/foreign key|tenant/i);
});
```

- [ ] **Step 2: Ejecutar y confirmar que hoy falla la protección de base**

Run: `pnpm vitest run tests/integration/db-rls-isolation.test.ts tests/integration/db-audit.test.ts`

Expected: las consultas con el rol actual pueden cruzar tenant o no existe `audit_log`.

- [ ] **Step 3: Crear funciones de contexto sin `search_path` inseguro**

```sql
CREATE SCHEMA IF NOT EXISTS app_security AUTHORIZATION venta_owner;
CREATE FUNCTION app_security.current_organization_id()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.organization_id', true), '') $$;
REVOKE ALL ON FUNCTION app_security.current_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.current_organization_id() TO venta_app, venta_ingress;
```

Crear funciones equivalentes para usuario y actor. Ninguna concatena SQL de valores externos.

- [ ] **Step 4: Añadir auditoría de inserción controlada**

```sql
CREATE TABLE audit_log (
  id text PRIMARY KEY,
  organization_id text NULL REFERENCES organization(id) ON DELETE SET NULL,
  actor_user_id text NULL REFERENCES "user"(id) ON DELETE SET NULL,
  actor_kind text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NULL,
  outcome text NOT NULL,
  correlation_id text NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (length(action) BETWEEN 1 AND 120),
  CHECK (length(resource_type) BETWEEN 1 AND 120)
);
```

Hacer que `venta_app` tenga solo `INSERT` por `app_security.write_audit_event`, revocar DML directo y prohibir `UPDATE`/`DELETE` a todos los roles runtime.

- [ ] **Step 5: Aplicar FKs compuestas e índices org-first**

Para cada relación tenant-tenant, agregar una restricción equivalente a:

```sql
ALTER TABLE contact ADD CONSTRAINT contact_org_id_uq UNIQUE (organization_id, id);
ALTER TABLE conversation ADD CONSTRAINT conversation_contact_same_org_fk
  FOREIGN KEY (organization_id, contact_id)
  REFERENCES contact (organization_id, id) ON DELETE CASCADE;
```

Repetir para `message → conversation`, `lead → contact/pipeline_stage`, `order → conversation/contact`, `payment → order` y tablas de Telegram. Antes de crear cada FK, validar filas huérfanas o cruzadas y abortar con un reporte de conteos; no corregir datos automáticamente.

- [ ] **Step 6: Habilitar y forzar RLS por tabla tenant**

```sql
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_tenant_isolation ON contact TO venta_app
  USING (organization_id = app_security.current_organization_id())
  WITH CHECK (organization_id = app_security.current_organization_id());
```

Generar el bloque para cada tabla con `organization_id`. Aplicar políticas específicas para `member`, `invitation`, `session`, `account`, `verification` e integraciones: solo los flujos de auth/ingress documentados reciben los grants mínimos necesarios. Nunca crear una política `USING (true)` para roles runtime.

- [ ] **Step 7: Sincronizar `schema.ts` y metadatos Drizzle**

Declarar `auditLog`, sus índices y las nuevas uniques compuestas. Generar/revisar el journal sin editar hashes pasados. Confirmar que la nueva migración es la única fuente de DDL de seguridad.

- [ ] **Step 8: Ejecutar red team de base**

Run: `pnpm vitest run tests/integration/db-rls-isolation.test.ts tests/integration/db-audit.test.ts && pnpm db:verify`

Expected: todos los cruces tenant fallan, los datos sin contexto son invisibles, auditoría no se puede alterar y el verificador enumera RLS/políticas/grants correctos.

- [ ] **Step 9: Commit**

```bash
git add drizzle/0019_tenant_rls_foundation.sql drizzle/meta/_journal.json src/lib/db/schema.ts tests/integration/db-rls-isolation.test.ts tests/integration/db-audit.test.ts
git commit -m "feat: imponer RLS y auditoría por tenant"
```

### Task 5: Introducir contexto transaccional y eliminar accesos tenant directos

**Files:**
- Create: `src/lib/db/context.ts`
- Modify: `src/lib/db/index.ts`
- Modify: `src/lib/db/tenant.ts`
- Modify: `src/server/auth/on-signup.ts`
- Modify: `src/server/inbox/*.ts`
- Modify: `src/server/telegram/*.ts`
- Modify: `src/server/ecommerce/*.ts`
- Modify: `src/server/ai/*.ts`
- Modify: `src/app/api/**/*.ts`
- Create: `tests/unit/db-context.test.ts`
- Modify: `tests/unit/tenant.test.ts`

**Interfaces:**
- `withTenantTransaction<T>(context: TenantDbContext, operation: (db: TenantDb) => Promise<T>): Promise<T>`.
- `withAuthTransaction<T>(userId, operation)` for BetterAuth-owned queries.
- `withIngressTransaction<T>(verifiedIngress, operation)` only after signature/route validation.

- [ ] **Step 1: Escribir pruebas del helper contra fuga de contexto**

```ts
it("usa SET LOCAL y limpia el tenant cuando la transacción termina", async () => {
  await withTenantTransaction({ organizationId: "org_a", userId: "user_a", actorKind: "tenant" }, async (db) => {
    expect(await db.execute(sql`select current_setting('app.organization_id', true) as org`)).toEqual([{ org: "org_a" }]);
  });
  expect(await rawSql`select current_setting('app.organization_id', true) as org`).toEqual([{ org: null }]);
});
```

- [ ] **Step 2: Ejecutar y comprobar que no existe el helper**

Run: `pnpm vitest run tests/unit/db-context.test.ts`

Expected: falla por import inexistente.

- [ ] **Step 3: Implementar el helper sobre una transacción postgres-js**

```ts
export async function withTenantTransaction<T>(context: TenantDbContext, operation: (db: TenantDb) => Promise<T>): Promise<T> {
  assertTenantContext(context);
  return getSql().begin(async (tx) => {
    await tx`select set_config('app.organization_id', ${context.organizationId}, true)`;
    await tx`select set_config('app.user_id', ${context.userId}, true)`;
    await tx`select set_config('app.actor_kind', ${context.actorKind}, true)`;
    return operation(drizzle(tx, { schema }));
  });
}
```

`assertTenantContext` rechaza IDs vacíos y actor kinds fuera de `tenant | auth | ingress | worker`.

- [ ] **Step 4: Migrar por capas los repositorios de dominio**

Primero `contacts`, `inbox`, `ecommerce`, `telegram` y `knowledge`; después rutas API y workers. Cada función pública recibe un `TenantDb` o `TenantDbContext`, nunca un `organizationId` libre más un `getDb()` global. Conservar `scoped()` como segundo control dentro de las queries.

- [ ] **Step 5: Tratar flujos de auth y webhooks sin abrir RLS**

`resolveMembership` usa `withAuthTransaction(userId, ...)`. La ruta Telegram valida el secreto y llama una función SQL `app_security.resolve_telegram_integration(...)` de privilegios mínimos; solo después abre `withIngressTransaction` con la organización resuelta. Registrar el resultado por `write_audit_event` sin incluir el token o payload.

- [ ] **Step 6: Prohibir accesos directos nuevos mediante prueba estática**

Agregar una prueba que recorra `src/server` y `src/app/api` y falle si detecta `getDb()` fuera de `src/lib/db`, bootstrap o tests permitidos. Mantener una allowlist explícita y mínima para BetterAuth adapter.

- [ ] **Step 7: Ejecutar unitarias, integración de webhooks y RLS**

Run: `pnpm typecheck && pnpm vitest run tests/unit/db-context.test.ts tests/unit/tenant.test.ts tests/integration/db-rls-isolation.test.ts tests/integration/telegram-webhook-route.test.ts`

Expected: tipos correctos, ningún acceso tenant directo, contexto limpio tras cada transacción y webhook sin enumeración entre organizaciones.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db src/server src/app/api tests/unit/db-context.test.ts tests/unit/tenant.test.ts
git commit -m "refactor: ejecutar dominio con contexto tenant transaccional"
```

### Task 6: Endurecer entorno, readiness, observabilidad y recuperación

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/verify-schema.mjs`
- Create: `scripts/verify-db-security.mjs`
- Create: `docs/POSTGRES_OPERATOR.md`
- Create: `tests/integration/db-security-verifier.test.ts`

**Interfaces:**
- `getEnv()` rechaza secretos de ejemplo y URL de base con rol administrador en producción.
- `/api/health` prueba proceso; `/api/ready` solo responde 200 si la base, migraciones y seguridad son válidas.
- `pnpm db:security:verify` devuelve cero solo con roles, RLS, políticas, grants e índices correctos.

- [ ] **Step 1: Escribir pruebas de fail-closed de entorno y readiness**

```ts
it("rechaza DATABASE_URL de postgres y secretos de ejemplo en producción", () => {
  expect(() => parseEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://postgres:example@db/vocero" })).toThrow(/rol de aplicación/i);
});

it("readiness falla si falta una política RLS requerida", async () => {
  await dropPolicy("contact_tenant_isolation");
  expect(await verifyDatabaseSecurity(sql)).toMatchObject({ ready: false });
});
```

- [ ] **Step 2: Ejecutar y comprobar que los fallbacks actuales permiten valores inseguros**

Run: `pnpm vitest run tests/integration/db-security-verifier.test.ts tests/unit/env.test.ts`

Expected: falla porque Compose y `getEnv()` aceptan defaults de `postgres` y secretos de ejemplo.

- [ ] **Step 3: Validar producción sin filtrar secretos**

En `getEnv`, exigir `APP_DATABASE_URL`, prohibir usuario `postgres` y prefijos `default_`, `placeholder-` o valores conocidos de ejemplo cuando `NODE_ENV=production`. Los errores listan nombres de variables, nunca valores. Eliminar la lectura implícita de `.env` y fallback a `postgresql://postgres…` en runtime de producción.

- [ ] **Step 4: Separar migrator de la imagen runtime**

Cambiar el `CMD` final de Docker a `node server.js`. Agregar servicio `migrator` que ejecuta `node migrate.mjs`, usa la URL del rol migrador y termina tras `verifySchema`. `app` depende de su éxito. Mantener healthcheck de app sin ejecutar DDL.

- [ ] **Step 5: Implementar verificador de seguridad y readiness**

`verify-db-security.mjs` consulta `pg_roles`, `pg_class.relrowsecurity`, `pg_policy`, `information_schema.role_table_grants`, FKs compuestas e índices. `/api/ready` usa una consulta de disponibilidad barata y cachea el verificador por pocos segundos; no ejecuta DDL ni entrega detalles internos al cliente.

- [ ] **Step 6: Documentar operación sin secretos**

`docs/POSTGRES_OPERATOR.md` explica provisión de secretos, bootstrap de volumen nuevo, migración segura, backup/restore drill, rotación de contraseñas, verificación de roles, diagnóstico de readiness y recuperación. No contiene contraseñas, tokens ni dumps.

- [ ] **Step 7: Ejecutar controles de seguridad y build**

Run: `pnpm typecheck && pnpm test && pnpm test:db && pnpm db:verify && pnpm db:security:verify && docker compose config --quiet && docker compose build --pull`

Expected: todos los controles pasan; la imagen runtime no contiene ni ejecuta credenciales de migrador.

- [ ] **Step 8: Commit**

```bash
git add src/lib/env.ts src/app/api/health/route.ts Dockerfile docker-compose.yml scripts/verify-schema.mjs scripts/verify-db-security.mjs docs/POSTGRES_OPERATOR.md tests/integration/db-security-verifier.test.ts
git commit -m "feat: endurecer operacion PostgreSQL de produccion"
```

### Task 7: Validar el flujo completo en Docker y ejecutar red team final

**Files:**
- Modify: `tests/integration/redteam-database-isolation.test.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces una secuencia reproducible de `docker compose down`, bootstrap vacío, migrator exitoso, app lista y dos tenants aislados.

- [ ] **Step 1: Escribir casos de ataque de extremo a extremo**

```ts
const attacks = [
  "missing_context_reads_nothing",
  "tenant_a_cannot_read_tenant_b",
  "tenant_a_cannot_write_tenant_b",
  "cross_tenant_foreign_key_rejected",
  "app_role_cannot_ddl_or_bypass_rls",
  "audit_log_is_append_only",
  "webhook_token_cannot_enumerate_integrations",
  "pool_connection_context_does_not_leak",
];
for (const attack of attacks) it(attack, async () => expect(await runAttack(attack)).toBe("blocked"));
```

- [ ] **Step 2: Ejecutar el red team contra la base aislada**

Run: `pnpm vitest run tests/integration/redteam-database-isolation.test.ts`

Expected: falla hasta que todas las capas anteriores estén presentes.

- [ ] **Step 3: Aplicar el stack limpio de verificación**

Usar un volumen de validación con nombre explícito, nunca el volumen productivo:

```bash
docker compose -p venta-max-verify down --volumes --remove-orphans
docker compose -p venta-max-verify up --build --wait
docker compose -p venta-max-verify exec -T app node scripts/verify-db-security.mjs
docker compose -p venta-max-verify down --volumes --remove-orphans
```

La eliminación de ese volumen solo ocurre después de validar que el prefijo es exactamente `venta-max-verify`.

- [ ] **Step 4: Ejecutar la matriz final**

Run: `pnpm typecheck && pnpm test && pnpm test:db && pnpm db:verify && pnpm db:security:verify && docker compose -p venta-max-verify up --build --wait`

Expected: todo PASS; app responde `/api/health` y `/api/ready`; ninguna tabla tenant devuelve filas sin contexto.

- [ ] **Step 5: Actualizar runbook y contrato operativo**

Documentar que no se usa `postgres` como rol de runtime, que las migraciones se ejecutan antes de la app, que la BD inicial está vacía y que los cambios destructivos requieren restore drill. Mantener la separación de Docker, datos y secretos respecto de True Deal y VoiceLive.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/redteam-database-isolation.test.ts README.md AGENTS.md
git commit -m "test: validar aislamiento PostgreSQL de extremo a extremo"
```

## Self-review

- Cobertura de especificación: Task 1 y 3 cubren bootstrap/migraciones; Task 2 cubre roles; Task 4 cubre RLS, FKs, auditoría e índices; Task 5 integra el contexto con la aplicación; Task 6 cubre configuración, readiness y recuperación; Task 7 valida red team y Docker.
- No hay pasos de implementación sin archivo, interfaz, comando o resultado esperado.
- Los contratos `withTenantTransaction`, `runMigrations`, `verifyDatabaseSecurity` y roles se definen antes de que una tarea posterior los consuma.
- No se agregan réplica, particionado ni servicios externos prematuros.
