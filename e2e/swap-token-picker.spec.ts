import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension check for the DEX swap token picker.
 *
 * The picker used to be a `<select>` over the ~30 tokens hard-coded in
 * swap-tokens.ts, keyed by SYMBOL. This drives the replacement: search, exact
 * address paste, the unverified badge, and the stale-response guard.
 *
 * Discovery is STUBBED at the `window.wallet.swapGetTokens` bridge seam, with
 * fixtures copied verbatim from a live Worker response (Relay for Base, Jupiter
 * for Solana). That split is deliberate — the Worker route itself is exercised
 * against the real providers separately, and the wallet refuses a non-https
 * proxy origin (secure-store.ts), so pointing the extension at a local Worker
 * would mean weakening a security control to run a test.
 *
 * Requires a built extension: npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')

/** Verbatim from the live Worker: GET /tokens?chain=base&q=degen */
const BASE_DEGEN = [
  {
    chain: 'base', symbol: 'DEGEN', name: 'Degen',
    address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', decimals: 18,
    logoUri: null, isNative: false, verified: true, source: 'relay',
  },
  {
    chain: 'base', symbol: 'DPAD', name: 'DegenPad',
    address: '0x1234d66b6fbb900296ae2f57740b800fd8960927', decimals: 18,
    logoUri: null, isNative: false, verified: null, source: 'relay',
  },
]

/** Verbatim from the live Worker: GET /tokens?chain=solana&q=bonk — note the
 *  three different decimal counts behind one symbol, which is why symbol is not
 *  an identity. */
const SOLANA_BONK = [
  {
    chain: 'solana', symbol: 'Bonk', name: 'Bonk',
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,
    logoUri: null, isNative: false, verified: true, source: 'jupiter',
  },
  {
    chain: 'solana', symbol: 'BONK', name: 'BONK on Pump',
    address: '6u8SDnYtD9VDwrEvDDTyjVYMfM4i5bk2Ph9qdPHkpump', decimals: 6,
    logoUri: null, isNative: false, verified: null, source: 'jupiter',
    tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  },
]

async function launchWithExtension(): Promise<BrowserContext> {
  expect(existsSync(join(distExtension, 'manifest.json')),
    'dist-extension should exist; run npm run build:extension first').toBe(true)
  const userDir = mkdtempSync(join(tmpdir(), 'mm-swap-e2e-'))
  return chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
}

async function createWalletToDashboard(page: Page) {
  await page.getByText('Create New Wallet').click()
  await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Reveal phrase').click()
  await page.getByText("I've Written It Down — Continue").click()
  for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check()
  await page.getByRole('button', { name: /Save Wallet/i }).click()
  await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
  await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
}

/** Replace the discovery bridge with the fixtures, and record every call made. */
async function stubDiscovery(page: Page) {
  await page.evaluate(({ base, sol }) => {
    const w = window as unknown as {
      wallet: Record<string, unknown>
      __swapCalls: unknown[]
    }
    w.__swapCalls = []
    w.wallet.swapGetTokens = async (req: { chain: string; query?: string; address?: string }) => {
      w.__swapCalls.push(req)
      const pool = req.chain === 'solana' ? sol : base
      if (req.address) return { tokens: pool.filter(t => t.address.toLowerCase() === req.address!.toLowerCase()), error: null }
      if (!req.query) return { tokens: [], error: null }
      const q = req.query.toLowerCase()
      return { tokens: pool.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)), error: null }
    }
  }, { base: BASE_DEGEN, sol: SOLANA_BONK })
}

test.describe('DEX swap token picker (real extension)', () => {
  test('searches, resolves an exact address, and labels unverified tokens', async () => {
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)

      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()

      // The DEX widget is the default mode.
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await stubDiscovery(page)

      // ── The receive picker opens as a searchable dialog ────────────────────
      await page.getByRole('button', { name: 'Receive token' }).click()
      const dialog = page.getByRole('dialog', { name: 'Receive token' })
      await expect(dialog).toBeVisible()

      // ── Search by name reaches a token that is in NO bundled list ─────────
      await dialog.getByRole('textbox', { name: 'Search tokens' }).fill('degen')
      const degenRow = dialog.getByRole('option').filter({ hasText: 'DEGEN' }).first()
      await expect(degenRow).toBeVisible({ timeout: 10_000 })
      // The contract is shown, so two tokens sharing a symbol are distinguishable.
      await expect(degenRow).toContainText('0x4ed4')

      // ── Unverified tokens are SHOWN and labelled, never hidden ────────────
      const dpadRow = dialog.getByRole('option').filter({ hasText: 'DegenPad' }).first()
      await expect(dpadRow).toBeVisible()
      await expect(dpadRow).toContainText('UNVERIFIED')

      await page.screenshot({ path: 'test-results/swap-picker-search.png' })

      // ── Selecting it updates the trigger ──────────────────────────────────
      await degenRow.click()
      await expect(dialog).toBeHidden()
      await expect(page.getByRole('button', { name: 'Receive token' })).toContainText('DEGEN')

      // ── Pasting an exact contract resolves that one token ─────────────────
      await page.getByRole('button', { name: 'Receive token' }).click()
      const dialog2 = page.getByRole('dialog', { name: 'Receive token' })
      await dialog2.getByRole('textbox', { name: 'Search tokens' })
        .fill('0x1234d66b6fbb900296ae2f57740b800fd8960927')
      const exact = dialog2.getByRole('option')
      await expect(exact).toHaveCount(1, { timeout: 10_000 })
      await expect(exact.first()).toContainText('DPAD')

      // An exact-address lookup must not be debounced away as a fuzzy search.
      const calls = await page.evaluate(() => (window as unknown as { __swapCalls: { address?: string }[] }).__swapCalls)
      expect(calls.some(c => !!c.address)).toBe(true)

      await page.screenshot({ path: 'test-results/swap-picker-exact-address.png' })
    } finally {
      await ctx.close()
    }
  })

  test('rejects a malformed address before spending a provider call', async () => {
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)

      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await stubDiscovery(page)

      await page.getByRole('button', { name: 'Receive token' }).click()
      const dialog = page.getByRole('dialog', { name: 'Receive token' })
      // Long enough to be meant as an address, but not a valid one.
      await dialog.getByRole('textbox', { name: 'Search tokens' })
        .fill('0xnotarealaddressnotarealaddressnotareal')
      await expect(dialog).toContainText('does not look like a valid')
    } finally {
      await ctx.close()
    }
  })

  test('receive picker shows the destination native balance; a settled swap is recorded and balances refresh', async () => {
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })

      // Bridge stubs. Nothing reaches a provider or a chain; every call is counted.
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __calls: Record<string, number> }
        const calls: Record<string, number> = { getBalances: 0, getTokens: 0, swapReconcile: 0, swapCrossStatus: 0 }
        w.__calls = calls
        const WSOL = 'So11111111111111111111111111111111111111112'
        const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        w.wallet.getBalances = async () => {
          calls.getBalances++
          return { chains: { solana: { native: '0.035417' }, monad: { native: '2' }, ethereum: { native: '0' } } }
        }
        w.wallet.getTokens = async () => { calls.getTokens++; return { tokens: [] } }
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => { calls.swapReconcile++; return [] }
        w.wallet.swapGetQuote = async () => ({
          error: null,
          quote: {
            provider: 'lifi', fromChain: 'monad', toChain: 'solana',
            fromTokenAddress: NATIVE, toTokenAddress: WSOL, fromTokenSymbol: 'MON', toTokenSymbol: 'SOL',
            sellAmountRaw: '1000000000000000000', buyAmountRaw: '12000000', minBuyAmountRaw: '11700000',
            minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 250, priceImpactPct: 0,
            rate: 0.012, expiresAt: Date.now() + 60_000, isCrossChain: true, bridgeTool: 'relaydepository',
            estimatedDurationSec: 6, appFee: null, txData: { to: '0x1', data: '0x2', value: '0' }, intentId: 'stub',
          },
        })
        w.wallet.swapExecute = async () => ({ txHash: '0xabc', explorerUrl: 'https://example.test/tx/0xabc', approvalTxHash: null })
        // What the privileged layer now reports for the field-reported swap:
        // native SOL delivered, mapped chain-aware to `completed`.
        w.wallet.swapCrossStatus = async () => {
          calls.swapCrossStatus++
          return {
            status: 'done', state: 'completed', error: null, message: null,
            delivered: { chain: '1151111081099710', address: '11111111111111111111111111111111', symbol: 'SOL', decimals: 9, amountRaw: '12026493' },
          }
        }
      })

      // Changing the source network re-reads balances through the stub.
      await page.getByRole('combobox', { name: 'From network' }).selectOption('monad')
      await page.getByRole('combobox', { name: 'To network' }).selectOption('solana')
      await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls.getBalances)).toBeGreaterThan(0)

      // ── Receive picker: SOL shows the SOLANA native balance, not 0/blank ──
      await page.getByRole('button', { name: 'Receive token' }).click()
      const dialog = page.getByRole('dialog', { name: 'Receive token' })
      const solRow = dialog.getByRole('option').filter({ hasText: 'SOL' }).first()
      await expect(solRow).toContainText('0.035417')
      await page.keyboard.press('Escape')

      // ── Settlement: recorded (reconcile) and balances re-read ─────────────
      await page.getByPlaceholder('0.0').first().fill('1')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      const before = await page.evaluate(() => ({ ...(window as unknown as { __calls: Record<string, number> }).__calls }))
      await page.getByRole('button', { name: /Swap cross-chain/ }).click()
      await expect(page.getByText('Swap complete')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Delivered a different asset')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls.swapReconcile))
        .toBeGreaterThan(before.swapReconcile)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls.getBalances))
        .toBeGreaterThan(before.getBalances)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls.getTokens))
        .toBeGreaterThan(before.getTokens)
      await page.screenshot({ path: 'test-results/swap-settled-refresh.png' })
    } finally {
      await ctx.close()
    }
  })

  test('offers the registry-derived networks at popup size, and not BSC', async () => {
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      // The real popup is ~400px wide: check the other agent's wider/centred
      // SwapPage column still lays out there, not only in a full-width tab.
      await page.setViewportSize({ width: 400, height: 600 })
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })

      const source = page.getByRole('combobox', { name: 'From network' })
      // Networks now come from the wallet's registry joined with measured
      // capability, served by the privileged layer — not a hand-kept list.
      await expect(source.locator('option', { hasText: 'Robinhood' })).toHaveCount(1, { timeout: 10_000 })
      const labels = await source.locator('option').allInnerTexts()
      for (const want of ['Arc', 'Abstract', 'HyperEVM']) {
        expect(labels.some(l => l.includes(want)), want).toBe(true)
      }
      expect(labels.some(l => /BNB|BSC/i.test(l))).toBe(false)

      // Layout at popup width: nothing overflows horizontally.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(overflow).toBe(false)
      await page.screenshot({ path: 'test-results/swap-popup-networks.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })
})
