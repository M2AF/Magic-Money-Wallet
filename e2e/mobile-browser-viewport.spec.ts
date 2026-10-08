import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

// Actual mobile chrome and CSS; only native page rendering/storage are mocked.
// Native inset intersection is independently covered by the Android JVM tests.
test('mobile browser bounds meet the wallet nav after resizing and opening panels',async({page})=>{
  test.setTimeout(90_000)
  const nativeMock=`export const DappBrowser={
    getState:async()=>({tabs:[],activeTabId:-1}),
    getTorState:async()=>({enabled:false,status:'unsupported'}),
    getMagicGuardState:async()=>({enabled:true,status:'ready'}),
    addListener:async()=>({remove(){}}),show:async()=>{},hide:async()=>{},
    open:async({bounds})=>{window.__bounds=bounds;return {tabId:1}},
    setBounds:async(bounds)=>{window.__bounds=bounds},close:async()=>{}
  }`
  const result=await build({
    stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserOverlay} from './src/capacitor/BrowserOverlay';
      import {emitUiEvent} from './src/capacitor/platform-capacitor';
      import './src/renderer/index.css'; import './src/capacitor/cap.css';
      window.wallet=new Proxy({}, {get:(_,key)=>async()=>key==='browserGetPageState'?{url:'https://example.test',title:'Page',savedLogins:[]}:key==='web3GetChain'?1:String(key).toLowerCase().includes('downloads')?{items:[]}:[]});
      createRoot(document.getElementById('root')).render(<><button id="open" onClick={()=>emitUiEvent('cap:browser:open',{url:'https://example.test'})}>Open fixture</button><BrowserOverlay/><nav className="bottom-nav" style={{position:'fixed',bottom:0,left:0,right:0}}><button>Portfolio</button><button>Market</button><button>Swap</button><button>Apps</button><button>Browser</button></nav></>);`,resolveDir:resolve('.'),loader:'tsx'},
    bundle:true,write:false,outfile:'fixture.js',platform:'browser',jsx:'automatic',
    loader:{'.png':'dataurl','.svg':'dataurl','.webp':'dataurl','.jpg':'dataurl','.jpeg':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},
    plugins:[{name:'native-fixture',setup(b){
      b.onResolve({filter:/\/dapp-browser$/},()=>({path:'native',namespace:'fixture'}))
      b.onResolve({filter:/\/browser-data-local$/},()=>({path:'data',namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='native'?nativeMock:'export const getHistory=async()=>[]; export const recordVisit=async()=>[]; export const updateHistoryTitle=async()=>{}; export const setHistoryRecording=()=>{};',loader:'js'}))
    }}],
  })
  const assets=new Map(result.outputFiles.map(f=>[f.path.split(/[\\/]/).pop()!,f.text]))
  const server=createServer((req,res)=>{
    const name=req.url?.slice(1)
    res.setHeader('Content-Type',name==='fixture.js'?'text/javascript':name==='fixture.css'?'text/css':'text/html')
    res.end(assets.get(name!) ?? '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>')
  })
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done))
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message))
  try {
    await page.setViewportSize({width:390,height:844})
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`)
    await expect(page.locator('#open')).toBeVisible({timeout:5000})
    await page.locator('#open').click()
    const assertBounds=async()=>{
      await expect.poll(()=>page.evaluate(()=>{
        const b=(window as any).__bounds,nav=document.querySelector('.bottom-nav')!.getBoundingClientRect()
        return b?Math.abs(b.y+b.height-nav.top):999
      })).toBeLessThanOrEqual(1)
    }
    await assertBounds()
    // A larger actual nav replaces the initial 54px strip immediately.
    await page.locator('.bottom-nav').evaluate(el=>(el as HTMLElement).style.height='74px')
    await assertBounds()
    const initial=await page.evaluate(()=>(window as any).__bounds)
    await page.getByRole('button',{name:'Browser menu',exact:true}).click()
    await expect.poll(()=>page.evaluate(()=>(window as any).__bounds.y)).toBeGreaterThan(initial.y)
    await assertBounds()
    await page.getByRole('button',{name:'Browser menu',exact:true}).click()
    for(const size of [{width:844,height:390},{width:390,height:520}]){
      await page.setViewportSize(size); await assertBounds()
    }
    expect(errors).toEqual([])
  } finally {
    // Chromium keeps asset connections alive; don't wait for those to expire.
    server.closeAllConnections()
    await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()))
  }
})
