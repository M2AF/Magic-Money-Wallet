import { installCollectionFixture } from './collection-fixture'
import { installApeFixture } from './ape-fixture'
import { expect, test, chromium } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stubWorker } from './support/worker-stub-browser'

test.use({ actionTimeout: 10_000 })

for (const theme of [{id:'sappy-seals-art',name:'Sappy Seals'}, { id: 'ape-society', name: 'The Ape Society' }, { id: 'mallard-order', name: 'Mallard Order' }, { id: 'sealuminati', name: 'Sealuminati' }, { id: 'emonad', name: 'Emonad' }, { id: 'r3tards', name: 'r3tards' }]) {
test(`${theme.name} selects, persists, previews cleanly and leaves other themes intact`, async () => {
  test.setTimeout(90_000)
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
    const apeControl=await installApeFixture(page, {balance:theme.id === 'ape-society' ? 2 : 1,ids:theme.id === 'ape-society' ? ['6637','6638'] : ['6637']})
    const collectionControl=await installCollectionFixture(page)
    if(theme.id==='mallard-order')collectionControl.stakeOnly=true
    const mallardWebCalls:string[]=[]
    if(theme.id==='mallard-order')await page.route('**/api/theme-holder/mallard?*',route=>{mallardWebCalls.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<html>Undeployed route fallback</html>'})})

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
    if(theme.id==='mallard-order'){
      await expect(page.locator('.theme-swatch[title="Sappy Seals"]')).toHaveCount(0)
      await page.evaluate(()=>{
        localStorage.setItem('mm.theme','sappy-seals')
        window.dispatchEvent(new StorageEvent('storage',{key:'mm.theme',newValue:'sappy-seals'}))
      })
      await expect(page.locator('html')).toHaveAttribute('data-theme','mint-money')
      expect(await page.evaluate(()=>localStorage.getItem('mm.theme'))).toBe('mint-money')
      await page.locator('.theme-swatch[title="Mint & Money"]').click()
      expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#30ffae')
      expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim())).toBe('#0c1e19')
      await page.locator('.theme-swatch[title="Mint & Money"]').scrollIntoViewIfNeeded()
      await page.screenshot({path:'.local-artifacts/mint-money/wallet.png'})
      const artSection=page.locator('details.theme-design-section').filter({has:page.locator('summary', {hasText:'Art Designs'})})
      const materials=page.locator('details.theme-design-section').filter({has:page.locator('summary', {hasText:'Material Designs'})})
      await expect(artSection.locator('.art-theme-card')).toHaveCount(7)
      await expect(materials.locator('.art-theme-card')).toHaveCount(6)
      await expect(artSection.locator('.art-theme-liquid-glass')).toHaveCount(0)
      await artSection.locator('summary').click();await expect(artSection.locator('.art-theme-mallard-order')).toBeHidden()
      await expect(materials.locator('.art-theme-liquid-glass')).toBeVisible()
      await materials.locator('summary').click();await expect(materials.locator('.art-theme-liquid-glass')).toBeHidden()
      await artSection.locator('summary').scrollIntoViewIfNeeded();await page.screenshot({path:'.local-artifacts/design-sections/wallet-collapsed.png'})
      await artSection.locator('summary').focus();await page.keyboard.press('Enter');await expect(artSection.locator('.art-theme-mallard-order')).toBeVisible()
      await materials.locator('summary').click();await expect(materials.locator('.art-theme-liquid-glass')).toBeVisible()
    }
    const art = page.getByRole('button', { name: new RegExp(`^${theme.name}`) })
    if (theme.id === 'emonad') {
      const ids = await page.locator('.art-theme-card').evaluateAll(els => els.map(el => el.className))
      expect(ids[ids.findIndex(id => id.includes('art-theme-r3tards')) - 1]).toContain('art-theme-emonad')
    }
    await art.click()
    if(theme.id==='sappy-seals-art'){
      const alternate=page.getByRole('button',{name:'Use alternate seal artwork',exact:true})
      await expect(alternate).toHaveAttribute('aria-pressed','false')
      await expect(alternate).toHaveCSS('width','28px')
      const toggleBox=await alternate.boundingBox(),refreshBox=await page.getByRole('button',{name:'Refresh Sappy Seals ownership',exact:true}).boundingBox()
      expect(Math.abs(toggleBox!.y-refreshBox!.y)).toBeLessThan(1)
      expect(refreshBox!.x-toggleBox!.x-toggleBox!.width).toBe(8)
      await expect(page.locator('.sappy-seal-peek')).toHaveAttribute('data-artwork','original',{timeout:20_000})
      await alternate.click();await expect(alternate).toHaveAttribute('aria-pressed','true')
      await expect(page.locator('.sappy-seal-peek')).toHaveAttribute('data-artwork','alternate',{timeout:20_000})
      await alternate.click();await expect(page.locator('.sappy-seal-peek')).toHaveAttribute('data-artwork','original',{timeout:20_000})
    }
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
      if(theme.id==='sappy-seals-art' && width<=400){
        expect(await page.evaluate(()=>{const seal=document.querySelector('.sappy-seal-peek')!.getBoundingClientRect(),chart=document.querySelector('.portfolio-chart-row svg')!.getBoundingClientRect();return chart.left>=seal.left+seal.width/2+59})).toBe(true)
      }
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
      if (theme.id === 'ape-society') {
        expect(await page.locator('.chain-spark-row svg').first().evaluate(svg => {
          const line = svg.querySelector('polyline')!
          const end = line.getPointAtLength(line.getTotalLength()).matrixTransform(line.getScreenCTM()!)
          const card = svg.closest('.chain-card')!.getBoundingClientRect()
          return end.x <= card.right - 18 && end.x >= card.left + 18
        })).toBe(true)
      }
      await expect(page.locator('.chain-card').first()).toHaveCSS('border-image-source', ['r3tards','sappy-seals-art'].includes(theme.id) ? 'none' : /frame.*\.(webp|png)/)
      if (theme.id === 'r3tards') await expect(page.locator('.app-shell')).toHaveCSS('background-image', /background.*\.webp/)
      await settle()
      await page.screenshot({ path: `test-results/${theme.id}-portfolio-${width}.png` })
    }
    await page.setViewportSize({ width: 400, height: 850 })
    if(theme.id==='sappy-seals-art'){
      await expect(page.locator('.sappy-seal-peek')).toHaveAttribute('data-ready','true',{timeout:20_000})
      await page.bringToFront()
      expect(await page.evaluate(()=>document.hidden)).toBe(false)
      await page.mouse.move(10,100);await page.waitForTimeout(700)
      const left=Number(await page.locator('.sappy-seal-canvas').getAttribute('data-head-angle'))
      await page.mouse.move(390,100);await page.waitForTimeout(700)
      const right=Number(await page.locator('.sappy-seal-canvas').getAttribute('data-head-angle'))
      expect(Math.abs(right-left)).toBeGreaterThan(1)
      const geometry=await page.evaluate(()=>{
        const region=document.querySelector<HTMLElement>('.portfolio-heading-region')!,controls=document.querySelector<HTMLElement>('.portfolio-controls-region')!,header=document.querySelector<HTMLElement>('.portfolio-header')!,seal=document.querySelector('.sappy-seal-peek')!,tabs=document.querySelector('.portfolio-tabs')!
        const placed={header:header.getBoundingClientRect().top,seal:seal.getBoundingClientRect().top,tabs:tabs.getBoundingClientRect().top,bottom:controls.getBoundingClientRect().bottom}
        region.style.setProperty('padding-top','24px','important');region.style.setProperty('padding-bottom','12px','important');controls.style.setProperty('padding-bottom','12px','important');controls.style.marginTop='0px';header.style.marginTop='8px'
        const base={header:header.getBoundingClientRect().top,seal:seal.getBoundingClientRect().top,tabs:tabs.getBoundingClientRect().top,bottom:controls.getBoundingClientRect().bottom}
        region.style.removeProperty('padding-top');region.style.removeProperty('padding-bottom');controls.style.removeProperty('padding-bottom');controls.style.removeProperty('margin-top');header.style.removeProperty('margin-top');return {placed,base}
      })
      expect(geometry.base.header-geometry.placed.header).toBe(16)
      expect(geometry.base.seal-geometry.placed.seal).toBe(56)
      expect(geometry.base.tabs-geometry.placed.tabs).toBe(56)
      expect(geometry.base.bottom-geometry.placed.bottom).toBe(60)
      await page.screenshot({path:'.local-artifacts/sappy-seals/wallet-400.png'})
      const clicks=Number(await page.locator('.sappy-seal-peek').getAttribute('data-click-count'))
      const sealBox=await page.locator('.sappy-seal-peek').boundingBox()
      await page.mouse.click(sealBox!.x+sealBox!.width/2,sealBox!.y+sealBox!.height/2)
      await expect.poll(async()=>Number(await page.locator('.sappy-seal-peek').getAttribute('data-click-count'))).toBeGreaterThan(clicks)
      const seen=new Set([await page.locator('.sappy-seal-peek').getAttribute('data-click-motion')])
      for(let index=0;index<12;index++){
        const before=Number(await page.locator('.sappy-seal-peek').getAttribute('data-click-count'))
        await page.mouse.click(sealBox!.x+sealBox!.width/2,sealBox!.y+sealBox!.height/2)
        await expect.poll(async()=>Number(await page.locator('.sappy-seal-peek').getAttribute('data-click-count'))).toBeGreaterThan(before)
        seen.add(await page.locator('.sappy-seal-peek').getAttribute('data-click-motion'))
      }
      expect(seen.size).toBe(13)
      await page.screenshot({path:'.local-artifacts/sappy-seals/click-motion.png'})
      await page.locator('.portfolio-tab-tokens').click()
      await page.locator('.portfolio-tab-networks').click()
      await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100)
      const still=await page.locator('.sappy-seal-canvas').getAttribute('data-head-angle')
      const pausedClicks=await page.locator('.sappy-seal-peek').getAttribute('data-click-count')
      await page.mouse.click(sealBox!.x+sealBox!.width/2,sealBox!.y+sealBox!.height/2)
      await page.mouse.move(20,400);await page.waitForTimeout(300)
      expect(await page.locator('.sappy-seal-canvas').getAttribute('data-head-angle')).toBe(still)
      expect(await page.locator('.sappy-seal-peek').getAttribute('data-click-count')).toBe(pausedClicks)
      await page.emulateMedia({reducedMotion:'no-preference'})
    }
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
    await expect(page.locator('.art-panel').filter({ visible: true }).first()).toHaveCSS('border-image-source', ['r3tards','sappy-seals-art'].includes(theme.id) ? 'none' : /frame.*\.(webp|png)/)
    await expect(page.getByRole('button', { name: 'Estimate Fee', exact: true })).toBeDisabled()
    await settle()
    await page.screenshot({ path: `test-results/${theme.id}-send-400.png` })
    await page.getByRole('button', { name: 'Close send dialog', exact: true }).click()
    await page.locator('.bottom-nav-btn').filter({ hasText: /^Swap$/i }).click()
    await expect(page.locator('.art-swap')).toBeVisible()
    if (theme.id === 'sealuminati' || theme.id === 'r3tards' || theme.id === 'emonad') {
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
    await page.getByRole('button', { name: new RegExp(`^${other}`) }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id === 'sealuminati' ? 'mallard-order' : 'sealuminati')
    if (theme.id === 'emonad') {
      const ids = await page.locator('.art-theme-card').evaluateAll(els => els.map(el => el.className))
      expect(ids[ids.findIndex(id => id.includes('art-theme-r3tards')) - 1]).toContain('art-theme-emonad')
    }
    await art.click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    expect(await page.evaluate(() => localStorage.getItem('mm.theme'))).toBe(theme.id)
    if(theme.id === 'ape-society') {
      await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
      const selector=page.getByRole('combobox',{name:'Theme ape',exact:true})
      await expect(selector).toBeVisible()
      await expect(page.getByRole('button',{name:'Refresh owned apes',exact:true})).toHaveCSS('width','28px')
      await selector.selectOption(`${apeControl.owner}:6638`)
      await expect(art).toContainText('Second Ape')
      await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--ape-portrait'))).toContain('/6638.jpg')
      await selector.scrollIntoViewIfNeeded()
      await page.screenshot({path:'.local-artifacts/ape-holder/wallet-picker.png'})
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme','ape-society')
      await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--ape-portrait'))).toContain('/6638.jpg')
      await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
      apeControl.balance=0
      await page.getByRole('button',{name:'Refresh owned apes',exact:true}).click()
      await expect(art).toBeDisabled()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme','ape-society')
      await expect(selector).toHaveCount(0)
      apeControl.balance=2;apeControl.fail=true
      await page.getByRole('button',{name:'Refresh owned apes',exact:true}).click()
      await expect(art).toBeDisabled()
      await expect(art).toContainText('unavailable')
    }
    if(['mallard-order','sealuminati','r3tards','emonad','sappy-seals-art'].includes(theme.id)){
      await page.locator('button[title="Settings"]').filter({visible:true}).first().click()
      const refresh=page.getByRole('button',{name:`Refresh ${theme.name} ownership`,exact:true})
      await expect(refresh).toHaveCSS('width','28px')
      await art.scrollIntoViewIfNeeded();await page.screenshot({path:`.local-artifacts/collection-gates/${theme.id}-wallet.png`})
      collectionControl.sappyBalance=0n;collectionControl.quantity='0';collectionControl.balance=theme.id==='emonad'?10_000n*10n**18n-1n:0n
      await refresh.click();await expect(art).toBeDisabled()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme',theme.id)
      expect(await page.evaluate(()=>localStorage.getItem('mm.theme'))).toBe(theme.id)
      collectionControl.sappyBalance=1n;collectionControl.quantity='1';collectionControl.balance=10_000n*10n**18n
      await refresh.click();await expect(art).toBeEnabled()
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id)
      collectionControl.fail=true;await refresh.click();await expect(art).toBeDisabled();await expect(art).toContainText('unavailable')
    }
    if(theme.id==='mallard-order')expect(mallardWebCalls).toEqual([])
    expect(errors).toEqual([])
  } finally { await context.close() }
})

}
