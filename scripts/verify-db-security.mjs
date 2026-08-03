import postgres from "postgres";

const url = process.env.SECURITY_DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error("SECURITY_DATABASE_URL es requerida");
const sql = postgres(url,{max:1,onnotice:()=>{}});
const errors=[];
try {
  const expected={venta_owner:[false,false,false,false,false,false],venta_migrator:[true,false,false,false,false,false],venta_app:[true,false,false,false,false,false],venta_auth:[true,false,false,false,false,false],venta_ingress:[true,false,false,false,false,false],venta_backup:[true,false,false,false,false,true],venta_restore:[true,false,true,false,false,false]};
  const roles=await sql`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=any(${Object.keys(expected)})`;
  for(const [name,flags] of Object.entries(expected)){const row=roles.find(r=>r.rolname===name);if(!row||JSON.stringify(Object.values(row).slice(1))!==JSON.stringify(flags))errors.push(`atributos ${name}`);}
  const tables=await sql`select c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname owner from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname='public' and c.relkind='r'`;
  const policies=new Set((await sql`select tablename from pg_policies where schemaname='public'`).map(r=>r.tablename));
  for(const table of tables){if(!table.relrowsecurity||!table.relforcerowsecurity)errors.push(`RLS ${table.relname}`);if(!policies.has(table.relname))errors.push(`policy ${table.relname}`);if(table.owner!=="venta_owner")errors.push(`owner ${table.relname}`);}
  const [priv]=await sql`select has_schema_privilege('venta_app','public','CREATE') app_create,has_database_privilege('venta_restore',current_database(),'CONNECT') restore_connect,exists(select 1 from pg_database d,lateral aclexplode(d.datacl) a where d.datname=current_database() and a.grantee=0 and a.privilege_type='CONNECT') public_connect`;
  if(priv.app_create)errors.push("venta_app CREATE");if(priv.restore_connect)errors.push("venta_restore CONNECT");if(priv.public_connect)errors.push("PUBLIC CONNECT");
}finally{await sql.end();}
if(errors.length){console.error("PostgreSQL security FAIL",errors);process.exitCode=1;}else console.log("PostgreSQL security PASS: roles, ownership y RLS");
