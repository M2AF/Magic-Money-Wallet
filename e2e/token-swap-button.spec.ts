import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Portfolio → Tokens: "Hide" is gone, replaced by "Swap", which opens the Swap
 * tab with that coin (and its network) as the pay token. Previously hidden
 * items are converted to spam, so nothing that was hidden reappears.
 *
 * Holdings are stubbed at the window.wallet bridge seam, and an old "hidden"
 * entry is planted, before the dashboard first mounts.
 * Requires a built extension: npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
const EMO_MONAD = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const JUNK_BASE = '0x3333333333333333333333333333333333333333'

async function launch(beforeDashboard: (page: Page) => Promise<void>): Promise<{ ctx: BrowserContext; page: Page }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-token-swap-')), {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
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
  // Stubs and the pre-existing filter list must be in place before the dashboard
  // mounts: it reads holdings and the filter list on mount.
  await beforeDashboard(page)
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
  return { ctx, page }
}

async function stubHoldings(page: Page) {
  await page.evaluate(({ EMO_MONAD, JUNK_BASE }) => {
    const w = window as unknown as { wallet: Record<string, unknown> }
    const tok = (chain: string, contractAddress: string, symbol: string, name: string, decimals: number, extra = {}) => ({
      contractAddress, name, symbol, decimals, balance: '1', rawBalance: '1000000000000000000', usdValue: 1,
      nativeEquivalent: null, nativeSymbol: 'ETH', logoUri: null, chain, chainLabel: chain[0].toUpperCase() + chain.slice(1),
      chainColor: '#836EF9', ...extra,
    })
    w.wallet.getTokens = async () => ({
      fetchedAt: Date.now(), error: null,
      tokens: [
        tok('monad', EMO_MONAD, 'EMO', 'emonad', 18),
        tok('ethereum', '0x0000000000000000000000000000000000000000', 'ETH', 'Ether', 18),
        tok('abstract', '0x9ebe3a824ca958e4b3da772d2065518f009cba62', 'PENGU', 'Pudgy Penguins', 18, { source: 'agw' }),
        tok('cardano', 'asset1night', 'NIGHT', 'NIGHT', 6),
        tok('base', JUNK_BASE, 'JUNK', 'Airdropped junk', 18),
      ],
    })
    w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
    w.wallet.swapReconcile = async () => []
    // A hide made before this change (account 0): it must come back as spam, not reappear.
    localStorage.setItem('mmw_filters_migrated_v1_0', '1')
    localStorage.setItem('mmw_filters_0', JSON.stringify({ [`base:t:${JUNK_BASE}`]: { s: 'h', t: 1 } }))
  }, { EMO_MONAD, JUNK_BASE })
}

const tokenRow = (page: Page, name: string) =>
  page.locator('div').filter({ has: page.getByText(name, { exact: true }) }).filter({ visible: true }).last()

async function openTokensTab(page: Page) {
  await page.locator('.bottom-nav-btn:has-text("Portfolio")').click()
  // The dashboard stays mounted behind other tabs: only the visible copy is clickable.
  await page.getByRole('button', { name: /^tokens$/i }).filter({ visible: true }).first().click()
  await expect(page.getByText('emonad', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 20_000 })
}

test.describe('Tokens tab: Swap replaces Hide (real extension)', () => {
  test.setTimeout(150_000)

  test('Swap opens the coin on its network; Hide is gone; hidden became spam', async () => {
    const { ctx, page } = await launch(stubHoldings)
    try {
      await openTokensTab(page)

      // ── Hidden → spam: the old hide stays out of the list, now as SPAM ─────
      await expect(page.getByText('Airdropped junk', { exact: true }).filter({ visible: true })).toHaveCount(0)
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mmw_filters_0') ?? '{}'))
      expect(Object.values(stored).map((e) => (e as { s: string }).s)).toEqual(['s'])
      const chip = page.getByRole('button', { name: /^Spam \(1\)$/ })
      await expect(chip).toBeVisible()
      await chip.click()
      await expect(page.getByText('SPAM', { exact: true })).toBeVisible()
      await expect(page.getByText('HIDDEN', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Close spam manager' }).click()

      // ── Buttons: Send / Swap / Spam, and no Hide anywhere ─────────────────
      await tokenRow(page, 'emonad').hover()
      await expect(page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Mark this item as spam' }).filter({ visible: true }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Hide this item' })).toHaveCount(0)
      await page.screenshot({ path: 'test-results/token-swap-button.png' })

      // What the swap can't spend gets no Swap button.
      await tokenRow(page, 'Pudgy Penguins').hover()
      await expect(page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true })).toHaveCount(0)
      await tokenRow(page, 'NIGHT').hover()
      await expect(page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true })).toHaveCount(0)

      // ── Swap on EMO → Swap tab, Monad, EMO selected ───────────────────────
      await tokenRow(page, 'emonad').hover()
      await page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true }).click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('combobox', { name: 'From network' })).toHaveValue('monad')
      await expect(page.getByRole('button', { name: 'Pay token' })).toContainText('EMO')
      await page.screenshot({ path: 'test-results/token-swap-opened.png' })

      // ── From Cross-Chain mode too: a native coin opens DEX Swap on its network ──
      await page.getByRole('button', { name: /Cross-Chain/ }).first().click()
      await openTokensTab(page)
      await tokenRow(page, 'Ether').hover()
      await page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true }).click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('combobox', { name: 'From network' })).toHaveValue('ethereum')
      await expect(page.getByRole('button', { name: 'Pay token' })).toContainText('ETH')
    } finally {
      await ctx.close()
    }
  })
})

test.describe('account switch reaches the Swap tab (real extension)', () => {
  test.setTimeout(150_000)

  test('after switching account, quotes are for the NEW account and its own spam list applies', async () => {
    const { ctx, page } = await launch(async (p) => {
      await stubHoldings(p)
      await p.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __quotes: { taker: string }[] }
        w.__quotes = []
        w.wallet.swapGetQuote = async (req: { taker: string }) => { w.__quotes.push(req); return { quote: null, error: 'stub: no route' } }
      })
    })
    try {
      const addr0 = await page.evaluate(() => (window as unknown as { wallet: { getAddresses(): Promise<{ evm: string }> } }).wallet.getAddresses().then(a => a.evm))
      await page.getByRole('button', { name: '›' }).click()
      await expect(page.getByText('Account 1')).toBeVisible({ timeout: 20_000 })
      const addr1 = await page.evaluate(() => (window as unknown as { wallet: { getAddresses(): Promise<{ evm: string }> } }).wallet.getAddresses().then(a => a.evm))
      expect(addr1.toLowerCase()).not.toBe(addr0.toLowerCase())

      // Account 1 has its own (empty) spam list: account 0's spam entry does not apply here.
      await openTokensTab(page)
      await expect(page.getByText('Airdropped junk', { exact: true }).filter({ visible: true })).toBeVisible()

      // Swap from a token on this account: the quote is requested for account 1.
      await tokenRow(page, 'Ether').hover()
      await page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true }).click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await page.getByPlaceholder('0.0').filter({ visible: true }).first().fill('0.01')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __quotes: unknown[] }).__quotes.length)).toBeGreaterThan(0)
      const taker = await page.evaluate(() => (window as unknown as { __quotes: { taker: string }[] }).__quotes.at(-1)!.taker)
      expect(taker.toLowerCase()).toBe(addr1.toLowerCase())
    } finally {
      await ctx.close()
    }
  })
})

test.describe('amount presets on the pay side (real extension)', () => {
  test.setTimeout(150_000)

  test('25/50/75% fill exact shares of the holding; the pressed one is marked', async () => {
    const { ctx, page } = await launch(stubHoldings)
    try {
      await openTokensTab(page)
      await tokenRow(page, 'emonad').hover()
      await page.getByRole('button', { name: 'Swap this token' }).filter({ visible: true }).click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      const amountField = page.getByPlaceholder('0.0').filter({ visible: true }).first()
      const presets = page.getByRole('group', { name: 'Amount presets' })
      await expect(presets.getByRole('button')).toHaveText(['25%', '50%', '75%', 'MAX'])

      // The stubbed EMO holding is exactly 1 (1e18 base units).
      for (const [label, want] of [['25%', '0.25'], ['50%', '0.5'], ['75%', '0.75']] as const) {
        await presets.getByRole('button', { name: label }).click()
        await expect(amountField).toHaveValue(want)
        await expect(presets.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
      }
      await expect(presets.getByRole('button', { name: '25%' })).toHaveAttribute('aria-pressed', 'false')
      await page.screenshot({ path: 'test-results/swap-amount-presets.png' })

      // A token takes its full balance on MAX.
      await presets.getByRole('button', { name: 'MAX' }).click()
      await expect(amountField).toHaveValue('1')
      await expect(presets.getByRole('button', { name: 'MAX' })).toHaveAttribute('aria-pressed', 'true')

      // Typing clears the pressed state.
      await amountField.fill('0.3')
      await expect(presets.getByRole('button', { name: 'MAX' })).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await ctx.close()
    }
  })
})
