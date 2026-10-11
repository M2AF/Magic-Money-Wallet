import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'

test('production browser chrome has holder-gated Sovereign motion and cleans up on lock', async ({ page }) => {
  const root = resolve('out/renderer')
  test.skip(!existsSync(resolve(root, 'index.html')), 'out/renderer missing — run `npm run build` first (CI e2e builds only the extension)')
  const server = createServer((req, res) => {
    const path = resolve(root, '.' + new URL(req.url!, 'http://localhost').pathname.replace(/^\/$/, '/index.html'))
    if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) { res.writeHead(403).end(); return }
    try {
      res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' } as Record<string,string>)[extname(path)] || 'application/octet-stream')
      res.end(readFileSync(path))
    } catch { res.writeHead(404).end() }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port:number }).port
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('mm.theme', 'sovereign')
    const callbacks: Record<string, (...args: any[]) => void> = {}
    ;(window as any).browserFixtureCallbacks = callbacks
    const methods: Record<string, any> = {
      isUnlocked: async () => true,
      getAddresses: async () => ({ evm:'0x1111111111111111111111111111111111111111' }),
      browserGetState: async () => ({ url:'https://chainlensnft.info', canBack:false, canForward:false, loading:false, tabs:[], activeTabId:0 }),
      browserGetTorState: async () => ({ enabled:false, ready:false }),
      browserGetMagicGuardState: async () => ({ host:'chainlensnft.info', level:'safe', blockedThisTab:0 }),
      browserGetPageState: async () => ({ url:'https://chainlensnft.info', host:'chainlensnft.info', savedLogins:[], passwordsUnlocked:false }),
      browserListDownloads: async () => ({ items:[], canShowInFolder:false, canPause:false }),
      browserListHistory: async () => ({ items:[], recording:true }),
      web3GetChains: async () => [{ id:'ethereum', chainId:1, name:'Ethereum', symbol:'ETH', color:'#627eea' }],
      web3GetChain: async () => 1,
      getFxRates: async () => ({ rates:{ USD:1 }, fetchedAt:Date.now() }),
    }
    window.wallet = new Proxy(methods, { get: (target, key:string) => target[key] || (key.startsWith('on') ? (cb:any) => { callbacks[key] = cb } : key.startsWith('off') ? () => {} : async () => false) }) as any
  })
  await page.route('https://rpc.mainnet.chain.robinhood.com/', route => {
    const call = route.request().postDataJSON()
    return route.fulfill({ json:{ jsonrpc:'2.0', id:call.id, result:call.method === 'eth_chainId' ? '0x1237' : call.method === 'eth_blockNumber' ? '0xabc' : '0x'+'1'.padStart(64,'0') } })
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/?browserChrome=1`)
    await expect(page.locator('.browser-toolbar')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sovereign')
    await expect(page.locator('.sv-scene')).toHaveCount(1)
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion', 'running')
    const toolbar = page.locator('.browser-toolbar')
    await toolbar.hover({ position:{ x:400,y:16 } })
    await expect.poll(() => toolbar.evaluate(el => el.style.getPropertyValue('--sv-x'))).not.toBe('')
    await page.getByTitle('Reload', { exact:true }).dispatchEvent('pointerdown', { button:0, clientX:95, clientY:65 })
    await expect(page.locator('.sv-ripple')).toHaveCount(1)
    await page.screenshot({ path:'.local-artifacts/sovereign/browser.png' })
    await page.emulateMedia({ reducedMotion:'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion', 'paused')
    await expect(page.locator('.sv-ripple')).toHaveCount(0)
    await page.evaluate(() => (window as any).browserFixtureCallbacks.onLocked())
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'sovereign')
    expect(errors).toEqual([])
  } finally { await new Promise<void>(done => server.close(() => done())) }
})
