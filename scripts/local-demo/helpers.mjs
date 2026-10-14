export function assertLocalTarget(value) {
  const u=new URL(value);
  if (!['postgres:','postgresql:'].includes(u.protocol) || u.hostname!=='127.0.0.1' || u.port!=='5432' || u.pathname!=='/fidexa_money_lending_demo_20261011' || u.username!=='fidexa_demo_owner')
    throw Error('Refusing to write outside the isolated local demo database');
  return true;
}
const normalize=key=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
export function scrubStructured(value, key='') {
  if (value===null || value===undefined) return value;
  const k=normalize(key);
  if (/password|token|secret|avatar|image|attachment|documentdata/.test(k)) return null;
  if (/email/.test(k)) return 'demo@example.test';
  if (/phone|contact|mobile/.test(k)) return 'Demo contact';
  if (/nin|nationalid|accountnumber|passport|registration|license/.test(k)) return 'Demo identifier';
  if (/address|locationname/.test(k)) return 'Demo District';
  if (/filename/.test(k)) return 'Demo document';
  if (/fullname|customername|creditorname|username|^name$/.test(k)) return 'Demo person';
  if (Array.isArray(value)) return value.map(v=>scrubStructured(v,key));
  if (typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrubStructured(v,k)]));
  if (typeof value!=='string') return value;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value) || /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+Z-]+)?$/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return value;
  if (['active','inactive','blacklisted','pending','approved','rejected','paid','closed','overdue','cash','bank','strong_room','admin','superAdmin','loanOfficer','supervisor','unassigned','income','expense','transfer','asset','liability','equity','revenue','short_term','long_term'].includes(value)) return value;
  return 'Demo record';
}

export function assertRuntimeTarget(value) {
  const u=new URL(value);
  if(u.username!=='fidexa_demo_app')throw Error('Demo launcher requires the restricted runtime role');
  u.username='fidexa_demo_owner';
  return assertLocalTarget(u.toString());
}
