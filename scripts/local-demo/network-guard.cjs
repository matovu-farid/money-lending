// Loaded only by the local demo launcher. Prevent outbound connections even
// if a future screen imports a provider or an environment alias is missed.
const net=require('node:net');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  let options=args[0];
  if(Array.isArray(options))options=options[0];
  const host=options&&typeof options==='object'?options.host:typeof args[1]==='string'?args[1]:undefined;
  if(host && !['127.0.0.1','localhost','::1'].includes(host))throw Error('Local demo blocks outbound network connections');
  return connect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,...rest){
  const raw=typeof input==='string'||input instanceof URL?input:input.url;
  const u=new URL(raw);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Local demo blocks outbound requests');
  return originalFetch.call(this,input,...rest);
};
