# Seguridad PostgreSQL de VentaMax IA

PostgreSQL aplica el aislamiento de tenants aunque una consulta olvide el filtro
de organización. Las migraciones son la fuente de verdad del esquema; Docker no
siembra datos durante el arranque.

## Roles

- `venta_owner`: propietario sin login. Solo recibe DDL mediante `SET ROLE` del
  migrador.
- `venta_migrator`: ejecuta el journal y el verificador antes de iniciar la app.
- `venta_app`: atiende dominio dentro de transacciones con contexto de tenant.
- `venta_auth`: accede exclusivamente a las tablas de autenticación y membresía.
- `venta_ingress`: solo resuelve una integración desde un token opaco de webhook.
- `venta_backup`: rol offline de solo lectura. Es el único con `BYPASSRLS` para
  producir una copia completa de todos los tenants; nunca llega al runtime web.
- `venta_restore`: puede crear la base temporal del simulacro, pero no puede
  conectarse a la base principal.

Todas las tablas de `public` tienen `ENABLE ROW LEVEL SECURITY` y
`FORCE ROW LEVEL SECURITY`. Los roles de aplicación no son propietarios, no
pueden crear objetos ni cambiar al rol propietario.

## Secretos locales

```bash
./scripts/generate-local-secrets.sh
./scripts/bootstrap-postgres-roles.sh
```

El archivo `.env` queda con permisos `0600` y está ignorado por Git. En un VPS,
inyectar los mismos nombres desde el administrador de secretos de la plataforma;
no copiar `.env` al repositorio ni a la imagen.

## Migración y verificación

```bash
docker compose up -d --build app
docker compose logs --no-color migrator
```

El contenedor `migrator` debe terminar con código `0` antes de que la aplicación
arranque. El gate comprueba journal, esquema, constraints, roles, propietarios,
privilegios y RLS.

Las comprobaciones dinámicas se ejecutan dentro de la red privada de Compose:

```bash
docker compose run --rm migrator node migrate.mjs
```

Para una auditoría manual, usar `scripts/verify-db-security.mjs` y
`scripts/test-db-security-live.mjs` con las URLs de migrador, app y auth
inyectadas como variables; los scripts nunca imprimen esas URLs.

## Backup y restauración

```bash
./scripts/backup-postgres.sh
./scripts/verify-backup.sh backups/vocero_FECHA.dump
./scripts/backup-restore-drill.sh
```

El respaldo es custom format, incluye ACL, genera SHA-256 y un manifiesto de
conteos. El simulacro crea una base temporal, restaura, reasigna ownership,
compara exactamente las filas y elimina la base temporal. Un archivo que no haya
pasado esta prueba no se considera respaldo recuperable.

Los dumps viven en `backups/`, que está ignorado por Git. Deben copiarse cifrados
a almacenamiento externo con retención definida; guardar una copia solo en el
mismo computador no protege frente a pérdida del equipo.

## Regla para código nuevo

Una ruta autenticada usa `withAuth`. Un webhook resuelve primero el tenant con
el rol ingress y luego usa `withIngressTransaction`. Un job enumera tenants con
auth y procesa cada uno con `withJobTransaction`. Nunca usar una URL de migrador,
backup, restore o `postgres` en el proceso web.

Las integraciones externas sin firma verificable fallan cerradas. En particular,
el webhook de pagos no modifica pedidos hasta implementar validación HMAC y una
referencia opaca emitida por el servidor.
