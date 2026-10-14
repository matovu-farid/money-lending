import { createRequire } from 'node:module';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertLocalTarget, scrubStructured } from './helpers.mjs';
const repo='/Users/faridmatovu/projects/money-lending', root=repo+'/.local-demo';
const config=JSON.parse(await readFile(root+'/config.json','utf8'));
assertLocalTarget(config.url);
const req=createRequire(repo+'/package.json');
const sql=req('postgres')(config.url,{max:1});
const {hashPassword}=await import(pathToFileURL(req.resolve('better-auth/crypto')));
const columns={
  user:['name','email','image','ban_reason'],
  customers:['full_name','nin','contact','address'], creditors:['name','contact','address'],
  bank_accounts:['name'],collateral:['nature','description'],
  loans:['backdate_note'],payments:['edit_reason','delete_reason','marked_wrong_reason'],
  transactions:['description','category'],fund_transfers:['note','backdate_note'],
  loan_waivers:['reason'],rate_change_requests:['review_note'],
  audit_log:['before_value','after_value'],financial_snapshots:['data'],
  historical_rate_repair_approvals:['review_note'],historical_rate_repair_runs:['before_summary','after_summary'],
  portfolio_accrual_repair_approvals:['review_note'],portfolio_accrual_repair_runs:['before_summary','after_summary'],
  rollover_correction_approvals:['review_note'],rollover_correction_runs:['before_summary','after_summary'],
  transaction_categories:['name'],
};
const cleanTables=['session','verification','invitation','admin_ip_allowlist','ip_block_log'];
const retainedText=new Set(['id','loan_id','user_id','customer_id','creditor_id','investment_id','actor_id','entity_id','issued_by','recorded_by','deleted_by','marked_wrong_by','seized_by','created_by','generated_by','updated_by','penalty_waived_by','backdated_by','transferred_by','requested_by','reviewed_by','approved_by','applied_by','delegated_by','revoked_by','plan_hash','input_fingerprint','backup_sha256','policy_version','required_approver_role','role','status','type','action','entity_type','reference_type','reference_id','key','value']);
const accountingNames=new Set(['Cash','Loans Receivable','Interest Receivable','Seized Collateral','Creditor Investment','Share Capital','Bonuses','Interest Earned','Issuance Fees','Overpayment Revenue','User Revenue','Rent','Salaries','Office Expenses','Interest Payments','Interest Payable','DStv','User Expense','Loan Losses']);
const tableNames=['account','admin_ip_allowlist','audit_log','bank_accounts','collateral','creditor_investments','creditor_repayments','creditors','customers','delegation','financial_snapshots','fund_transfers','historical_rate_repair_approvals','historical_rate_repair_runs','invitation','ip_block_log','loan_balances','loan_waivers','loans','payments','portfolio_accrual_repair_approvals','portfolio_accrual_repair_runs','rate_change_requests','rollover_correction_approvals','rollover_correction_runs','session','system_settings','transaction_categories','transactions','user','verification'];
const jsonCols=new Set(['audit_log.before_value','audit_log.after_value','financial_snapshots.data','historical_rate_repair_runs.before_summary','historical_rate_repair_runs.after_summary','portfolio_accrual_repair_runs.before_summary','portfolio_accrual_repair_runs.after_summary','rollover_correction_runs.before_summary','rollover_correction_runs.after_summary']);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonical=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):Array.isArray(value)?value.map(canonical):value;
const financialJson=value=>{
  if (value===null) return null;
  if(Array.isArray(value))return value.map(financialJson);
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(name|email|phone|contact|address|nin|token|secret|password|accountnumber|image|file)/i.test(k.replaceAll('_',''))).map(([k,v])=>[k,financialJson(v)]));
  return typeof value==='number'||typeof value==='boolean'||(typeof value==='string'&&(/^[+-]?\d+(\.\d+)?$/.test(value)||/^\d{4}-\d{2}-\d{2}/.test(value)))?value:null;
};
const readRows=tx=>Promise.all(tableNames.map(async t=>[t,await tx`select * from ${tx('public.'+t)}`])).then(Object.fromEntries);
function fingerprints(rows){
  return Object.fromEntries(tableNames.filter(t=>!cleanTables.includes(t)&&t!=='account').map(t=>{
    const kept=rows[t].map(r=>{
      const v=Object.fromEntries(Object.entries(r).filter(([k])=>!(columns[t]||[]).includes(k)));
      // Safe standard accounting labels retain their exact meaning and spelling.
      if(t==='transaction_categories'&&accountingNames.has(r.name))v.name=r.name;
      for(const k of columns[t]||[])if(jsonCols.has(t+'.'+k)&&r[k]){
        try {v[k]=financialJson(typeof r[k]==='string'?JSON.parse(r[k]):r[k]);}catch {throw Error('Unparseable structured history in '+t+'.'+k);}
      }
      return JSON.stringify(canonical(v));
    }).sort();
    return [t,{count:rows[t].length,sha256:hash(kept)}];
  }));
}
const checks=await sql`select current_database() as db, host(inet_server_addr()) as host, current_user as role`;
if(checks[0].db!==config.database || checks[0].host!=='127.0.0.1'||checks[0].role!=='fidexa_demo_owner')throw Error('Database target guard failed');
const metadata=await sql`select table_name,column_name,udt_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position`;
if([...new Set(metadata.map(x=>x.table_name))].sort().join()!==tableNames.slice().sort().join())throw Error('Unknown public table: classify it before sanitizing');
for(const c of metadata){
  if(['account',...cleanTables].includes(c.table_name))continue;
  if(c.data_type==='text'&&!retainedText.has(c.column_name)&&!(columns[c.table_name]||[]).includes(c.column_name))throw Error('Unclassified text column '+c.table_name+'.'+c.column_name);
  if(['json','jsonb','ARRAY','bytea'].includes(c.data_type)||c.udt_name==='bytea')if(!jsonCols.has(c.table_name+'.'+c.column_name))throw Error('Unclassified structured/binary column');
}
if(process.argv[2]==='verify'){
  const report=JSON.parse(await readFile(root+'/verification.json','utf8'));
  const rows=await readRows(sql), current=fingerprints(rows);
  if(JSON.stringify(current)!==JSON.stringify(report.financialAndRelationshipFingerprints))throw Error('Financial/state verification failed');
  if(rows.user.some(u=>!u.email.endsWith('@example.test')||!u.name.startsWith('Demo ')))throw Error('Unsafe user identity');
  if(rows.customers.some(c=>!c.nin.startsWith('DEMO')||!c.contact.startsWith('000')||!c.address.startsWith('Demo ')))throw Error('Unsafe customer identity');
  if(rows.creditors.some(c=>!c.contact.startsWith('000')||!c.address.startsWith('Demo ')))throw Error('Unsafe creditor identity');
  if(rows.account.some(a=>a.access_token||a.refresh_token||a.id_token))throw Error('Copied provider credentials remain');
  const [{verifyPassword}]=await Promise.all([import(pathToFileURL(req.resolve('better-auth/crypto')))]);
  for(const a of rows.account)if(a.provider_id==='credential'&&!await verifyPassword({password:config.demoPassword,hash:a.password}))throw Error('Copied password hash remains');
  const triggers=await sql`select count(*) as count from pg_trigger t join pg_class c on t.tgrelid=c.oid join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and not t.tgisinternal and t.tgenabled='O'`;
  if(Number(triggers[0].count)!==report.triggersPreserved)throw Error('Trigger verification failed');
  console.log({verified:true,retainedTables:Object.keys(current).length,loans:rows.loans.length,payments:rows.payments.length,transactions:rows.transactions.length,financialRecordsUnchanged:true,identifiersSynthetic:true});
  await sql.end();
  process.exit(0);
}
try{await access(root+'/verification.json');throw Error('Already sanitized. Use verify; do not transform demo data again.');}catch(e){if(e.code!=='ENOENT')throw e;}
let report, demoUser;
await sql.begin(async tx=>{
  const before=await readRows(tx), baseline=fingerprints(before);
  const privateValues=new Set();
  for(const t of ['user','customers','creditors','bank_accounts'])for(const r of before[t])for(const k of columns[t]||[])if(typeof r[k]==='string'&&r[k].trim().length>=4)privateValues.add(r[k].trim());
  const refs=new Set(Object.values(before).flatMap(rs=>rs.flatMap(r=>Object.entries(r).filter(([k,v])=>(k==='id'||k.endsWith('_id')||k.endsWith('_by'))&&typeof v==='string').map(([k,v])=>v))));
  const safeJson=v=>{
    const walk=(v,k='')=>{
      if(typeof v==='string'&&refs.has(v))return v;
      if(Array.isArray(v))return v.map(x=>walk(x,k));
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([key,val])=>[privateValues.has(key)?'Demo label':key,walk(val,key)]));
      return scrubStructured(v,k);
    }; return walk(v);
  };
  const triggers=await tx`select c.relname as table_name,t.tgname from pg_trigger t join pg_class c on t.tgrelid=c.oid join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and not t.tgisinternal and t.tgenabled='O'`;
  for(const t of triggers)await tx.unsafe(`ALTER TABLE "${t.table_name}" DISABLE TRIGGER "${t.tgname}"`);
  const first=['Amara','Elias','Maya','Noah','Zara','Leo','Ava','Luca','Nora'];
  const last=['Lane','Brooks','Reed','Vale','Stone','West','Park'];
  const person=i=>first[i%first.length]+' '+last[Math.floor(i/first.length)%last.length]+' '+String(i+1).padStart(3,'0');
  for(const t of Object.keys(columns)){
    for(const [i,r] of before[t].slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).entries()){
      const values={};
      for(const k of columns[t]){
        if(r[k]===null){values[k]=null;continue;}
        if(jsonCols.has(t+'.'+k)){
          const obj=typeof r[k]==='string'?JSON.parse(r[k]):r[k];
          const safe=safeJson(obj);values[k]=typeof r[k]==='string'?JSON.stringify(safe):tx.json(safe);
        }else if(t==='user')values[k]=k==='name'?'Demo '+(r.role==='superAdmin'?'Owner':r.role==='admin'?'Administrator':'Staff')+' '+(i+1):k==='email'?`staff${i+1}@example.test`:k==='image'?null:'Demo restriction';
        else if(t==='customers'||t==='creditors')values[k]=['name','full_name'].includes(k)?person(i+(t==='creditors'?54:0)):k==='contact'?'000'+String(i+(t==='creditors'?101:1)).padStart(7,'0'):k==='nin'?'DEMO'+String(i+1).padStart(10,'0'):'Demo District, Block '+(i+1);
        else if(t==='bank_accounts')values[k]='Demo Bank '+(i+1);
        else if(t==='transaction_categories')values[k]=accountingNames.has(r.name)?r.name:'Demo '+r.type+' Category '+(i+1);
        else if(k==='category')values[k]=accountingNames.has(r[k])?r[k]:'Demo expense';
        else if(t==='collateral')values[k]=k==='nature'?(/^(land(?: title)?|car|motorcycle|vehicle|electronics|household items|title|logbook|furniture)$/i.test(r[k].trim())?r[k].trim():'Collateral'):'Demo collateral '+(i+1);
        else values[k]='Demo '+k.replaceAll('_',' ');
      }
      await tx`update ${tx('public.'+t)} set ${tx(values)} where id=${r.id}`;
    }
  }
  // Revoke all copied sessions, reset links, invitations and original network identifiers.
  for(const t of cleanTables)await tx`delete from ${tx('public.'+t)}`;
  for(const [i,a]of before.account.entries()){
    const values={account_id:a.provider_id==='credential'?a.user_id:'demo-account-'+(i+1),access_token:null,refresh_token:null,id_token:null,access_token_expires_at:null,refresh_token_expires_at:null,scope:null,password:a.provider_id==='credential'?await hashPassword(config.demoPassword):null};
    await tx`update account set ${tx(values)} where id=${a.id}`;
  }
  for(const r of before.system_settings)if(r.key!=='ip_allowlist_enabled')throw Error('Unknown setting requires classification');
  // Keep the ordinary IP gate; the real login hook records the new loopback IP.
  for(const t of triggers)await tx.unsafe(`ALTER TABLE "${t.table_name}" ENABLE TRIGGER "${t.tgname}"`);
  const after=await readRows(tx), final=fingerprints(after);
  if(JSON.stringify(baseline)!==JSON.stringify(final)){
    const changed=Object.keys(baseline).filter(t=>JSON.stringify(baseline[t])!==JSON.stringify(final[t]));
    throw Error('Retained financial/state fields changed in '+changed.join(', '));
  }
  let leaks=0;
  for(const rs of Object.values(after))for(const r of rs){
    const text=JSON.stringify(r).toLowerCase();
    for(const value of privateValues)if(text.includes(value.toLowerCase()))leaks++;
    if(/https?:\/\//i.test(text)||/[a-z0-9._%+-]+@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/i.test(text))leaks++;
  }
  if(leaks)throw Error('Privacy verification found '+leaks+' remaining identifier matches; transaction rolled back');
  demoUser=after.user.find(u=>u.role==='superAdmin'&&!u.banned&&u.email_verified&&before.account.some(a=>a.user_id===u.id&&a.provider_id==='credential'))||after.user.find(u=>u.role==='admin'&&!u.banned&&u.email_verified&&before.account.some(a=>a.user_id===u.id&&a.provider_id==='credential'));
  if(!demoUser)throw Error('No existing verified admin available for demo; preserve role policy');
  report={verifiedAt:new Date().toISOString(),database:config.database,source:'read-only production snapshot',personalIdentityMatches:leaks,financialAndRelationshipFingerprints:final,clearedSecurityTables:cleanTables,originalSessionsRevoked:before.session.length,triggersPreserved:triggers.length,productionCredentialsReplaced:true};
});
await writeFile(root+'/verification.json',JSON.stringify(report,null,2),{mode:0o600});
await writeFile(root+'/demo-login.json',JSON.stringify({email:demoUser.email,password:config.demoPassword,role:demoUser.role},null,2),{mode:0o600});
console.log({sanitized:true,personalIdentityMatches:report.personalIdentityMatches,loans:report.financialAndRelationshipFingerprints.loans.count,payments:report.financialAndRelationshipFingerprints.payments.count,transactions:report.financialAndRelationshipFingerprints.transactions.count,financialTablesVerified:Object.keys(report.financialAndRelationshipFingerprints).length,originalSessionsRevoked:report.originalSessionsRevoked,triggersPreserved:report.triggersPreserved});
await sql.end();
