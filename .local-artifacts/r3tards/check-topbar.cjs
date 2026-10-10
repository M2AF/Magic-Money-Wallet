const { _electron } = require('playwright');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { createServer } = require('node:http');
(async () => {
 const server=createServer((req,res)=>res.end('<html><body style="background:#121212;color:white">Local browser theme fixture</body></html>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env,MM_TEST_USERDATA:mkdtempSync(join(tmpdir(),'mm-topbar-')),MM_REAL_MAIN:resolve('out/main/index.js'),MM_TEST_NO_BIOMETRICS:'1'};
 delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({args:[resolve('e2e/electron-wrapper.cjs')], executablePath:resolve('node_modules/electron/dist/electron.exe'),env});
 try {
  const wallet=await app.firstWindow();
  await wallet.waitForLoadState('domcontentloaded');
  await wallet.waitForFunction(()=>!!window.wallet);
  await wallet.evaluate(()=>document.documentElement.dataset.theme='r3tards');
  await wallet.evaluate(url=>window.wallet.openInAppBrowser(url),`http://127.0.0.1:${server.address().port}`);
  let browser;
  for(let n=0;n<100 && !browser;n++) { browser=app.windows().find(p=>p.url().includes('browserChrome=1')); if(!browser) await new Promise(r=>setTimeout(r,100)); }
  if (!browser) throw new Error('No browser renderer');
  await browser.waitForLoadState('domcontentloaded');
  await browser.locator('.browser-shell').waitFor();
  await browser.evaluate(()=>document.documentElement.dataset.theme='r3tards');
  await browser.evaluate(()=>document.fonts.ready);
  const css=await browser.evaluate(()=>({ bar:getComputedStyle(document.querySelector('.titlebar')).backgroundColor, shell:getComputedStyle(document.querySelector('.browser-shell')).backgroundImage }));
  if(css.bar!=='rgba(0, 0, 0, 0)' || !css.shell.includes('background-')) throw new Error(JSON.stringify(css));
  await browser.screenshot({path:resolve('.local-artifacts/r3tards/r3tards-browser-transparent-topbar.png'),clip:{x:0,y:0,width:1100,height:95}});
  console.log(JSON.stringify(css));
 } finally {await app.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
