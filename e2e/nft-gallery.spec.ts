import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dist = resolve('dist-extension')
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#283a66"/><circle cx="200" cy="185" r="90" fill="#7dd3fc"/><path d="M95 325L200 240L305 325" fill="#c4b5fd"/></svg>'

async function launch(entry='popup.html'): Promise<{ context: BrowserContext; page: Page; images: string[]; runtimeErrors: string[] }> {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-nft-gallery-')), {
    headless: false, viewport: { width: 440, height: 820 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  const images: string[] = []
  await context.route('https://nft-gallery.example/**', async route => {
    const url = route.request().url()
    images.push(url)
    if (url.includes('/stalled')) return // Deliberately leave this request pending.
    if (url.includes('/broken')) return route.fulfill({ status: 404, body: 'missing' })
    if (url.endsWith('/small/2.svg')) await new Promise(resolve => setTimeout(resolve, 1200))
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
  })
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/${entry}`)
  await page.getByText('Create New Wallet').click()
  await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Reveal phrase').click()
  await page.getByText("I've Written It Down — Continue").click()
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check()
  await page.getByRole('button', { name: /Save Wallet/i }).click()
  await page.getByPlaceholder(/Password \(min/).fill('nft-gallery-test-password')
  await page.getByPlaceholder('Confirm password').fill('nft-gallery-test-password')
  await stubNfts(page)
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /^collectibles$/i }).filter({ visible: true }).click()
  return { context, page, images, runtimeErrors }
}

async function stubNfts(page: Page) {
  await page.evaluate(() => {
    const w = window.wallet
    // Keep profile writes inside this fixture, including the favorite sync timer.
    w.assetFiltersGet = async () => ({})
    w.assetFiltersPush = async entries => ({ entries, error: null })
    const callbacks = new Set<(r: any) => void>()
    const items = Array.from({ length: 240 }, (_, i) => ({
      id: `nft-${i}`, tokenId: String(i), name: `Gallery Art #${i}`, description: 'Gallery performance fixture',
      image: `https://nft-gallery.example/${i === 3 ? 'broken-full' : 'full'}/${i}.svg`,
      thumbnailUrl: `https://nft-gallery.example/${i === 1 || i === 3 ? 'broken' : 'small'}/${i}.svg`,
      animationUrl: null, collectionName: 'Gallery Test', chain: 'ethereum', chainLabel: 'Ethereum',
      chainColor: '#627EEA', contractAddress: '0x1111111111111111111111111111111111111111', contractType: 'ERC721', traits: [],
      floorPrice: 1, usdValue: 10,
    }))
    const partial = { items, fetchedAt: Date.now(), error: null, chainResults: { ethereum: { count: 240, error: null } }, partial: true }
    let resolve!: (r: any) => void
    const full = new Promise<any>(r => { resolve = r })
    ;(window as any).__ownerReads=0
    w.getCollectibles = async () => { (window as any).__ownerReads++; setTimeout(() => callbacks.forEach(cb => cb(partial)), 30); return full }
    w.onCollectiblesUpdated = cb => { callbacks.add(cb) }
    w.offCollectiblesUpdated = cb => { callbacks.delete(cb) }
    w.getBalances = async () => ({ chains: {}, fetchedAt: Date.now() }) as any
    w.getHistory = async () => ({ chains: {}, fetchedAt: Date.now() }) as any
    w.getTokens = async () => ({ tokens: [], fetchedAt: Date.now(), error: null })
    w.getFxRates = async () => ({ rates: { USD: 1 }, fetchedAt: Date.now() }) as any
    w.downloadFile = async (url: string) => { (window as any).__downloaded = url; return { ok: true, fileName: 'art.svg' } }
    ;(window as any).__finishNfts = () => resolve({ ...partial, partial: false })
    ;(window as any).__favoriteFixture = () => callbacks.forEach(cb => cb({
      ...partial, partial: false, fetchedAt: Date.now(),
      items: [0, 1, 2].map((i) => ({ ...items[i], usdValue: [100, 50, 10][i] })),
    }))
    ;(window as any).__mosaicFixture = () => callbacks.forEach(cb => cb({
      ...partial,partial:false,fetchedAt:Date.now(),items:items.slice(0,13).map((n,i)=>({...n,
        name:i<10?`Lil Sappy #${i+1}`:i<12?`Sappy Seal #${i}`:'Single #12',
        collectionName:i<10?'Lil Sappys':i<12?'Sappy Seals':'Single',
        contractAddress:i<10?'0x1111111111111111111111111111111111111111':i<12?'0x2222222222222222222222222222222222222222':'0x3333333333333333333333333333333333333333',
        thumbnailUrl:i===12?'https://nft-gallery.example/broken/12.svg':`https://nft-gallery.example/small/${i}.svg`,
        image:i===12?'https://nft-gallery.example/broken-full/12.svg':`https://nft-gallery.example/full/${i}.svg`,
        imageSources:i===12?['https://nft-gallery.example/alternative/12.svg']:[],
      })),
    }))
    ;(window as any).__stallNft = () => callbacks.forEach(cb => cb({
      ...partial, partial: false, fetchedAt: Date.now(),
      items: [{ ...items[0], thumbnailUrl: 'https://nft-gallery.example/stalled.svg' }],
    }))
    ;(window as any).__pushNfts = (ids: number[], isPartial: boolean, changed = false, oldOwner = false) => callbacks.forEach(cb => cb({
      ...partial, items: ids.map(i => changed ? { ...items[i], image: 'https://nft-gallery.example/revealed.svg', thumbnailUrl: null } : items[i]),
      partial: isPartial, fetchedAt: Date.now(), ownerAddress: oldOwner ? '0xdead' : undefined,
    }))
  })
}

test('large NFT gallery loads nearby previews, displays early results, and retains full artwork', async () => {
  test.setTimeout(120_000)
  const { context, page, images, runtimeErrors } = await launch()
  try {
    await expect(page.getByText('Gallery Art #0', { exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Loading more collectibles')
    await expect(page.locator('.nft-media[data-state="loaded"]').first()).toBeVisible()
    await expect(page.locator('img[src="https://nft-gallery.example/full/1.svg"]')).toBeVisible()
    const initialCount = images.length
    expect(initialCount).toBeLessThan(30)
    expect(images).not.toContain('https://nft-gallery.example/full/0.svg')
    expect(images).not.toContain('https://nft-gallery.example/small/239.svg')
    await page.screenshot({ path: 'test-results/nft-gallery-loading.png' })
    await page.evaluate(() => (window as any).__finishNfts())
    await expect(page.getByRole('status')).toHaveCount(0)

    await page.getByText('Gallery Art #0', { exact: true }).click()
    await expect(page.locator('img[src="https://nft-gallery.example/full/0.svg"]')).toBeVisible()
    await page.getByRole('button', { name: /Download Image/ }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__downloaded)).toBe('https://nft-gallery.example/full/0.svg')
    await page.screenshot({ path: 'test-results/nft-gallery-detail.png' })
    await page.getByRole('button', { name: '✕', exact: true }).click()

    await page.getByText('Gallery Art #239', { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.locator('img[src="https://nft-gallery.example/small/239.svg"]')).toBeVisible()
    expect(images.length).toBeLessThan(70)
    await page.getByPlaceholder('Search collectibles…').fill('Gallery Art #239')
    await expect(page.locator('.nft-media')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/nft-gallery-search.png' })
    await page.getByPlaceholder('Search collectibles…').fill('')

    // Refresh progress retains cards; a complete refresh can remove sold assets.
    await page.evaluate(() => (window as any).__pushNfts([0], true))
    await expect(page.getByText('Gallery Art #239', { exact: true })).toHaveCount(1)
    await page.evaluate(() => (window as any).__pushNfts([0], false))
    await expect(page.locator('.nft-media')).toHaveCount(1)
    await expect(page.getByText('Gallery Art #239', { exact: true })).toHaveCount(0)

    await page.evaluate(() => (window as any).__pushNfts([3], false))
    await expect(page.locator('.nft-media[data-state="failed"]')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Gallery Art #3: image unavailable' })).toBeVisible()
    await page.screenshot({ path: 'test-results/nft-gallery-fallback.png' })

    // A failed image's state cannot stick across a metadata reveal; old-account pushes are ignored.
    await page.evaluate(() => (window as any).__pushNfts([3], false, true))
    await expect(page.locator('img[src="https://nft-gallery.example/revealed.svg"]')).toBeVisible()
    await page.evaluate(() => (window as any).__pushNfts([239], true, false, true))
    await expect(page.locator('.nft-media')).toHaveCount(1)
    await expect.poll(() => page.locator('img[src="https://nft-gallery.example/revealed.svg"]').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    await page.setViewportSize({ width: 400, height: 740 })
    await page.screenshot({ path: 'test-results/nft-gallery-compact.png' })
    await page.setViewportSize({ width: 900, height: 900 })
    await page.screenshot({ path: 'test-results/nft-gallery-desktop.png' })
    await page.clock.install()
    await page.evaluate(() => (window as any).__stallNft())
    await expect(page.locator('img[src="https://nft-gallery.example/stalled.svg"]')).toHaveCount(1)
    await expect(page.locator('.nft-media[data-state="loading"]')).toBeVisible()
    await page.clock.fastForward(12_100)
    await expect(page.locator('img[src="https://nft-gallery.example/full/0.svg"]')).toBeVisible()
    expect(runtimeErrors).toEqual([])
    console.log(`240 NFT fixture: ${initialCount} initial media requests; ${images.length} after detail, scroll and reveal`)
  } finally { await context.close() }
})

test('NFT stars pin favorites, keep USD order, and save per wallet', async () => {
  test.setTimeout(120_000)
  const { context, page, runtimeErrors } = await launch()
  try {
    await page.evaluate(() => (window as any).__finishNfts())
    await expect(page.getByRole('status')).toHaveCount(0)
    await page.evaluate(() => (window as any).__favoriteFixture())
    const cards = page.locator('[data-nft-key]')
    const order = () => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-nft-key')?.split(':').pop()))
    await expect.poll(order).toEqual(['0', '1', '2'])
    await page.getByRole('button', { name: 'Favorite Gallery Art #2', exact: true }).click()
    await expect.poll(order).toEqual(['2', '0', '1'])
    await expect(page.getByRole('button', { name: 'Unfavorite Gallery Art #2' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Download Image/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Favorite Gallery Art #1', exact: true }).click()
    await expect.poll(order).toEqual(['1', '2', '0'])
    await expect(cards.nth(0)).toContainText('$50.00')
    await expect(cards.nth(1)).toContainText('$10.00')
    await expect(cards.nth(2)).toContainText('$100.00')
    const saved = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mmw_nft_favorites_v1_') && !key.endsWith('_decisions')).map(key => JSON.parse(localStorage.getItem(key)!)))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toHaveLength(2)
    const bounds = await page.getByRole('button', { name: 'Unfavorite Gallery Art #1' }).boundingBox()
    const media = await cards.first().locator('.nft-media').boundingBox()
    expect(bounds!.x - media!.x).toBeCloseTo(6, 0)
    expect(bounds!.y - media!.y).toBeCloseTo(6, 0)
    await expect(cards.nth(1).locator('.nft-media')).toHaveAttribute('data-state', 'loaded')
    await page.screenshot({ path: 'test-results/nft-gallery-favorites.png' })
    // Lock/unlock unmounts and recreates the dashboard, exercising persisted favorites.
    await page.evaluate(() => window.wallet.lock())
    await page.reload()
    await stubNfts(page)
    await page.evaluate(() => (window as any).__finishNfts())
    await page.locator('input[type="password"]').fill('nft-gallery-test-password')
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByText('Portfolio').first()).toBeVisible()
    await page.getByRole('button', { name: /^collectibles$/i }).filter({ visible: true }).click()
    await page.evaluate(() => (window as any).__favoriteFixture())
    await expect.poll(order).toEqual(['1', '2', '0'])
    await page.getByPlaceholder('Search collectibles…').fill('Gallery Art #0')
    await expect(cards).toHaveCount(1)
    await page.getByPlaceholder('Search collectibles…').fill('')
    await expect.poll(order).toEqual(['1', '2', '0'])
    await page.getByRole('button', { name: 'Unfavorite Gallery Art #1' }).click()
    await expect.poll(order).toEqual(['2', '0', '1'])
    await page.getByRole('button', { name: 'Unfavorite Gallery Art #2' }).click()
    await expect.poll(order).toEqual(['0', '1', '2'])
    expect(runtimeErrors).toEqual([])
  } finally { await context.close() }
})

test('mosaic beside Search shows all collection tokens, vertical pairs, and retains filters without rescanning',async()=>{
  test.setTimeout(120_000)
  const {context,page,runtimeErrors}=await launch('sidepanel.html')
  try {
    await page.evaluate(()=>{(window as any).__finishNfts(); (window as any).__mosaicFixture()})
    const ownerReads=await page.evaluate(()=>(window as any).__ownerReads)
    const toggle=page.getByRole('button',{name:'Collection mosaic',exact:true})
    const toggleBox=await toggle.boundingBox(),searchBox=await page.getByPlaceholder('Search collectibles…').boundingBox()
    expect(toggleBox!.x+toggleBox!.width).toBeLessThan(searchBox!.x)
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed','true')
    await expect(page.locator('.mmw-mosaic-art')).toHaveCount(13)
    await expect(page.locator('.mmw-mosaic-tile')).toHaveCount(5)
    await expect(page.locator('.mmw-mosaic-tile').nth(2)).toContainText('9–10 of 10 items')
    const pair=page.locator('.mmw-mosaic-pair').last(),first=await pair.locator('.mmw-mosaic-art').first().boundingBox(),second=await pair.locator('.mmw-mosaic-art').last().boundingBox()
    expect(first!.x).toBe(second!.x); expect(second!.y).toBeGreaterThan(first!.y+first!.height)
    await page.getByRole('button',{name:'View Single #12',exact:true}).scrollIntoViewIfNeeded()
    await expect(page.locator('img[src="https://nft-gallery.example/alternative/12.svg"]')).toBeVisible()
    await page.screenshot({path:'test-results/nft-mosaic-compact.png',fullPage:true})
    await page.getByRole('button',{name:'View Lil Sappy #10',exact:true}).click()
    await expect(page.getByText('Token ID',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'✕',exact:true}).click()
    await page.getByRole('button',{name:'View Single #12',exact:true}).click()
    await expect(page.locator('img[src="https://nft-gallery.example/alternative/12.svg"]').last()).toBeVisible()
    await page.getByRole('button',{name:/Download Image/}).click()
    await expect.poll(()=>page.evaluate(()=>(window as any).__downloaded)).toBe('https://nft-gallery.example/alternative/12.svg')
    await page.getByRole('button',{name:'✕',exact:true}).click()
    await page.getByRole('button',{name:'Favorite Sappy Seal #10',exact:true}).click()
    await expect(page.getByRole('button',{name:'Unfavorite Sappy Seal #10',exact:true})).toHaveAttribute('aria-pressed','true')
    await page.getByRole('button',{name:'Mark Sappy Seal #11 as spam',exact:true}).click()
    await expect(page.locator('.mmw-mosaic-art')).toHaveCount(12)
    await page.getByPlaceholder('Search collectibles…').fill('Lil Sappy')
    await expect(page.locator('.mmw-mosaic-art')).toHaveCount(10)
    await page.setViewportSize({width:1000,height:900})
    await expect(page.locator('.mmw-nft-mosaic')).toHaveCSS('grid-template-columns',/\S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+/)
    for (const image of await page.locator('.mmw-mosaic-art').all()) await image.scrollIntoViewIfNeeded()
    await expect(page.locator('.mmw-mosaic-art .nft-media[data-state="loaded"]')).toHaveCount(10)
    await page.getByPlaceholder('Search collectibles…').scrollIntoViewIfNeeded()
    await page.screenshot({path:'test-results/nft-mosaic-desktop.png',fullPage:true})
    await toggle.click(); await expect(page.locator('.mmw-nft-mosaic')).toHaveCount(0)
    await expect(page.locator('[data-nft-key]')).toHaveCount(10)
    expect(await page.evaluate(()=>(window as any).__ownerReads)).toBe(ownerReads)
    expect(runtimeErrors).toEqual([])
  } finally {await context.close()}
})
