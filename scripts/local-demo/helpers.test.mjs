import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalTarget, scrubStructured } from './helpers.mjs';
test('accepts only the dedicated loopback demo database',()=>{
  assert.equal(assertLocalTarget('postgres://fidexa_demo_owner:secret@127.0.0.1:5432/fidexa_money_lending_demo_20261011'),true);
  for(const url of ['postgres://a:b@prod.neon.tech:5432/fidexa_money_lending_demo_20261011','postgres://a:b@127.0.0.1:5432/neondb','postgres://a:b@localhost:5432/fidexa_money_lending_demo_20261011'])
    assert.throws(()=>assertLocalTarget(url));
});
test('removes nested identifiers and prose while preserving amounts, dates, flags and references',()=>{
  const value={customer:{full_name:'Actual Borrower',nin:'CM900011111',contact:'0770123456',address:'Actual address'},principal_amount:'1250000.00',interest_rate:0.15,active:true,when:'2026-08-01T00:00:00.000Z',loan_id:'9a6ee114-ec89-4fe1-b738-953bd38e81fa',note:'Actual Borrower paid from 0770123456',history:[{amount:1200,name:'Actual Borrower'}]};
  const safe=scrubStructured(value);
  assert.equal(safe.principal_amount,value.principal_amount);
  assert.equal(safe.interest_rate,value.interest_rate);
  assert.equal(safe.when,value.when);
  assert.equal(safe.loan_id,value.loan_id);
  assert.equal(safe.active,true);
  assert.equal(safe.history[0].amount,1200);
  assert.equal(JSON.stringify(safe).includes('Actual'),false);
  assert.equal(JSON.stringify(safe).includes('0770123456'),false);
});
test('redacts numeric identifiers before treating strings as financial values',()=>{
  const safe=scrubStructured({phone:'0770123456',accountNumber:99112233,email:'name@company.com',amount:'99112233',password:'secret',accessToken:'token',file_name:'Passport Actual.pdf'});
  assert.equal(safe.phone,'Demo contact');
  assert.equal(safe.accountNumber,'Demo identifier');
  assert.equal(safe.email,'demo@example.test');
  assert.equal(safe.amount,'99112233');
  assert.equal(safe.password,null);
  assert.equal(safe.accessToken,null);
  assert.equal(safe.file_name,'Demo document');
});

import {assertRuntimeTarget} from './helpers.mjs';
test('launcher accepts only the approved restricted role on the dedicated local database',()=>{
  assert.equal(assertRuntimeTarget('postgres://fidexa_demo_app:secret@127.0.0.1:5432/fidexa_money_lending_demo_20261011'),true);
  for(const url of ['postgres://fidexa_demo_owner:secret@127.0.0.1:5432/fidexa_money_lending_demo_20261011','postgres://fidexa_demo_app:secret@prod.neon.tech:5432/fidexa_money_lending_demo_20261011','postgres://fidexa_demo_app:secret@127.0.0.1:5432/neondb'])
    assert.throws(()=>assertRuntimeTarget(url));
});
