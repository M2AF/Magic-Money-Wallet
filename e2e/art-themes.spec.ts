import { expect, test, chromium } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test.use({ actionTimeout: 10_000 })

for (const theme of [{ id: 'mallard-order', name: 'Mallard Order' }, { id: 'sealuminati', name: 'Sealuminati' }, { id: 'r3tards', name: 'r3tards' }]) {
test(`${theme.name} selects, persists, previews cleanly and leaves other themes intact`, async () => {
  test.setTimeout(90_000)
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
    const art = page.getByRole('button', { name: new RegExp(theme.name) })
    await art.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    await expect(art).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => document.fonts.ready)
    await art.scrollIntoViewIfNeeded()
    await settle()
    await page.screenshot({ path: `test-results/${theme.id}-settings-400.png` })
    await page.locator('.settings-close').first().click()
    for (const width of [360, 400, 1000]) {
      await page.setViewportSize({ width, height: 850 })
      await expect(page.locator('.chain-card').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await settle()
      const amountBounds = await page.locator('.portfolio-total').first().evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, font: getComputedStyle(el).fontSize, text: el.textContent }))
      expect(amountBounds.scroll, JSON.stringify(amountBounds)).toBeLessThanOrEqual(amountBounds.width)
      if (theme.id === 'r3tards') {
        // Keep the stock left summary / right toolbar arrangement at phone widths.
        expect(await page.locator('.portfolio-header').evaluate(header => {
          const summary = header.querySelector('.portfolio-summary')!.getBoundingClientRect()
          const tools = header.querySelector('.portfolio-tools')!.getBoundingClientRect()
          const bounds = header.getBoundingClientRect()
          return Math.abs(summary.top - tools.top) < 2 && tools.left >= summary.right - 1 && tools.right <= bounds.right - 10 && summary.left >= bounds.left + 10
        })).toBe(true)
      }
      expect(await page.locator('.chain-spark-row svg').first().evaluate(el => {
        const chart = el.getBoundingClientRect(), card = el.closest('.chain-card')!.getBoundingClientRect()
        return chart.left >= card.left + 18 && chart.right <= card.right - 18
      })).toBe(true)
      await expect(page.locator('.chain-card').first()).toHaveCSS('border-image-source', theme.id === 'r3tards' ? 'none' : /frame.*\.webp/)
      if (theme.id === 'r3tards') await expect(page.locator('.app-shell')).toHaveCSS('background-image', /background.*\.webp/)
      await settle()
      await page.screenshot({ path: `test-results/${theme.id}-portfolio-${width}.png` })
    }
    await page.setViewportSize({ width: 400, height: 850 })
    if (theme.id === 'sealuminati') {
      await expect(page.locator('.tab-banner img')).toHaveCSS('image-rendering', 'auto')
      await expect(page.locator('.titlebar-wordmark')).toHaveCSS('image-rendering', 'auto')
      // The shared Electron titlebar uses a separate wordmark from the extension banner.
      const desktopHeader = await page.addStyleTag({ content: '.titlebar { display: flex !important; } .tab-banner { display: none !important; }' })
      await settle()
      await page.screenshot({ path: 'test-results/sealuminati-titlebar-400.png' })
      await desktopHeader.evaluate(el => el.remove())
    }
    if (theme.id === 'r3tards') {
      await expect(page.locator('.tab-banner img')).toHaveCSS('image-rendering', 'auto')
      await expect(page.locator('.tab-banner')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.locator('.titlebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.getByRole('button', { name: 'Send ETH', exact: true })).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(page.getByRole('button', { name: 'Send ETH', exact: true })).toHaveCSS('color', 'rgb(16, 16, 16)')
    }
    await page.getByRole('button', { name: 'Send ETH', exact: true }).click()
    await expect(page.getByText('Recipient Address', { exact: true })).toBeVisible()
    await expect(page.locator('.art-panel').filter({ visible: true }).first()).toHaveCSS('border-image-source', theme.id === 'r3tards' ? 'none' : /frame.*\.webp/)
    await expect(page.getByRole('button', { name: 'Estimate Fee', exact: true })).toBeDisabled()
    await settle()
    await page.screenshot({ path: `test-results/${theme.id}-send-400.png` })
    await page.getByRole('button', { name: 'Close send dialog', exact: true }).click()
    await page.locator('.bottom-nav-btn').filter({ hasText: /^Swap$/i }).click()
    await expect(page.locator('.art-swap')).toBeVisible()
    if (theme.id === 'sealuminati' || theme.id === 'r3tards') {
      await expect(page.locator('.swap-hero-text')).toHaveCSS('image-rendering', 'auto')
      await expect(page.locator('.swap-hero-icon')).toHaveCSS('image-rendering', 'auto')
    }
    await settle()
    await page.screenshot({ path: `test-results/${theme.id}-swap-400.png` })
    await page.locator('.bottom-nav-btn').filter({ hasText: /^Portfolio$/i }).click()
    await page.locator('button[title="Settings"]').filter({ visible: true }).first().click()
    await page.locator('.theme-swatch-new').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom-preview')
    await expect(page.locator('.chain-card').first()).toHaveCSS('border-image-source', 'none')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    await page.locator('button.theme-swatch[title="Midnight"]').click()
    await expect(page.locator('.chain-card').first()).toHaveCSS('border-image-source', 'none')
    const other = theme.id === 'sealuminati' ? 'Mallard Order' : 'Sealuminati'
    await page.getByRole('button', { name: new RegExp(other) }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id === 'sealuminati' ? 'mallard-order' : 'sealuminati')
    await art.click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    expect(await page.evaluate(() => localStorage.getItem('mm.theme'))).toBe(theme.id)
    expect(errors).toEqual([])
  } finally { await context.close() }
})

}
