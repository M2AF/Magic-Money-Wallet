import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { bech32 } from '@scure/base'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stubWorker } from './support/worker-stub-browser'

/**
 * Portfolio → Tokens: clicking a token card opens its details dialog; the
 * adjacent Send/Swap/Spam buttons keep their own actions. Receive shows the
 * account address (never the token contract) with a QR whose payload equals the
 * copied/displayed string.
 *
 * Holdings are stubbed at the window.wallet bridge seam before the dashboard
 * mounts. Requires a built extension: npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
const ERC20 = '0x3333333333333333333333333333333333333333'
const AGW_TOKEN = '0x9ebe3a824ca958e4b3da772d2065518f009cba62'
const LONG_NAME = 'An Extremely Long Token Name That Keeps Going To Prove The Header Wraps Instead Of Overflowing'

async function launch(observer = false): Promise<{ ctx: BrowserContext; page: Page }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-token-details-')), {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
  await stubWorker(ctx)
  if (observer) {
    const fixtures = resolve(process.cwd(), 'src/main/__fixtures__/cip113')
    const registry = JSON.parse(readFileSync(join(fixtures, 'registry.json'), 'utf8'))
    const params = JSON.parse(readFileSync(join(fixtures, 'params.json'), 'utf8'))
    const held = JSON.parse(readFileSync(join(fixtures, 'holding.json'), 'utf8'))
    await ctx.route('https://api.koios.rest/**', async route => {
      const body = route.request().postDataJSON()
      const path = new URL(route.request().url()).pathname
      let value: unknown = []
      if (path.endsWith('/asset_utxos')) value = params
      if (path.endsWith('/address_utxos')) {
        if (body._addresses.includes(registry[0].address)) value = registry
        else {
          const target = body._addresses[0]
          const credential = bech32.fromWords(bech32.decode(target, 200).words).slice(29)
          value = [{ ...held[0], address: target, stake_address: bech32.encode('stake', bech32.toWords(new Uint8Array([0xe1, ...credential])), 120) }]
        }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
    })
    await ctx.route('**/blockfrost/assets/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      quantity: '1', metadata: { name: 'Programmable Fixture', ticker: 'PROG', decimals: 0 },
    }) }))
    await ctx.route('https://api.dexscreener.com/**', route => route.fulfill({ contentType: 'application/json', body: '{"pairs":[]}' }))
    await ctx.route('https://agg-api.minswap.org/**', route => route.fulfill({ contentType: 'application/json', body: '{"tokens":[]}' }))
  }
  const page = await ctx.newPage()
  const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
    ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
  await page.goto(`chrome-extension://${extId}/popup.html`)
  await page.getByText('Create New Wallet').click()
  await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Reveal phrase').click()
  await page.getByText("I've Written It Down — Continue").click()
  for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check()
  await page.getByRole('button', { name: /Save Wallet/i }).click()
  await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
  await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
  await page.evaluate(({ ERC20, AGW_TOKEN, LONG_NAME, observer }) => {
    const w = window as unknown as { wallet: Record<string, unknown> }
    const tok = (chain: string, contractAddress: string, symbol: string, name: string, extra = {}) => ({
      contractAddress, name, symbol, decimals: 18, balance: '1.5', rawBalance: '1500000000000000000', usdValue: 3,
      nativeEquivalent: null, nativeSymbol: 'ETH', logoUri: null, chain, chainLabel: chain[0].toUpperCase() + chain.slice(1),
      chainColor: '#836EF9', ...extra,
    })
    if (!observer) w.wallet.getTokens = async () => ({
      fetchedAt: Date.now(), error: null,
      tokens: [
        tok('ethereum', ERC20, 'PRICED', 'Priced Token'),
        tok('ethereum', '0x4444444444444444444444444444444444444444', 'NOPR', LONG_NAME, { usdValue: null }),
        tok('ethereum', '0x5555555555555555555555555555555555555555', 'RO', 'Read Only Token', { rawBalance: undefined }),
        tok('abstract', AGW_TOKEN, 'PENGU', 'Pudgy Penguins', { source: 'agw' }),
      ],
    })
    w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
    w.wallet.swapReconcile = async () => []
  }, { ERC20, AGW_TOKEN, LONG_NAME, observer })
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
  return { ctx, page }
}

async function openTokensTab(page: Page) {
  await page.locator('.bottom-nav-btn:has-text("Portfolio")').click()
  await page.getByRole('button', { name: /^tokens$/i }).filter({ visible: true }).first().click()
  await expect(page.getByText('Priced Token', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 20_000 })
}

const card = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}.*open token details`) }).filter({ visible: true })
const dialog = (page: Page) => page.getByRole('dialog').filter({ visible: true })

test.describe('Token details panel (real extension)', () => {
  test.setTimeout(180_000)

  test('the existing token bridge discovers programmable holdings and withholds generic execution', async () => {
    const { ctx, page } = await launch(true)
    try {
      await page.getByRole('button', { name: /^tokens$/i }).filter({ visible: true }).first().click()
      await expect(card(page, 'Programmable Fixture')).toBeVisible({ timeout: 30_000 })
      const result = await page.evaluate(() => (window as any).wallet.getTokens())
      const token = result.tokens.find((t: any) => t.source === 'cip113')
      expect(token).toMatchObject({ rawBalance: '1', usdValue: null, programmable: { network: 'mainnet', availableRawBalance: null,
        protocol: { matchesPublishedWiring: true }, restrictions: { state: 'unknown' } } })
      await card(page, 'Programmable Fixture').click()
      await expect(dialog(page)).toContainText('Programmable holding (Cardano)')
      await expect(dialog(page)).toContainText('Price unavailable')
      await expect(dialog(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      await expect(dialog(page).getByRole('button', { name: 'Swap', exact: true })).toBeDisabled()
      await expect(dialog(page)).toContainText('restrictions are unknown')
      await expect(dialog(page).getByRole('button', { name: 'Receive', exact: true })).toBeDisabled()
      await page.screenshot({ path: '.local-artifacts/cip113-c3/programmable-panel.png' })
    } finally { await ctx.close() }
  })

  test('programmable holding shows badge, unknown rules, balance changes and a vetted explorer link without safety claims', async () => {
    const { ctx, page } = await launch(true)
    try {
      await page.getByRole('button', { name: /^tokens$/i }).filter({ visible: true }).first().click()
      await expect(card(page, 'Programmable Fixture')).toBeVisible({ timeout: 30_000 })
      await card(page, 'Programmable Fixture').click()
      const d = dialog(page)
      await expect(d.locator('.tdp-chip--prog')).toContainText('Programmable')
      await expect(d.getByRole('region', { name: 'Programmable token details' })).toBeVisible()
      await expect(d).toContainText('Available to send')
      await expect(d).toContainText('Unknown')
      await expect(d).toContainText('Token-specific rules are not verified')
      await expect(d).toContainText('not the same as unrestricted')
      // Never an affirmative safety/unrestricted/verified-issuer claim.
      const text = (await d.innerText()).toLowerCase()
      for (const bad of ['safe', 'verified issuer', 'kyc approved', 'currently frozen: no']) {
        expect(text, `must not claim "${bad}"`).not.toContain(bad)
      }
      // Core references are collapsed until asked for; upgrade authority is separate.
      await expect(d).not.toContainText('Upgrade authority')
      await d.getByRole('button', { name: /Show on-chain references/ }).click()
      await expect(d).toContainText('Upgrade authority')
      await expect(d).toContainText('Pending upgrade nomination')
      // Recent balance changes are labelled as such and as not-complete history.
      await expect(d).toContainText('Token balance changes')
      await expect(d.getByText(/not complete history|unavailable|Could not load|No balance changes|Loading token balance/).first()).toBeVisible()
      // Vetted Cardano mainnet explorer link, opened through the wallet's own path.
      const link = d.getByRole('button', { name: /View on Cardanoscan/ })
      await expect(link).toBeVisible()
      const popupPromise = ctx.waitForEvent('page', { timeout: 15_000 })
      await link.click()
      const popup = await popupPromise
      expect(popup.url()).toMatch(/^https:\/\/cardanoscan\.io\/token\/[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}\?tab=programmable$/)
      await popup.close().catch(() => {})
      await page.screenshot({ path: 'test-results/token-details-programmable.png' })
    } finally { await ctx.close() }
  })

  test('card opens details; actions stay independent; focus is contained and restored', async () => {
    const { ctx, page } = await launch()
    try {
      await openTokensTab(page)

      // Click opens the dialog with holding, network, identifier and source.
      await card(page, 'Priced Token').click()
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page).getByRole('heading', { name: 'Priced Token' })).toBeVisible()
      await expect(dialog(page)).toContainText('1.5 PRICED')
      await expect(dialog(page)).toContainText('Ethereum')
      await expect(dialog(page)).toContainText(ERC20)
      await expect(dialog(page)).toContainText('Wallet address')
      await expect(dialog(page)).toContainText('Network activity')
      await page.screenshot({ path: 'test-results/token-details-open.png' })

      // Escape closes and returns focus to the card that opened it.
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await expect(card(page, 'Priced Token')).toBeFocused()

      // Keyboard activation.
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toBeVisible()
      // Tab stays inside the dialog.
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
      await dialog(page).getByRole('button', { name: 'Close token details' }).click()
      await expect(dialog(page)).toHaveCount(0)

      // Adjacent Spam button marks spam and does NOT open details.
      await page.locator('div').filter({ has: card(page, 'Read Only Token') }).last().hover()
      await page.getByRole('button', { name: 'Mark this item as spam' }).filter({ visible: true }).first().click()
      await expect(dialog(page)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('narrow layout: full-width sheet scrolls inside the viewport, no horizontal overflow', async () => {
    const { ctx, page } = await launch()
    try {
      await page.setViewportSize({ width: 380, height: 640 })
      await openTokensTab(page)
      await card(page, 'An Extremely').click()
      const d = dialog(page)
      await expect(d).toBeVisible()
      const box = await d.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(380 + 1)
      expect(box!.y + box!.height).toBeLessThanOrEqual(640 + 1)
      // The extension shell itself is a fixed-width column, so assert on the dialog's own overflow.
      expect(await d.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await d.getByRole('button', { name: 'Receive' }).click()
      await expect(d.getByTestId('token-receive-address')).toBeVisible()
      const rb = await d.boundingBox()
      expect(rb!.y + rb!.height).toBeLessThanOrEqual(640 + 1)
      await page.screenshot({ path: 'test-results/token-details-narrow.png' })
    } finally {
      await ctx.close()
    }
  })

  test('receive shows the account address (not the contract); QR payload equals copied text; states are honest', async () => {
    const { ctx, page } = await launch()
    try {
      const evm = await page.evaluate(() =>
        (window as unknown as { wallet: { getAddresses(): Promise<{ evm: string }> } }).wallet.getAddresses().then(a => a.evm))
      await openTokensTab(page)

      // Ordinary token: address = the account EVM address.
      await card(page, 'Priced Token').click()
      await dialog(page).getByRole('button', { name: 'Receive' }).click()
      const shown = await dialog(page).getByTestId('token-receive-address').textContent()
      expect(shown?.toLowerCase()).toBe(evm.toLowerCase())
      expect(shown?.toLowerCase()).not.toBe(ERC20)
      await expect(dialog(page).getByLabel('QR code')).toBeVisible()
      await expect(dialog(page)).toContainText('Address only')
      await page.evaluate(() => {
        navigator.clipboard.writeText = async text => { (window as any).__copiedReceive = text }
      })
      await dialog(page).getByRole('button', { name: 'Copy address' }).click()
      expect(await page.evaluate(() => (window as any).__copiedReceive)).toBe(shown)
      await page.screenshot({ path: 'test-results/token-details-receive.png' })
      await dialog(page).getByRole('button', { name: 'Back to details' }).click()
      await expect(dialog(page).getByRole('heading', { name: 'Priced Token' })).toBeVisible()
      await page.keyboard.press('Escape')

      // No price: honest label, not zero. Long name wraps inside the dialog.
      await card(page, 'An Extremely').click()
      await expect(dialog(page)).toContainText('Price unavailable')
      const box = await dialog(page).boundingBox()
      const vw = await page.evaluate(() => window.innerWidth)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      await page.keyboard.press('Escape')

      // Read-only (no rawBalance): details open, Send is disabled with a reason, Receive still works.
      await card(page, 'Read Only Token').click()
      await expect(dialog(page).getByRole('button', { name: 'Send' })).toBeDisabled()
      await expect(dialog(page)).toContainText('exact balance')
      await expect(dialog(page).getByRole('button', { name: 'Receive' })).toBeEnabled()
      await page.keyboard.press('Escape')

      // AGW holding without an owned smart account: source is labelled, no QR is shown.
      await card(page, 'Pudgy Penguins').click()
      await expect(dialog(page)).toContainText('Smart account')
      await expect(dialog(page).getByRole('button', { name: 'Swap' })).toBeDisabled()
      const receiveBtn = dialog(page).getByRole('button', { name: 'Receive' })
      if (await receiveBtn.isEnabled()) {
        await receiveBtn.click()
        await expect(dialog(page).getByTestId('token-receive-address')).toHaveCount(0)
      }
    } finally {
      await ctx.close()
    }
  })

  test('QR send rejects requests, preserves input on cancel/failure, and requires review before sending', async () => {
    const { ctx, page } = await launch()
    try {
      await page.evaluate(() => {
        const w = window as any
        w.__qr = { text: null, sends: 0, estimates: [] }
        w.wallet.scanQr = async () => w.__qr.text
        w.wallet.estimateFee = async (...args: unknown[]) => {
          w.__qr.estimates.push(args)
          return { fee: '0.0001', feeSymbol: 'ETH', feeUsd: null }
        }
        w.wallet.sendEvm = async () => { ++w.__qr.sends; throw new Error('No broadcasts in this test') }
      })
      await openTokensTab(page)
      await card(page, 'Priced Token').click()
      await dialog(page).getByRole('button', { name: 'Send', exact: true }).click()
      const recipient = page.getByPlaceholder('0x...')
      const old = '0x1111111111111111111111111111111111111111'
      const scanned = '0x2222222222222222222222222222222222222222'
      const scan = page.getByRole('button', { name: 'Scan address QR code' })
      await recipient.fill(old)
      await page.getByPlaceholder('0.0').filter({ visible: true }).fill('0.5')
      for (const text of [null, `ethereum:${scanned}@8453?value=1`, 'not-an-address']) {
        await page.evaluate(text => { (window as any).__qr.text = text }, text)
        await scan.click()
        await expect(scan).toBeEnabled()
        await expect(recipient).toHaveValue(old)
        if (text?.startsWith('ethereum:')) await expect(page.getByRole('alert')).toContainText('Payment links')
        if (text === 'not-an-address') await expect(page.getByRole('alert')).toContainText('valid EVM address')
      }
      await page.evaluate(text => { (window as any).__qr.text = text }, scanned)
      await scan.click()
      await expect(recipient).toHaveValue(scanned)
      await expect(page.getByRole('status')).toContainText('Address only')
      await expect(page.getByPlaceholder('0.0').filter({ visible: true })).toHaveValue('0.5')
      await page.getByRole('button', { name: /Estimate.*Fee/i }).click()
      await expect(page.getByRole('button', { name: 'Review Transaction' })).toBeEnabled()
      const args = await page.evaluate(() => (window as any).__qr.estimates[0])
      expect(args).toMatchObject(['ethereum', scanned, '0.5', { contractAddress: ERC20, decimals: 18, symbol: 'PRICED' }])
      await page.getByRole('button', { name: 'Review Transaction' }).click()
      await expect(page.getByRole('button', { name: 'Confirm Send' })).toBeVisible()
      expect(await page.evaluate(() => (window as any).__qr.sends)).toBe(0)
      await page.screenshot({ path: '.local-artifacts/token-details-c2/qr-send-review.png' })
    } finally { await ctx.close() }
  })

  test('a late scan cannot overwrite typed input or a newly opened send form', async () => {
    const { ctx, page } = await launch()
    try {
      await page.evaluate(() => {
        const w = window as any
        w.wallet.scanQr = () => new Promise(resolve => { w.__finishScan = resolve })
      })
      await openTokensTab(page)
      const openSend = async () => {
        await card(page, 'Priced Token').click()
        await dialog(page).getByRole('button', { name: 'Send', exact: true }).click()
      }
      await openSend()
      const recipient = page.getByPlaceholder('0x...')
      await page.getByRole('button', { name: 'Scan address QR code' }).click()
      await recipient.fill('0x1111111111111111111111111111111111111111')
      await page.evaluate(() => (window as any).__finishScan('0x2222222222222222222222222222222222222222'))
      await expect(recipient).toHaveValue('0x1111111111111111111111111111111111111111')
      await page.getByRole('button', { name: 'Scan address QR code' }).click()
      // Keep the old resolver so the second form cannot accidentally receive it.
      await page.evaluate(() => { (window as any).__oldScan = (window as any).__finishScan })
      await page.keyboard.press('Escape')
      await expect(recipient).toHaveCount(0)
      await openSend()
      await page.evaluate(() => (window as any).__oldScan('0x2222222222222222222222222222222222222222'))
      await expect(recipient).toHaveValue('')
    } finally { await ctx.close() }
  })

  test('account changes discard pending receive validation and close a pending scan', async () => {
    const { ctx, page } = await launch()
    try {
      await openTokensTab(page)
      await page.evaluate(() => {
        const w = window as any
        w.wallet.validateAddress = () => new Promise(resolve => { w.__finishAddress = resolve })
      })
      await card(page, 'Priced Token').click()
      await dialog(page).getByRole('button', { name: 'Receive' }).click()
      await expect(dialog(page)).toContainText('Checking receive address')
      // Trigger the real account switch while the asynchronous resolver is pending.
      await page.getByRole('button', { name: '›', exact: true }).evaluate((el: HTMLButtonElement) => el.click())
      await expect(dialog(page)).toHaveCount(0)
      await page.evaluate(() => (window as any).__finishAddress({ valid: true }))
      await expect(page.getByTestId('token-receive-address')).toHaveCount(0)
      await expect(page.getByText('Account 1', { exact: true })).toBeVisible()
      await page.evaluate(() => {
        const w = window as any
        w.wallet.validateAddress = async () => ({ valid: true })
        w.wallet.scanQr = () => new Promise(resolve => { w.__finishScan = resolve })
      })
      await openTokensTab(page)
      await card(page, 'Priced Token').click()
      await dialog(page).getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByRole('button', { name: 'Scan address QR code' }).click()
      await page.getByRole('button', { name: '›', exact: true }).evaluate((el: HTMLButtonElement) => el.click())
      await expect(page.getByPlaceholder('0x...')).toHaveCount(0)
      await page.evaluate(() => (window as any).__finishScan('0x2222222222222222222222222222222222222222'))
      await expect(page.getByPlaceholder('0x...')).toHaveCount(0)
    } finally { await ctx.close() }
  })
})
