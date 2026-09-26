import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension check for Cardano same-chain swaps (Minswap V2 orders).
 *
 * The NETWORK LIST is not stubbed: Cardano must be offered by the privileged
 * layer's own resolver (swap-network-resolver.ts), flagged same-chain only.
 * Quote, execute and status are stubbed at the window.wallet bridge seam with a
 * quote shaped exactly like the one the privileged layer produced live on
 * 2026-09-26 (an ADA -> token order, 1 hop) — nothing reaches Minswap or Cardano.
 *
 * Requires a built extension: npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
// The receive side defaults to the second curated Cardano token, MIN.
const MIN = '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e'

async function launchWithExtension(): Promise<BrowserContext> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  return chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-cardano-swap-')), {
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

test.describe('Cardano swap (Minswap order)', () => {
  test('Cardano pairs with itself, discloses the order terms, and tracks the order until it fills', async () => {
    // The order card polls at 8 s, then every 15 s: "filled" cannot appear inside the default 30 s.
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })

      await page.evaluate(({ MIN }) => {
        const w = window as unknown as { wallet: Record<string, unknown>; __status: number }
        w.__status = 0
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '120' }, ethereum: { native: '0' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => ({
          error: null,
          quote: {
            provider: 'minswap', fromChain: 'cardano', toChain: 'cardano',
            fromTokenAddress: 'lovelace', toTokenAddress: MIN, fromTokenSymbol: 'ADA', toTokenSymbol: 'MIN',
            sellAmountRaw: '20000000', buyAmountRaw: '5078463', minBuyAmountRaw: '5053197', minReceivedSource: 'provider',
            estimatedGasRaw: '0', slippageBps: 50, priceImpactPct: 0.75, rate: 0.2539, expiresAt: Date.now() + 45_000,
            isCrossChain: false, bridgeTool: 'Minswap V2', estimatedDurationSec: 60, feeBps: 0,
            appFee: { policyVersion: 'x', provider: 'minswap', requestedBps: 0, appliedBps: 0, base: 'input', chain: 'cardano',
              tokenAddress: null, tokenSymbol: null, tokenDecimals: null, amountRaw: '0', recipient: null, recipientKind: 'none',
              collection: 'in-swap', providerSharePct: null, verification: 'none-requested', evidence: [] },
            externalFees: [{ name: 'Minswap batcher fee', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: '2000000', includedInQuotedOutput: false }],
            txData: { cbor: '84a0a0f5f6' }, approvalTx: null, intentId: 'stub',
            cardanoOrder: { protocol: 'MinswapV2', path: ['lovelace', MIN], batcherFeeLovelace: '2000000', depositLovelace: '2000000', aggregatorFeeLovelace: '0' },
            cardanoCost: { txFeeLovelace: '227365', batcherFeeLovelace: '2000000', depositLovelace: '2000000', aggregatorFeeLovelace: '0',
              adaSpentLovelace: '24227365', validUntilSlot: '198842604', orderMinimumRaw: '5053197', killable: false },
          },
        })
        w.wallet.swapExecute = async () => ({ txHash: 'ab'.repeat(32), explorerUrl: `https://cardanoscan.io/transaction/${'ab'.repeat(32)}`, approvalTxHash: null })
        w.wallet.swapCrossStatus = async () => {
          w.__status++
          return w.__status < 2
            ? { status: 'pending', state: 'source-confirmed', error: null, providerStatus: 'PENDING', providerSubstatus: 'ORDER_OPEN',
                message: 'The order is on Cardano, waiting for a Minswap batcher to fill it.' }
            : { status: 'done', state: 'completed', error: null, message: null, providerStatus: 'DONE', providerSubstatus: 'COMPLETED',
                delivered: { chain: 'cardano', address: MIN, symbol: null, decimals: null, amountRaw: '5071002' },
                destExplorerUrl: 'https://cardanoscan.io/transaction/cd' }
        }
      }, { MIN })

      // Offered by the REAL resolver, and pairing: choosing Cardano to pay moves
      // the receive side to Cardano too (no bridge leg is enabled).
      const from = page.getByRole('combobox', { name: 'From network' })
      await expect(from.locator('option[value="cardano"]')).toHaveCount(1)
      await from.selectOption('cardano')
      await expect(page.getByRole('combobox', { name: 'To network' })).toHaveValue('cardano')
      await expect(page.getByRole('button', { name: 'Pay token' })).toContainText('ADA')
      await expect(page.getByText('uses the Cross-Chain exchange')).toHaveCount(0)

      // …and choosing another network to receive pulls the pay side off Cardano.
      await page.getByRole('combobox', { name: 'To network' }).selectOption('ethereum')
      await expect(from).toHaveValue('ethereum')
      await from.selectOption('cardano')

      await page.getByPlaceholder('0.0').first().fill('20')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      await expect(page.getByText('This places a Minswap order.')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('not refunded automatically')).toBeVisible()
      await expect(page.getByText('Deposit (returned)')).toBeVisible()
      await expect(page.getByText('ADA needed up front')).toBeVisible()
      await expect(page.getByText('None on this route')).toBeVisible()
      await page.getByText('This places a Minswap order.').scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/cardano-swap-quote.png', fullPage: true })

      await page.getByRole('button', { name: /^Swap ADA/ }).click()
      await expect(page.getByText('Order placed — waiting for a Minswap batcher')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /Manage or cancel on Minswap/ })).toBeVisible()
      await page.screenshot({ path: 'test-results/cardano-swap-order-open.png', fullPage: true })

      await expect(page.getByText('Swap complete')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/Received\s+5\.071002 MIN/)).toBeVisible()
      await page.screenshot({ path: 'test-results/cardano-swap-filled.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })
})
