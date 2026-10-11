import { expect, test, chromium } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stubWorker } from './support/worker-stub-browser'

test.use({ actionTimeout: 10_000 })

test('Sovereign motion, interactions, accessibility and theme lifecycle', async () => {
  test.setTimeout(180_000)
  const dist = resolve('dist-extension')
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-art-theme-')), {
    headless: false, viewport: { width: 400, height: 850 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
  await stubWorker(context)
  const errors: string[] = []
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const page = await context.newPage()
    const settle = () => page.evaluate(async () => {
      await document.fonts.ready
      for (const animation of document.getAnimations()) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
          try { animation.finish() } catch { /* Responsive transition detached. */ }
        }
      }
    })
    page.on('pageerror', e => errors.push(e.message))
    let holderBalance = 0
    let failOwnership = false
    await page.route('https://rpc.mainnet.chain.robinhood.com/', async route => {
      const call = route.request().postDataJSON()
      if (failOwnership) { await route.fulfill({status:503,body:'Unavailable'}); return }
      await route.fulfill({ json: { jsonrpc:'2.0', id:call.id, result:call.method === 'eth_chainId' ? '0x1237' : call.method === 'eth_blockNumber' ? '0xabc' : '0x'+holderBalance.toString(16).padStart(64,'0') } })
    })
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/sidepanel.html`)
    await page.getByText('Create New Wallet').click()
    await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
    await page.getByText('Reveal phrase').click()
    await page.getByText("I've Written It Down — Continue").click()
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check()
    await page.getByRole('button', { name: /Save Wallet/i }).click()
    await page.getByPlaceholder(/Password \(min/).fill('art-theme-test-password')
    await page.getByPlaceholder('Confirm password').fill('art-theme-test-password')
    await page.evaluate(() => {
      const w = window.wallet
      w.customThemesGet = async () => ({})
      w.customThemesPush = async entries => ({ entries, error: null })
      w.assetFiltersGet = async () => ({})
      w.assetFiltersPush = async entries => ({ entries, error: null })
      w.getBalances = async () => ({ chains: {
        ethereum: { native: '1.25', symbol: 'ETH', usdValue: 3125, tokenCount: 2, error: null, priceChange24h: 3.7, sparkline: [90,95,93,99,103.7] },
        cardano: { native: '2400', symbol: 'ADA', usdValue: 840, tokenCount: 4, error: null, priceChange24h: 2.1, sparkline: [100,99,102.1] },
        solana: { native: '8.50', symbol: 'SOL', usdValue: 1275, tokenCount: 3, error: null, priceChange24h: -1.2, sparkline: [100,103,98.8] },
      }, portfolioSparkline: [100,99,101,103.5,102,105.8], fetchedAt: Date.now() })
      w.getHistory = async () => ({})
      w.getTokens = async () => ({ tokens: [], fetchedAt: Date.now(), error: null })
      w.getCollectibles = async () => ({ items: [], fetchedAt: Date.now(), error: null, chainResults: {} })
      w.getFxRates = async () => ({ rates: { USD: 1 }, fetchedAt: Date.now() }) as any
      w.swapGetNetworks = async () => []
      w.swapReconcile = async () => ({}) as any
      w.journeyList = async () => ({ ok: true, value: { active: [], unreadable: [] } }) as any
    })
    await page.getByText('Encrypt & Continue').click()
    await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('button[title="Settings"]').filter({ visible: true }).first().click()


    await expect(page.getByRole('button', { name: /Sovereign/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Sovereign/ })).toContainText('Locked')
    await page.getByRole('button', { name: /Sovereign/ }).scrollIntoViewIfNeeded()
    await page.screenshot({ path:'test-results/sovereign-holder-locked.png' })
    holderBalance = 1
    await page.getByRole('button', { name:'Recheck ownership',exact:true }).click()
    await expect(page.getByRole('button', { name: /Sovereign/ })).toBeEnabled()
    await page.getByRole('button', { name: /Sovereign/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sovereign')
    await expect(page.locator('.sv-scene')).toHaveCount(1)
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion', 'running')
    await expect(page.locator('.sv-scene')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.sv-scene')).toHaveCSS('pointer-events', 'none')
    await page.locator('.settings-close').first().click()
    for (const width of [360, 400, 1000]) {
      await page.setViewportSize({ width, height: 850 }); await settle()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.portfolio-total').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.locator('.chain-amount').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true)
      expect(await page.locator('.tab-banner img').evaluate(el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })).toBe(true)
      expect(await page.locator('.chain-spark-row svg').first().evaluate(el => {
        const r=el.getBoundingClientRect(), c=el.closest('.chain-card')!.getBoundingClientRect()
        return r.left >= c.left + 18 && r.right <= c.right - 18
      })).toBe(true)
      await expect(page.locator('.portfolio-header')).toHaveCSS('background-image', 'none')
      await page.screenshot({ path: `test-results/sovereign-portfolio-${width}.png` })
    }
    await page.setViewportSize({ width: 400, height: 850 })
    const card = page.locator('.chain-card').first()
    await card.hover({ position: { x: 90, y: 70 } })
    await expect.poll(() => card.evaluate(el => el.style.getPropertyValue('--sv-x'))).not.toBe('')
    const lightBefore = await card.evaluate(el => el.style.getPropertyValue('--sv-x'))
    await card.hover({ position: { x: 240, y: 110 } })
    await expect.poll(() => card.evaluate(el => el.style.getPropertyValue('--sv-x'))).not.toBe(lightBefore)
    // Capture actual renderer motion, with a moving light across the card.
    for (let i=0; i<16; i++) {
      await page.mouse.move(65+i*16, 380+Math.sin(i*.4)*55)
      await page.screenshot({ path: `test-results/sovereign-motion-${String(i).padStart(2,'0')}.png` })
    }
    await page.getByRole('button',{name:'Send ETH',exact:true}).click()
    await expect(page.locator('.sv-ripple')).toHaveCount(1)
    await expect(page.getByRole('button',{name:'Estimate Fee',exact:true})).toBeDisabled()
    await settle(); await page.screenshot({path:'test-results/sovereign-send.png'})
    await page.getByRole('button',{name:'Close send dialog',exact:true}).click()
    await page.locator('.bottom-nav-btn').filter({hasText:/^Swap$/i}).click()
    await expect(page.locator('.swap-hero-icon')).toHaveCSS('image-rendering','auto')
    await settle(); await page.screenshot({path:'test-results/sovereign-swap.png'})
    await expect(page.locator('.art-swap')).toHaveCSS('border-top-width', '0px')
    // Exercise the browser visibility signal without changing any wallet state.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion', 'paused')
    await expect(page.locator('.sv-orbit')).toHaveCSS('animation-play-state', 'paused')
    await page.evaluate(() => {
      delete (document as any).hidden
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion', 'running')
    // Reduced motion is live, not just a setting read once at startup.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion','paused')
    await expect(page.locator('.sv-orbit')).toHaveCSS('animation-name','none')
    await expect(page.locator('.sv-ripple')).toHaveCount(0)
    await page.mouse.move(160,450)
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-pointer-x'))).toBe('')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('html')).toHaveAttribute('data-sv-motion','running')
    await page.locator('.bottom-nav-btn').filter({hasText:/^Portfolio$/i}).click()
    await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
    await page.getByRole('button',{name:/Sovereign/}).scrollIntoViewIfNeeded()
    await settle(); await page.screenshot({path:'test-results/sovereign-picker.png'})
    await page.locator('.theme-swatch-new').click()
    await expect(page.locator('html')).toHaveAttribute('data-derived')
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-sv-motion')
    await page.getByRole('button',{name:'Cancel',exact:true}).click()
    await expect(page.locator('.sv-scene')).toHaveCount(1)
    await page.locator('button.theme-swatch[title="Grape"]').click()
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-sv-motion')
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-pointer-x'))).toBe('')
    await page.getByRole('button',{name:/Sovereign/}).click()
    await page.locator('.settings-close').first().click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme','sovereign')
    await expect(page.locator('.sv-scene')).toHaveCount(1)
    expect(await page.evaluate(() => localStorage.getItem('mm.theme'))).toBe('sovereign')
    await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
    holderBalance = 0
    await page.getByRole('button', {name:'Recheck ownership',exact:true}).click()
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.getByRole('button',{name:/Sovereign/})).toBeDisabled()
    // An unavailable chain cannot grant access, even with a saved preference.
    holderBalance = 1; failOwnership = true
    await page.getByRole('button', {name:'Recheck ownership',exact:true}).click()
    await expect(page.getByText('Ownership check unavailable.',{exact:false})).toBeVisible()
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.getByRole('button',{name:/Sovereign/})).toBeDisabled()
    failOwnership = false
    await page.getByRole('button', {name:'Recheck ownership',exact:true}).click()
    await expect(page.locator('.sv-scene')).toHaveCount(1)
    await page.locator('.settings-close').first().click()
    holderBalance = 0
    await page.getByRole('button', { name:'›',exact:true }).click()
    await expect(page.locator('.sv-scene')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme','sovereign')
    expect(errors).toEqual([])
  } finally { await context.close() }
})
