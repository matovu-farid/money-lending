import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {assertLocalTarget,assertRuntimeTarget} from './helpers.mjs';
const repo='/Users/faridmatovu/projects/money-lending',file=repo+'/.local-demo/config.json';
const config=JSON.parse(await readFile(file,'utf8'));
assertLocalTarget(config.url);
const postgres=createRequire(repo+'/package.json')('postgres');
const password=randomBytes(24).toString('base64url'),role='fidexa_demo_app';
const admin=postgres({host:'127.0.0.1',port:5432,database:config.database,username:process.env.USER,max:1});
await admin.begin(async tx=>{
  const [target]=await tx`select current_database() as db,host(inet_server_addr()) as host`;
  if(target.db!==config.database||target.host!=='127.0.0.1')throw Error('Local database target guard failed');
  if((await tx`select 1 from pg_roles where rolname=${role}`).length)throw Error('Runtime role already exists');
  const unsafe=await tx`select count(*) as count from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and prosecdef`;
  if(Number(unsafe[0].count)>0)throw Error('Review security-definer functions before launching read-only runtime');
  await tx.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  await tx.unsafe(`GRANT CONNECT ON DATABASE "${config.database}" TO "${role}"`);
  await tx.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await tx.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`);
  await tx.unsafe(`GRANT INSERT,UPDATE,DELETE ON public.session,public.admin_ip_allowlist,public.ip_block_log TO "${role}"`);
});
await admin.end();
const url=new URL(config.url);url.username=role;url.password=password;
config.runtimeUrl=url.toString();
assertRuntimeTarget(config.runtimeUrl);
const runtime=postgres(config.runtimeUrl,{max:1});
await runtime.begin(async tx=>{
  await tx`select 1 from loans limit 1`;
  const privileges=await tx`select table_name,has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'INSERT') as ins,has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'UPDATE') as upd,has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'DELETE') as del,has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'TRUNCATE') as trunc from information_schema.tables where table_schema='public'`;
  for(const table of privileges){
    const authTable=['session','admin_ip_allowlist','ip_block_log'].includes(table.table_name);
    if(table.trunc||(!authTable&&(table.ins||table.upd||table.del))||(authTable&&!(table.ins&&table.upd&&table.del)))throw Error('Unexpected runtime table privileges');
  }
  for(const table of ['loans','payments','transactions','creditor_investments','creditor_repayments','fund_transfers','loan_balances']){
    let denied=false;
    const column=table==='loans'?'principal_amount':table==='loan_balances'?'outstanding_balance':'amount';
    try {await tx.savepoint(async s=>s.unsafe(`UPDATE "${table}" SET "${column}"="${column}" WHERE false`));}catch(e){denied=e.code==='42501';}
    if(!denied)throw Error('Runtime financial writes were not rejected');
  }
});
await runtime.end();
await writeFile(file,JSON.stringify(config,null,2),{mode:0o600});
console.log('Runtime role verified: financial reads allowed; financial writes denied');
