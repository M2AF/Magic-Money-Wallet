const fs = require('node:fs');
const { transformSync } = require('esbuild');
const source = fs.readFileSync('src/renderer/lib/sovereign-access.ts', 'utf8');
fs.writeFileSync('.local-artifacts/sovereign-holder/access.mjs', transformSync(source,{loader:'ts',format:'esm',target:'es2022'}).code);
(async () => {
 const {readRedactedOwnership,REDACTED_CONTRACT,REDACTED_RPC}=await import('./access.mjs');
 const holder = await readRedactedOwnership('0x01faf6dfc230d755141d84d7cb980dd68f5efe13');
 const empty = await readRedactedOwnership('0x0000000000000000000000000000000000000001');
 const record={at:new Date().toISOString(),contract:REDACTED_CONTRACT,rpc:REDACTED_RPC,chainId:4663,erc721Support:true,holder,empty,note:'Read-only direct live RPC probes; public contract owner queried, no wallet unlock/signing.'};
 fs.writeFileSync('.local-artifacts/sovereign-holder/live-probe.json',JSON.stringify(record,null,2));
 console.log(JSON.stringify(record));
})().catch(error=>{console.error(error.message);process.exitCode=1});
