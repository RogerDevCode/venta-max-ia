import postgres from "postgres";
import { randomUUID } from "node:crypto";

for(const name of ["APP_DATABASE_URL","AUTH_DATABASE_URL"]){if(!process.env[name])throw new Error(`${name} requerida`);}
const app=postgres(process.env.APP_DATABASE_URL,{max:8});
const auth=postgres(process.env.AUTH_DATABASE_URL,{max:2});
const temporaryOrganizationIds=[];
try{
  const orgs=await auth`select id from organization order by id limit 2`;
  while(orgs.length<2){
    const temporaryOrganizationId=`security-probe-${randomUUID()}`;
    await auth`insert into organization(id,name,slug) values(${temporaryOrganizationId},'Security probe',${temporaryOrganizationId})`;
    temporaryOrganizationIds.push(temporaryOrganizationId);
    orgs.push({id:temporaryOrganizationId});
  }
  await auth`select count(*) from contact`.then(()=>{throw new Error("auth leyó dominio");},()=>{});
  const probe=async(id)=>app.begin(async tx=>{await tx`select set_config('app.organization_id',${id},true)`;const rows=await tx`select id from organization`;if(rows.length!==1||rows[0].id!==id)throw new Error("fuga concurrente");return id;});
  const cases=Array.from({length:16},(_,i)=>orgs[i%2].id);
  const results=await Promise.all(cases.map(probe));
  if(JSON.stringify(results)!==JSON.stringify(cases))throw new Error("contexto concurrente");
  await app.begin(async tx=>{const rows=await tx`select * from contact`;if(rows.length)throw new Error("sin contexto expuso filas");});
  await app.begin(async tx=>{await tx`select set_config('app.organization_id',${orgs[0].id},true)`;const cross=await tx`select * from contact where organization_id=${orgs[1].id}`;if(cross.length)throw new Error("lectura cruzada");});
  let crossWriteRejected=false;
  try{await app.begin(async tx=>{await tx`select set_config('app.organization_id',${orgs[0].id},true)`;await tx`insert into contact(id,organization_id,channel,external_address,name) values(${randomUUID()},${orgs[1].id},'test','rls-probe','probe')`;});}catch{crossWriteRejected=true;}
  if(!crossWriteRejected)throw new Error("escritura cruzada permitida");
  await app`create table forbidden_probe(id int)`.then(()=>{throw new Error("DDL permitido");},()=>{});
  await app`set role venta_owner`.then(()=>{throw new Error("SET ROLE permitido");},()=>{});
  console.log("PostgreSQL bypass PASS: A/B, auth, DDL, concurrencia y pool");
}finally{
  if(temporaryOrganizationIds.length)await auth`delete from organization where id=any(${temporaryOrganizationIds})`;
  await Promise.all([app.end(),auth.end()]);
}
