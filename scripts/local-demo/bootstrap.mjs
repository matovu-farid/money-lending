import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const repo='/Users/faridmatovu/projects/money-lending';
const req=createRequire(repo+'/package.json');
const postgres=req('postgres');
const dotenv=req('dotenv');
const root=repo+'/.local-demo';
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const port='5432', db='fidexa_money_lending_demo_20261011';
process.umask(0o077);
await mkdir(root,{recursive:true,mode:0o700});
await chmod(root,0o700);
const run=(name,args,env={})=>{
  const r=spawnSync(bin+name,args,{env:{...process.env,...env},encoding:'utf8'});
  if(r.status!==0) throw new Error(name+' failed: '+(r.stderr||r.stdout).slice(0,2000));
  return r.stdout;
};
if(process.argv[2]==='snapshot'){
  const e=dotenv.parse(await readFile(repo+'/.env'));
  const u=new URL(e.DATABASE_URL_PROD);
  if(!u.hostname.endsWith('.neon.tech') || u.pathname!='/neondb') throw Error('Unexpected production source');
  // Use the current endpoint's direct host, never the stale UNPOOLED alias.
  u.hostname=u.hostname.replace('-pooler','');
  const sql=postgres(u.toString(),{ssl:'require',max:1,connect_timeout:15,connection:{default_transaction_read_only:'on'}});
  const [v]=await sql.begin('read only', tx=>tx`select current_setting('server_version_num') as version, current_setting('transaction_read_only') as read_only`);
  console.log({source:'current production endpoint',serverVersion:v.version,readOnly:v.read_only});
  await sql.end();
  if(Number(v.version)>=180000) throw Error('Installed pg_dump 17 cannot dump PostgreSQL 18');
  run('pg_dump',['--format=custom','--no-owner','--no-privileges','--file='+root+'/production-private.dump'],{
    PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:u.pathname.slice(1),
    PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),
    PGSSLMODE:'require',PGCONNECT_TIMEOUT:'20',PGOPTIONS:'-c default_transaction_read_only=on'
  });
  await chmod(root+'/production-private.dump',0o600);
  console.log({dumpBytes:(await stat(root+'/production-private.dump')).size});
}else if(process.argv[2]==='restore'){
  try{await stat(root+'/config.json'); throw Error('Local demo already initialized');}catch(e){if(e.code!=='ENOENT')throw e;}
  const password=randomBytes(24).toString('base64url');
  const admin=postgres({host:'127.0.0.1',port:5432,database:'postgres',username:process.env.USER,max:1});
  const role='fidexa_demo_owner';
  if((await admin`select 1 from pg_roles where rolname=${role}`).length || (await admin`select 1 from pg_database where datname=${db}`).length) throw Error('Demo role/database already exists; refusing replacement');
  await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  await admin.unsafe(`CREATE DATABASE "${db}" OWNER "${role}"`);
  await admin.unsafe(`REVOKE ALL ON DATABASE "${db}" FROM PUBLIC`);
  await admin.end();
  const env={PGHOST:'127.0.0.1',PGPORT:port,PGUSER:role,PGPASSWORD:password,PGDATABASE:db,PGSSLMODE:'disable',PGOPTIONS:''};
  const url=`postgresql://${role}:${password}@127.0.0.1:${port}/${db}`;
  await writeFile(root+'/config.json',JSON.stringify({url,root,port:Number(port),database:db,authSecret:randomBytes(32).toString('base64url'),demoPassword:randomBytes(18).toString('base64url')},null,2),{mode:0o600});
  run('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--dbname='+db,root+'/production-private.dump'],{...env,PGDATABASE:db});
  console.log('Restored isolated local database at 127.0.0.1:'+port+'/'+db);
}else throw Error('Use snapshot or restore');
