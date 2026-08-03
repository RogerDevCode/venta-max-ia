import postgres from "postgres";

const PHASES = {
  "telegram-durable": {
    tables: ["telegram_webhook_receipt", "telegram_webhook_rejection", "telegram_outbox", "commerce_order_counter"],
    indexes: [
      ["telegram_receipt_integration_update_uq", true, ["organization_id", "integration_id", "update_id"], null],
      ["telegram_receipt_org_status_available_idx", false, ["organization_id", "status", "available_at"], null],
      ["telegram_outbox_org_idempotency_uq", true, ["organization_id", "idempotency_key"], null],
      ["telegram_outbox_org_status_available_idx", false, ["organization_id", "status", "available_at"], null],
      ["cart_org_conv_active_uq", true, ["organization_id", "conversation_id"], "status = 'active'"],
      ["telegram_integration_bot_id_uq", true, ["bot_id"], null],
    ],
    notNull: [
      ["telegram_webhook_receipt", "payload"],
      ["telegram_webhook_receipt", "attempts"],
      ["telegram_outbox", "organization_id"],
      ["telegram_outbox", "integration_id"],
      ["telegram_outbox", "conversation_id"],
      ["conversation", "fsm_revision"],
    ],
    constraints: ["telegram_webhook_receipt_status_check", "telegram_outbox_status_check", "commerce_order_counter_next_positive"],
    absentTables: ["meta_credentials", "template"],
    absentColumns: [["contact", "phone"], ["message", "wa_message_id"], ["message", "wa_timestamp"]],
    absentIndexes: ["message_wa_message_id_unique", "contact_org_phone_uq"],
  },
};

function normalizePredicate(value) {
  return String(value ?? "").replace(/[()\s"]/g, "").replace(/::text/g, "").toLowerCase();
}

export async function verifySchema(sql, phase = process.env.SCHEMA_VERIFY_PHASE || "telegram-durable") {
  const contract = PHASES[phase];
  if (!contract) throw new Error(`Unknown schema verification phase: ${phase}`);
  const errors = [];
  const tables = await sql.unsafe(`select table_name from information_schema.tables where table_schema='public'`);
  const tableNames = new Set(tables.map((row) => row.table_name));
  for (const table of contract.tables) if (!tableNames.has(table)) errors.push(`missing table ${table}`);
  for (const table of contract.absentTables ?? []) if (tableNames.has(table)) errors.push(`retired table still present ${table}`);

  const indexes = await sql.unsafe(`
    select i.relname as name, x.indisunique as unique, x.indisvalid as valid,
      array_agg(a.attname order by k.ordinality) filter (where a.attname is not null) as columns,
      pg_get_expr(x.indpred, x.indrelid) as predicate
    from pg_index x
    join pg_class i on i.oid=x.indexrelid
    join pg_class t on t.oid=x.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    left join lateral unnest(x.indkey) with ordinality k(attnum, ordinality) on true
    left join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum
    where n.nspname='public'
    group by i.relname,x.indisunique,x.indisvalid,x.indpred,x.indrelid
  `);
  const byIndex = new Map(indexes.map((row) => [row.name, row]));
  for (const [name, unique, columns, predicate] of contract.indexes) {
    const row = byIndex.get(name);
    if (!row) { errors.push(`missing index ${name}`); continue; }
    if (!row.valid) errors.push(`invalid index ${name}`);
    if (row.unique !== unique) errors.push(`wrong uniqueness ${name}`);
    if (JSON.stringify(row.columns) !== JSON.stringify(columns)) errors.push(`wrong column order ${name}`);
    if (predicate && !normalizePredicate(row.predicate).includes(normalizePredicate(predicate))) errors.push(`wrong predicate ${name}`);
  }
  for (const name of contract.absentIndexes ?? []) if (byIndex.has(name)) errors.push(`retired index still present ${name}`);

  const attributes = await sql.unsafe(`
    select c.relname as table_name,a.attname as column_name,a.attnotnull as not_null
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.attnum>0 and not a.attisdropped
  `);
  const attrs = new Map(attributes.map((row) => [`${row.table_name}.${row.column_name}`, row.not_null]));
  for (const [table, column] of contract.notNull) if (attrs.get(`${table}.${column}`) !== true) errors.push(`missing NOT NULL ${table}.${column}`);
  for (const [table, column] of contract.absentColumns ?? []) if (attrs.has(`${table}.${column}`)) errors.push(`retired column still present ${table}.${column}`);

  const constraints = await sql.unsafe(`select conname, convalidated from pg_constraint`);
  const byConstraint = new Map(constraints.map((row) => [row.conname, row]));
  for (const name of contract.constraints) {
    const row = byConstraint.get(name);
    if (!row?.convalidated) errors.push(`missing or invalid constraint ${name}`);
  }
  const securityTables = await sql.unsafe(`
    select c.relname as table_name, c.relrowsecurity as rls,
      c.relforcerowsecurity as force_rls, r.rolname as owner
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_roles r on r.oid=c.relowner
    where n.nspname='public' and c.relkind='r'
  `);
  const policyTables = new Set((await sql.unsafe(`
    select distinct tablename from pg_policies where schemaname='public'
  `)).map((row) => row.tablename));
  for (const table of securityTables) {
    if (!table.rls || !table.force_rls) errors.push(`RLS no forzada en ${table.table_name}`);
    if (table.owner !== "venta_owner") errors.push(`propietario incorrecto en ${table.table_name}`);
    if (!policyTables.has(table.table_name)) errors.push(`sin policy en ${table.table_name}`);
  }
  const roleAttributes = await sql.unsafe(`
    select rolname, rolcreatedb, rolreplication, rolsuper, rolcreaterole, rolbypassrls
    from pg_roles
    where rolname in ('venta_migrator','venta_app','venta_auth','venta_ingress','venta_backup','venta_restore')
  `);
  const expectedRoles = new Map([
    ["venta_migrator", [false, false, false]],
    ["venta_app", [false, false, false]],
    ["venta_auth", [false, false, false]],
    ["venta_ingress", [false, false, false]],
    // Solo el rol offline de respaldo atraviesa RLS para producir un dump
    // completo. No se entrega al runtime ni conserva privilegios DDL.
    ["venta_backup", [false, false, true]],
    ["venta_restore", [true, false, false]],
  ]);
  for (const role of roleAttributes) {
    const expected = expectedRoles.get(role.rolname);
    if (!expected || role.rolcreatedb !== expected[0] || role.rolreplication !== expected[1]
      || role.rolbypassrls !== expected[2] || role.rolsuper || role.rolcreaterole) {
      errors.push(`atributos inesperados en ${role.rolname}`);
    }
  }
  if (roleAttributes.length !== 6) errors.push("faltan roles runtime esperados");
  const privileges = await sql.unsafe(`
    select has_schema_privilege('venta_app','public','CREATE') as app_create,
      has_database_privilege('venta_restore',current_database(),'CONNECT') as restore_connect
  `);
  if (privileges[0]?.app_create) errors.push("venta_app puede crear en public");
  if (privileges[0]?.restore_connect) errors.push("venta_restore conserva CONNECT");
  if (errors.length) throw new Error(`Schema verification failed:\n${errors.join("\n")}`);
}

async function main() {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL es requerida");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("set role venta_owner");
    await verifySchema(sql);
    console.log("[schema] verificación semántica PASS");
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("verify-schema.mjs")) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
