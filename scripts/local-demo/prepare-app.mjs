import {copyFile,cp,mkdir,symlink,readFile,writeFile,access} from 'node:fs/promises';
const repo='/Users/faridmatovu/projects/money-lending',app=repo+'/.local-demo/app';
await mkdir(app,{recursive:true,mode:0o700});
for(const name of ['src','public'])await cp(repo+'/'+name,app+'/'+name,{recursive:true});
for(const name of ['package.json','pnpm-lock.yaml','tsconfig.json','postcss.config.mjs','next-env.d.ts','next.config.ts']){
  try {await copyFile(repo+'/'+name,app+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
}
try {await access(app+'/node_modules');}catch {await symlink(repo+'/node_modules',app+'/node_modules','dir');}
const file=app+'/next.config.ts';
let config=await readFile(file,'utf8');
config=config.replace('/* config options here */',`/* Private local demo configuration */\n  turbopack: { root: ${JSON.stringify(repo)} },\n  devIndicators: false,`);
await writeFile(file,config);
console.log('Prepared isolated app copy without production env files');
