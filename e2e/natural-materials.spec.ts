import { expect, test, chromium } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test.use({ actionTimeout: 10_000 })

test('natural material skins preserve layout and actions', async () => {
  test.setTimeout(180_000)
  const dist = resolve('dist-extension')
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-art-theme-')), {
    headless: false, viewport: { width: 400, height: 850 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
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


    const materials = [['brushed-metal','Brushed Metal'],['leather','Leather'],['velvet','Velvet'],['walnut','Walnut'],['royal-silk','Royal Blue Silk']]
    for (const [id, name] of materials) {
      await page.getByRole('button', {name: new RegExp(name)}).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme',id)
      await expect(page.locator('html')).not.toHaveAttribute('data-surface-active')
      await page.locator('.settings-close').first().click()
      await expect(page.locator('.chain-card').first()).toHaveCSS('background-image',new RegExp(id))
      await expect(page.locator('.portfolio-header')).toHaveCSS('background-image','none')
      await expect(page.locator('.tab-banner')).toHaveCSS('border-bottom-width','0px')
      for (const width of [360,400,1000]) {
        await page.setViewportSize({width,height:850}); await settle()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(await page.locator('.tab-banner img').evaluate(el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })).toBe(true)
        expect(await page.locator('.portfolio-total').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        expect(await page.locator('.chain-amount').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true)
        await page.screenshot({path:`test-results/material-${id}-wallet-${width}.png`})
      }
      await page.setViewportSize({width:400,height:850})
      await page.getByRole('button',{name:'Send ETH',exact:true}).click()
      await expect(page.getByRole('button',{name:'Estimate Fee',exact:true})).toBeDisabled()
      await settle(); await page.screenshot({path:`test-results/material-${id}-send.png`})
      await page.getByRole('button',{name:'Close send dialog',exact:true}).click()
      await page.locator('.bottom-nav-btn').filter({hasText:/^Swap$/i}).click()
      await settle(); await page.screenshot({path:`test-results/material-${id}-swap.png`})
      await page.locator('.bottom-nav-btn').filter({hasText:/^Portfolio$/i}).click()
      await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
    }
    await page.locator('.theme-swatch-new').click()
    await expect(page.locator('html')).toHaveAttribute('data-derived')
    await page.getByRole('button',{name:'Cancel',exact:true}).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme','royal-silk')
    await expect(page.locator('html')).not.toHaveAttribute('data-derived')
    await page.locator('.settings-close').first().click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme','royal-silk')
    await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
    await page.locator('button.theme-swatch[title="Grape"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-surface-active','')
    await expect(page.locator('.chain-card').first()).not.toHaveCSS('background-image',/materials/)
    expect(errors).toEqual([])
  } finally { await context.close() }
})
