import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertLocalTarget,assertRuntimeTarget} from './helpers.mjs';
const repo='/Users/faridmatovu/projects/money-lending',root=repo+'/.local-demo',app=root+'/app';
const config=JSON.parse(await readFile(root+'/config.json','utf8'));
const report=JSON.parse(await readFile(root+'/verification.json','utf8'));
assertLocalTarget(config.url);
assertRuntimeTarget(config.runtimeUrl);
const runtimeUrl=config.runtimeUrl;
if(report.database!==config.database||report.personalIdentityMatches!==0)throw Error('Sanitization verification required before launch');
const req=createRequire(repo+'/package.json'),dotenv=req('dotenv');
// Never inherit provider credentials from any source env file. Explicit empty
// values also prevent Next's env-file loader from populating missing keys.
const env={...process.env};
const keys=new Set(Object.keys(env));
for(const name of await readdir(repo))if(/^\.env(?:\.|$)/.test(name)){
  for(const key of Object.keys(dotenv.parse(await readFile(repo+'/'+name))))keys.add(key);
}
for(const key of keys){
  if(/^(DATABASE_URL|POSTGRES_URL)/.test(key))env[key]=runtimeUrl;
  else if(/^PG(HOST|PORT|DATABASE|USER|PASSWORD|SSLMODE|OPTIONS)/.test(key))env[key]='';
  else if(/^(POSTGRES_|RESEND_|SENTRY_|NEXT_PUBLIC_SENTRY_|VERCEL_|BETTER_AUTH_|CRON_SECRET|REQUEST_ACCESS_EMAIL|EMAIL_FROM|CYPRESS)/.test(key))env[key]='';
}
Object.assign(env,{
  DATABASE_URL:runtimeUrl,DATABASE_URL_PROD:runtimeUrl,DATABASE_URL_UNPOOLED:runtimeUrl,DATABASE_URL_TEST:runtimeUrl,DATABASE_URL_TEST_UNPOOLED:runtimeUrl,
  POSTGRES_URL:runtimeUrl,POSTGRES_URL_NON_POOLING:runtimeUrl,POSTGRES_PRISMA_URL:runtimeUrl,POSTGRES_URL_NO_SSL:runtimeUrl,
  PGHOST:'127.0.0.1',PGHOST_UNPOOLED:'127.0.0.1',PGPORT:'5432',PGDATABASE:config.database,PGUSER:'fidexa_demo_app',PGPASSWORD:new URL(runtimeUrl).password,PGSSLMODE:'disable',PGOPTIONS:'',
  POSTGRES_HOST:'127.0.0.1',POSTGRES_DATABASE:config.database,POSTGRES_USER:'fidexa_demo_app',POSTGRES_PASSWORD:new URL(runtimeUrl).password,
  BETTER_AUTH_URL:'http://127.0.0.1:3483',BETTER_AUTH_SECRET:config.authSecret,NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3483',
  RESEND_API_KEY:'re_local_demo_no_delivery',REQUEST_ACCESS_EMAIL:'demo@example.test',EMAIL_FROM:'Demo <demo@example.test>',CRON_SECRET:config.authSecret,
  BUSINESS_TIMEZONE:'Africa/Kampala',NODE_ENV:'development',CYPRESS:'false',NEXT_TELEMETRY_DISABLED:'1',
  NODE_OPTIONS:'--require '+fileURLToPath(new URL('./network-guard.cjs',import.meta.url)),
});
const child=spawn(process.execPath,[req.resolve('next/dist/bin/next'),'dev',app,'--turbopack','--hostname','127.0.0.1','--port','3483'],{cwd:app,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
