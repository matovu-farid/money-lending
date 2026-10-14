const {test}=require('node:test');
const assert=require('node:assert/strict');
require('./network-guard.cjs');
test('provider fetch is rejected before a request is sent',async()=>{
  await assert.rejects(fetch('https://api.resend.com/emails'),/blocks outbound/);
});
test('production database socket is rejected before a connection is made',()=>{
  const net=require('node:net');
  assert.throws(()=>new net.Socket().connect({host:'example.neon.tech',port:5432}),/blocks outbound/);
});
