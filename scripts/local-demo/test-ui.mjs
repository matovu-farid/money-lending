import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {assertLocalTarget} from './helpers.mjs';
const repo='/Users/faridmatovu/projects/money-lending';
const creds=JSON.parse(await readFile(repo+'/.local-demo/demo-login.json','utf8'));
const config=JSON.parse(await readFile(repo+'/.local-demo/config.json','utf8'));
assertLocalTarget(config.url);
const cypress=createRequire(repo+'/package.json')('cypress');
// No project support file, DB reset tasks, seeds, test auth endpoints or env loader.
const result=await cypress.run({project:repo,configFile:repo+'/scripts/local-demo/cypress.config.cjs',browser:'electron',headless:true,spec:repo+'/scripts/local-demo/demo.cy.cjs',env:{demoEmail:creds.email,demoPassword:creds.password}});
const summary={verifiedAt:new Date().toISOString(),totalTests:result.totalTests,totalPassed:result.totalPassed,totalFailed:result.totalFailed};
await writeFile(repo+'/.local-demo/ui-results.json',JSON.stringify(summary,null,2),{mode:0o600});
console.log(summary);
process.exit(result.totalFailed===0&&result.totalTests>0?0:1);
