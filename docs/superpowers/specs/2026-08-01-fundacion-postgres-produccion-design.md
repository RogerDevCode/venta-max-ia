# Fundación PostgreSQL de producción para Venta Max IA

## Objetivo

Permitir que Venta Max IA inicialice una base de datos PostgreSQL vacía y
reproducible, con aislamiento multi-tenant impuesto también por la base de
datos, privilegios mínimos, migraciones seguras, respaldo verificable y
pruebas que demuestren que un tenant no puede acceder a otro.

## Alcance y decisiones

- La primera base parte **vacía**. No se crean organizaciones, usuarios,
  integraciones ni datos de demostración automáticamente. El seed sigue siendo
  una acción explícita de desarrollo.
- La aplicación conserva sus filtros `scoped(organization_id, ...)`, pero se
  agrega RLS como defensa en profundidad, no como sustituto de autenticación ni
  autorización de la aplicación.
- El despliegue normal usa un rol de aplicación sin privilegios de DDL ni
  `BYPASSRLS`. El rol de migración se usa solo durante bootstrap/migraciones y
  nunca para tráfico HTTP, webhooks o workers.
- La migración histórica 0014 se vuelve segura para una base nueva: la
  verificación de respaldo y consentimiento se ejecuta solo cuando existan las
  tablas WhatsApp heredadas que esa migración retira. Con datos heredados, se
  conservan el respaldo, manifiesto y prueba de restauración obligatorios.
- No se abre PostgreSQL al host en la configuración de producción. Los puertos
  de desarrollo quedan en el Compose de desarrollo, nunca en el de producción.

## Amenazas y controles (red team)

| Riesgo | Control obligatorio | Prueba |
| --- | --- | --- |
| Un handler omite `organization_id` | RLS con denegación por defecto en tablas tenant | Dos tenants: `SELECT`, `INSERT`, `UPDATE` y `DELETE` cruzados son rechazados o devuelven cero filas. |
| Reutilización de conexión del pool | Contexto con `SET LOCAL` dentro de una transacción | Una petición A seguida por B no puede leer filas de A desde la conexión reutilizada. |
| Dueño/superusuario elude RLS | Roles separados; la app no es dueña ni superusuario ni `BYPASSRLS`; tablas con `FORCE ROW LEVEL SECURITY` | `pg_roles` y `pg_class` confirman atributos y RLS forzado. |
| Relación entre recursos de tenants distintos | Claves foráneas compuestas `(organization_id, id)` donde la relación lo exige | Insertar conversación, orden o mensaje con organizaciones cruzadas falla. |
| Webhook resuelve un tenant antes de conocerlo | Función `SECURITY DEFINER` mínima para resolver una integración por hash; después fija el tenant y audita | El rol de ingress no puede listar ni modificar integraciones de otros tenants. |
| Sesión o worker usa permisos amplios | Contextos `auth`, `tenant` e `ingress` acotados; funciones de entrada con `search_path` endurecido | Pruebas de permisos para sesión, webhook y worker. |
| Compromiso de `DATABASE_URL` | Rol de aplicación sin DDL, sin creación de roles/BD, sin acceso a tablas fuera de sus grants | `CREATE`, `ALTER`, `DROP`, `SET ROLE venta_owner` y acceso sin contexto fallan. |
| Migración destructiva sin recuperación | `pg_dump`, checksum, manifiesto, restore drill y consentimiento explícito | Restauración en BD temporal y conteos comprobados antes de 0014. |
| Cambios sensibles sin trazabilidad | `audit_log` de solo inserción mediante función controlada | App no puede modificar ni borrar registros de auditoría. |
| Secretos en imágenes o Git | `.env` ignorado, sin valores por defecto inseguros y validación fail-closed al iniciar | Escaneo de secretos y prueba de arranque sin variables obligatorias. |

## Arquitectura de roles

```text
postgres bootstrap (solo provisionamiento local/operador)
  ├─ venta_owner       NOLOGIN, dueño de esquema y objetos
  ├─ venta_migrator    LOGIN, NOBYPASSRLS, puede SET ROLE venta_owner solo para DDL
  ├─ venta_app         LOGIN, NOBYPASSRLS, DML explícito y sin DDL
  └─ venta_ingress     LOGIN, NOBYPASSRLS, solo funciones de resolución/verificación de webhook
```

`venta_app` no será miembro de `venta_owner`, no tendrá `SUPERUSER`,
`CREATEDB`, `CREATEROLE`, `REPLICATION` ni `BYPASSRLS`. Sus conexiones tendrán
un límite configurable. Las contraseñas se proporcionan en secretos del entorno
de despliegue, no en SQL ni en archivos versionados.

El rol de migración recibe su URL exclusivamente en el job/contendor de
migración. La URL de la aplicación usa `venta_app`. Una tarea de bootstrap
idempotente crea o reconcilia roles, grants y ownership en una base nueva.

## Contexto de acceso y RLS

Cada operación de dominio usa un helper transaccional que ejecuta, antes de
cualquier query de negocio:

```sql
SELECT set_config('app.organization_id', $organization_id, true);
SELECT set_config('app.user_id', $user_id, true);
SELECT set_config('app.actor_kind', $actor_kind, true);
```

El tercer argumento `true` hace que el contexto sea local a la transacción. Las
políticas consultan solo funciones de esquema controlado que leen esos valores
con `current_setting(..., true)`. Sin contexto válido, las tablas tenant niegan
todo. Los helpers no aceptan un tenant elegido por el cliente: derivan usuario,
rol y organización desde la sesión, el webhook verificado o el job interno.

Las tablas puramente de autenticación se tratan por separado: el flujo de
sesión puede resolver el usuario por token, pero no obtiene permisos de datos
tenant hasta que valida una membresía. Las integraciones de Telegram/WhatsApp
no se listan desde un webhook público; una función `SECURITY DEFINER` de alcance
estrecho resuelve el hash de ruta, devuelve el identificador de organización
necesario y registra la entrada. Su `search_path` se fija a `pg_catalog` y al
esquema de aplicación, sin SQL dinámico construido desde la entrada externa.

RLS protege contra errores de consulta y exposición accidental con el rol de la
aplicación. No sustituye un secreto de base de datos ni protege frente a un
atacante que controle el proceso de la aplicación y su configuración de
conexión; por eso se aplican credenciales separadas, red privada y mínimo
privilegio.

## Esquema, integridad y rendimiento

- Drizzle continúa siendo la fuente de definición de tablas; las migraciones
  SQL son la fuente de verdad de la base desplegada.
- Toda tabla de dominio lleva `organization_id NOT NULL` y FK a
  `organization(id)`.
- Las relaciones entre recursos de dominio se refuerzan con FKs compuestas para
  impedir referencias de otra organización.
- Se conservan las restricciones de idempotencia de webhook/outbox y se
  verifican índices compuestos `organization_id` primero, seguidos por estado,
  fecha o idempotency key según la consulta real.
- `audit_log` contiene actor, organización, acción, recurso, resultado, IP
  normalizada, user-agent acotado, correlación y fecha. No guarda tokens,
  mensajes completos, contraseñas ni datos de pago. Solo una función controlada
  inserta registros; no hay grants de `UPDATE` ni `DELETE` para la aplicación.
- No se introduce particionado ni réplica todavía: con una base vacía sería
  complejidad prematura. Se deja el diseño listo para agregar partición por
  fecha a auditoría/eventos cuando el volumen lo justifique.

## Bootstrap, migraciones y recuperación

1. El job de migración verifica conexión, versión de PostgreSQL, extensiones y
   roles antes de aplicar DDL.
2. En una base vacía aplica `0000` a la última migración en orden y registra los
   hashes en `drizzle.__drizzle_migrations`.
3. La retirada de WhatsApp heredado solo exige backup/restore drill si detecta
   que sus tablas origen existen y contienen el esquema esperado. Una base nueva
   continúa por la secuencia normal, donde esas tablas son creadas por
   migraciones anteriores y luego retiradas de forma transaccional y auditable.
4. Antes de una migración destructiva de una base con datos, se genera un dump
   cifrado fuera del repositorio, checksum SHA-256, restore drill en una base
   temporal aislada y manifiesto de resultado. La migración falla cerrada si
   cualquiera de estas pruebas no existe o no coincide.
5. Al final se ejecutan verificaciones de tablas, columnas, FKs, índices,
   restricciones, extensiones, roles, grants, RLS y políticas.

## Operación y configuración

- Producción: la red de PostgreSQL es interna; solo app, migrator y backup job
  autorizados comparten su red. No hay `ports:` para PostgreSQL.
- Desarrollo: una publicación de puerto opcional, limitada a `127.0.0.1`, usa
  credenciales distintas y nunca se reutiliza como configuración productiva.
- Las variables críticas (`DATABASE_URL`, secretos de auth/cifrado, URLs
  públicas y credenciales de roles) son obligatorias y se validan al inicio;
  valores de ejemplo no son fallback válido en producción.
- Logs no imprimen URLs de conexión, secretos, tokens ni cuerpos de webhook.
- Healthcheck distingue disponibilidad del proceso de disponibilidad de base y
  verificación de esquema. Readiness solo pasa después de migración y
  verificaciones exitosas.

## Criterios de aceptación

1. Un volumen PostgreSQL nuevo inicia Venta Max sin intervención manual y sin
   datos demo.
2. La aplicación se conecta como `venta_app`, no como `postgres` ni como dueño
   de tablas; el migrador no participa en tráfico normal.
3. RLS está habilitado y forzado en cada tabla tenant, con una política
   explícita y denegación sin contexto.
4. Las pruebas de red team demuestran que dos tenants no pueden cruzar lectura,
   escritura, actualización, borrado, FKs, webhook ni auditoría.
5. Las migraciones existentes y las nuevas pasan en una BD vacía; la 0014 sigue
   exigiendo respaldo/restauración al aplicarse sobre datos heredados.
6. `pnpm typecheck`, `pnpm test`, build de Docker, healthchecks y scripts de
   verificación de esquema terminan correctamente.

## Fuentes técnicas

- PostgreSQL, [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- PostgreSQL, [CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html).
- PostgreSQL, [Privileges](https://www.postgresql.org/docs/current/ddl-priv.html).
- PostgreSQL, [SQL Dump and restore](https://www.postgresql.org/docs/current/backup-dump.html).
