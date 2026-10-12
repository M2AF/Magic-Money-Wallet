import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
const root = resolve('out/renderer')
const server = createServer((req, res) => {
  const p = resolve(root, '.' + new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'))
  try { res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'})[extname(p)]||'application/octet-stream'); res.end(readFileSync(p)) } catch { res.writeHead(404).end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const [w,h,theme] = [Number(process.argv[2]||1000), Number(process.argv[3]||700), process.argv[4]||'']
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:w,height:h} })
await page.addInitScript((theme) => {
  if (theme) localStorage.setItem('mm.theme', theme)
  const cbs = {}; window.cbs = cbs
  const m = {
    isUnlocked: async()=>true, getAddresses: async()=>({evm:'0x1111111111111111111111111111111111111111'}),
    browserGetState: async()=>({url:'https://chainlensnft.info',canBack:false,canForward:false,loading:false,tabs:[{id:1,title:'ChainLens',url:'https://chainlensnft.info',loading:false},{id:2,title:'Uniswap',url:'https://app.uniswap.org',loading:false}],activeTabId:1}),
    browserGetTorState: async()=>({enabled:false,ready:false}),
    browserGetMagicGuardState: async()=>({host:'chainlensnft.info',level:'safe',blockedThisTab:3}),
    browserGetPageState: async()=>({url:'https://chainlensnft.info',host:'chainlensnft.info',savedLogins:[],passwordsUnlocked:false}),
    browserListDownloads: async()=>({items:[],canShowInFolder:false,canPause:false}),
    browserListHistory: async()=>({items:[],recording:true}),
    web3GetChains: async()=>[{id:'ethereum',chainId:1,name:'Ethereum',symbol:'ETH',color:'#627eea'},{id:'polygon',chainId:137,name:'Polygon',symbol:'POL',color:'#8247e5'},{id:'base',chainId:8453,name:'Base',symbol:'ETH',color:'#0052ff'}],
    web3GetChain: async()=>'0x1', getFxRates: async()=>({rates:{USD:1},fetchedAt:Date.now()}),
    browserSuspendTabsMenu: async()=>'',
  }
  window.wallet = new Proxy(m, { get:(t,k)=>t[k]||(String(k).startsWith('on')?(cb)=>{cbs[k]=cb}:String(k).startsWith('off')?()=>{}:async()=>false) })
}, theme)
await page.goto(`http://127.0.0.1:${port}/?browserChrome=1`)
await page.waitForSelector('.browser-toolbar')
await page.waitForTimeout(800)
const btns = await page.$$eval('.browser-toolbar button, .browser-toolbar [role=button]', els => els.map(e => ({t:e.title||e.getAttribute('aria-label')||e.textContent.trim().slice(0,20), r:e.getBoundingClientRect().toJSON()})))
console.log(JSON.stringify(btns.map(b=>[b.t,Math.round(b.r.x),Math.round(b.r.y),Math.round(b.r.width)])))
await page.screenshot({ path:`.local-artifacts/dd/closed-${w}.png` })
for (const [i, bt] of btns.entries()) {
  if (/back|forward|reload|stop|minim|close|full|star|bookmark/i.test(bt.t)) continue
  const loc = page.locator('.browser-toolbar button, .browser-toolbar [role=button]').nth(i)
  await loc.click({ force:true }).catch(()=>{})
  await page.waitForTimeout(400)
  const info = await page.evaluate(() => {
    const out = []
    const vw = innerWidth, vh = innerHeight
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el)
      if ((cs.position==='absolute'||cs.position==='fixed') && el.getBoundingClientRect().width>60 && el.getBoundingClientRect().height>40 && cs.visibility!=='hidden' && cs.display!=='none' && cs.pointerEvents!=='none') {
        const r = el.getBoundingClientRect()
        if (r.width>=vw-2 && r.height>=vh-2) return
        const cx = r.x + Math.min(r.width/2, 40), cy = r.y + Math.min(r.height/2, 40)
        const top = document.elementFromPoint(Math.max(0,Math.min(vw-1,cx)), Math.max(0,Math.min(vh-1,cy)))
        out.push({ cls: (el.className||'').toString().slice(0,50), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), clippedR: r.right>vw+1, clippedB: r.bottom>vh+1, clippedL: r.left<-1, covered: !(top && (el===top||el.contains(top))) })
      }
    })
    return out
  })
  console.log('OPEN', JSON.stringify(bt.t), JSON.stringify(info))
  await page.screenshot({ path:`.local-artifacts/dd/${w}-${i}.png` })
  await page.keyboard.press('Escape'); await page.mouse.click(5, h-5); await page.waitForTimeout(200)
}
await b.close(); server.close()
