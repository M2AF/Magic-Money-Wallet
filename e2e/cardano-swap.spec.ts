import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stubWorker } from './support/worker-stub-browser'

/** Pick a network in a ChainDropdown (the swap From/To network pickers). */
async function pickNetwork(page: Page, name: string, value: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('listbox', { name }).locator(`[data-value="${value}"]`).click()
}

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
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-cardano-swap-')), {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
  await stubWorker(ctx)
  return ctx
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
  test('keeps Cardano cross-chain pairs in DEX Swap without an exchange handoff (quotable both ways)', async () => {
    test.setTimeout(150_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __creates: number }
        w.__creates = 0
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '120' }, solana: { native: '5' }, ethereum: { native: '1' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => { throw new Error('Unsupported cross-chain DEX quote requested') }
        w.wallet.xCreateExchange = async () => { w.__creates++; throw new Error('Creation must remain explicit') }
      })
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      for (const [source, target] of [
        ['cardano', 'solana'], ['solana', 'cardano'], ['cardano', 'ethereum'], ['ethereum', 'cardano'],
      ]) {
        await page.getByRole('button', { name: 'DEX Swap', exact: true }).click()
        await pickNetwork(page, 'From network', source)
        await pickNetwork(page, 'To network', target)
        await expect(page.getByRole('button', { name: 'From network', exact: true })).toHaveAttribute('data-value', source)
        await page.getByPlaceholder('0.0').first().fill('20.000001')
        // Both directions are DEX swaps through NEAR Intents.
        await expect(page.getByRole('button', { name: 'Get Quote', exact: true })).toHaveCount(1)
        await expect(page.getByRole('button', { name: 'Check exchange route' })).toHaveCount(0)
        await expect(page.getByText(/exchange providers|exchange catalog/)).toHaveCount(0)
        if (source === 'cardano') await expect(page.getByTestId('journey-routes')).toBeVisible()
        expect(await page.evaluate(() => (window as unknown as { __creates: number }).__creates)).toBe(0)
      }
      await page.setViewportSize({ width: 400, height: 820 })
      await page.getByRole('button', { name: 'DEX Swap', exact: true }).click()
      await pickNetwork(page, 'From network', 'cardano')
      await page.getByRole('button', { name: 'Pay token' }).click()
      await page.getByRole('option').filter({ hasText: 'USDCx' }).click()
      await pickNetwork(page, 'To network', 'solana')
      await expect(page.getByRole('button', { name: 'Pay token' })).toContainText('USDCx')
      await expect(page.getByRole('button', { name: 'Check exchange route' })).toHaveCount(0)
      await page.screenshot({ path: '.screenshots/cardano-dex-route-preview-mobile.png', fullPage: true })
    } finally { await ctx.close() }
  })

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

      // Offered by the REAL resolver. Cardano is no longer same-chain only (ADA
      // can leave through NEAR Intents), so the receive side is chosen explicitly.
      const from = page.getByRole('button', { name: 'From network', exact: true })
      await from.click()
      await expect(page.getByRole('listbox', { name: 'From network' }).locator('[data-value="cardano"]')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await pickNetwork(page, 'From network', 'cardano')
      await pickNetwork(page, 'To network', 'cardano')
      await expect(page.getByRole('button', { name: 'To network', exact: true })).toHaveAttribute('data-value', 'cardano')
      await expect(page.getByRole('button', { name: 'Pay token' })).toContainText('ADA')
      await expect(page.getByText('uses the Cross-Chain exchange')).toHaveCount(0)

      // An explicit cross-chain destination must preserve the Cardano pay side.
      await pickNetwork(page, 'To network', 'ethereum')
      await expect(from).toHaveAttribute('data-value', 'cardano')
      await expect(page.getByRole('button', { name: 'Check exchange route' })).toHaveCount(0)
      await pickNetwork(page, 'To network', 'cardano')

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

test.describe('Cardano swap (Danogo pool)', () => {
  test('discloses an atomic pool swap (no deposit, no order) and reports it complete once on Cardano', async () => {
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

      // Shaped like the privileged layer's Danogo quote for the recorded
      // 20 ADA -> USDCx build (2026-10-05); the receive token is the default.
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
            sellAmountRaw: '20000000', buyAmountRaw: '5298566', minBuyAmountRaw: '5298566', minReceivedSource: 'provider',
            estimatedGasRaw: '0', slippageBps: 50, priceImpactPct: 0.32, rate: 0.2649, expiresAt: Date.now() + 45_000,
            isCrossChain: false, bridgeTool: 'Danogo CLMM', estimatedDurationSec: 30, feeBps: 0,
            appFee: { policyVersion: 'x', provider: 'minswap', requestedBps: 0, appliedBps: 0, base: 'input', chain: 'cardano',
              tokenAddress: null, tokenSymbol: null, tokenDecimals: null, amountRaw: '0', recipient: null, recipientKind: 'none',
              collection: 'in-swap', providerSharePct: null, verification: 'none-requested', evidence: [] },
            externalFees: [
              { name: 'Danogo swap fee', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: '100000', includedInQuotedOutput: false },
              { name: 'Minswap aggregator fee', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: '850000', includedInQuotedOutput: false },
            ],
            txData: { cbor: '84a0a0f5f6' }, approvalTx: null, intentId: 'stub',
            cardanoOrder: { protocol: 'DanogoCLMMV1', path: ['lovelace', MIN], batcherFeeLovelace: '0', depositLovelace: '0',
              aggregatorFeeLovelace: '850000', dexFeeLovelace: '100000' },
            cardanoCost: { txFeeLovelace: '477729', batcherFeeLovelace: '0', depositLovelace: '0', aggregatorFeeLovelace: '850000',
              dexFeeLovelace: '100000', adaSpentLovelace: '21427729', validUntilSlot: '199658389', orderMinimumRaw: '5298566', killable: null },
          },
        })
        w.wallet.swapExecute = async () => ({ txHash: 'fe'.repeat(32), explorerUrl: `https://cardanoscan.io/transaction/${'fe'.repeat(32)}`, approvalTxHash: null })
        w.wallet.swapCrossStatus = async () => {
          w.__status++
          return w.__status < 2
            ? { status: 'pending', state: 'source-submitted', error: null, providerStatus: 'NOT_FOUND', message: null }
            : { status: 'done', state: 'completed', error: null, message: null, providerStatus: 'DONE', providerSubstatus: 'COMPLETED',
                delivered: { chain: 'cardano', address: MIN, symbol: null, decimals: null, amountRaw: '5298566' },
                destExplorerUrl: `https://cardanoscan.io/transaction/${'fe'.repeat(32)}` }
        }
      }, { MIN })

      await pickNetwork(page, 'From network', 'cardano')
      await pickNetwork(page, 'To network', 'cardano')
      await page.getByPlaceholder('0.0').first().fill('20')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      await expect(page.getByText('This swaps directly with a Danogo pool.')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('nothing is spent')).toBeVisible()
      await expect(page.getByText('This places a Minswap order.')).toHaveCount(0)
      await expect(page.getByText('Deposit (returned)')).toHaveCount(0)
      await expect(page.getByText('ADA needed up front')).toBeVisible()
      await page.getByText('This swaps directly with a Danogo pool.').scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/cardano-danogo-quote.png', fullPage: true })

      await page.getByRole('button', { name: /^Swap ADA/ }).click()
      await expect(page.getByText('Swap sent — waiting for Cardano to confirm it')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /Manage or cancel on Minswap/ })).toHaveCount(0)
      await expect(page.getByText(/Danogo pool/).first()).toBeVisible()
      await expect(page.getByText('the wallet keeps tracking the swap')).toBeVisible()
      await page.screenshot({ path: 'test-results/cardano-danogo-sent.png', fullPage: true })

      await expect(page.getByText('Swap complete')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/Received\s+5\.298566 MIN/)).toBeVisible()
      await page.screenshot({ path: 'test-results/cardano-danogo-complete.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Routes across networks (journey registry)', () => {
  const usdcx = { chain: 'cardano', address: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378', symbol: 'USDCx', decimals: 6 }

  async function open(page: Page, ctx: BrowserContext) {
    const extId = ctx.serviceWorkers()[0]?.url().split('/')[2] ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
    await page.goto(`chrome-extension://${extId}/popup.html`)
    await createWalletToDashboard(page)
    await page.locator('.bottom-nav-btn:has-text("Swap")').click()
    await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
  }

  test('Cardano -> Ethereum: USDCx and Coinbase routes are previews with named unknown costs; nothing executes', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      await open(page, ctx)
      await page.evaluate(({ usdcx }) => {
        const w = window as unknown as { wallet: Record<string, unknown>; __requests: unknown[] }
        w.__requests = []
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '120' }, ethereum: { native: '0' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        const ada = { chain: 'cardano', address: 'lovelace', symbol: 'ADA', decimals: 6 }
        const usdc = { chain: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 }
        w.wallet.swapJourneyPlan = async (req: { toToken: { address: string; symbol: string; decimals: number } }) => {
          w.__requests.push(req)
          const dest = { chain: 'ethereum', ...req.toToken }
          const preview = {
            family: 'usdcx-xreserve', label: 'USDCx via Circle xReserve', source: ada, destination: dest,
            legs: [
              { kind: 'swap', label: 'Swap ADA → USDCx on Cardano', status: 'quoted', from: ada, to: usdcx, inputBasis: 'exact', inRaw: '20000000', expectedOutRaw: '5298566', minOutRaw: '5298566', via: 'Danogo CLMM', expiresAt: 1, reason: null },
              { kind: 'bridge', label: 'Bridge USDCx → USDC on ethereum', status: 'unavailable', from: usdcx, to: usdc, inputBasis: 'floor', inRaw: '5298566', expectedOutRaw: null, minOutRaw: null, via: 'Circle xReserve', expiresAt: null, reason: 'Circle publishes no withdrawal fee schedule; a fee ceiling must be chosen before the bridge can be priced.' },
              { kind: 'swap', label: 'Swap USDC → ETH on ethereum', status: 'quoted', from: usdc, to: dest, inputBasis: 'indicative', inRaw: '5298566', expectedOutRaw: '2000000000000000', minOutRaw: '1990000000000000', via: 'LI.FI', expiresAt: 2, reason: null },
            ],
            costs: [
              { label: 'Cardano network fee', leg: 0, chain: 'cardano', symbol: 'ADA', decimals: 6, amountRaw: '477729', usd: null, kind: 'gas', includedInOutput: false },
              { label: 'Circle withdrawal fee', leg: 1, chain: 'cardano', symbol: 'USDCx', decimals: 6, amountRaw: null, usd: null, kind: 'fee', includedInOutput: false },
            ],
            executable: false, validated: false, finalExpectedRaw: null, finalMinRaw: null, finalOutputUsd: null,
            blockers: ['The Cardano USDCx burn is built by the IOG Portal backend, and that build has not yet been validated by this wallet.'],
          }
          const coinbase = { family: 'coinbase-conversion', label: 'ADA → cbADA through a Coinbase account', source: ada, destination: dest, legs: [], costs: [],
            executable: false, validated: false, finalExpectedRaw: null, finalMinRaw: null, finalOutputUsd: null, blockers: ['Requires a connected Coinbase account; the wallet has no Coinbase connection.'] }
          return { ok: true, value: { candidates: [preview, coinbase], ranking: { recommended: null, noRecommendation: 'No route can be executed yet.', executable: [], previews: [preview, coinbase] } } }
        }
      }, { usdcx })
      await pickNetwork(page, 'From network', 'cardano')
      await pickNetwork(page, 'To network', 'ethereum')
      await page.getByPlaceholder('0.0').first().fill('20')
      const panel = page.getByTestId('journey-routes')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await panel.getByRole('button', { name: 'Find routes' }).click()
      await expect(panel.getByText('No route can be executed yet.')).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('Previews — not executable yet')).toBeVisible()
      const usd = panel.getByTestId('journey-preview-usdcx-xreserve')
      await expect(usd.getByText(/Swap ADA → USDCx on Cardano — ≥ 5\.298566 USDCx via Danogo CLMM/)).toBeVisible()
      await expect(usd.getByText(/fee ceiling must be chosen/)).toBeVisible()
      await expect(usd.getByText('Costs (total unknown)')).toBeVisible()
      await expect(usd.getByText('• Circle withdrawal fee: unknown')).toBeVisible()
      await expect(panel.getByTestId('journey-preview-coinbase-conversion').getByText(/connected Coinbase account/)).toBeVisible()
      await expect(panel.getByText('Recommended')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Swap / })).toHaveCount(0)
      const sent = await page.evaluate(() => (window as unknown as { __requests: Array<Record<string, unknown>> }).__requests[0])
      expect(sent).toMatchObject({ fromChain: 'cardano', toChain: 'ethereum', sellAmountRaw: '20000000' })
      expect(sent).not.toHaveProperty('recipient')
      await panel.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/journey-cardano-previews.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })

  test('Base -> Solana: a recommendation is shown apart from previews, and previews are never "cheapest"', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      await open(page, ctx)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown> }
        w.wallet.getBalances = async () => ({ chains: { base: { native: '0.1' }, solana: { native: '1' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => ({ quote: null, error: 'stub: no direct route' })
        const cbBase = { chain: 'base', address: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', symbol: 'cbADA', decimals: 6 }
        const cbSol = { chain: 'solana', address: 'cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg', symbol: 'cbADA', decimals: 6 }
        w.wallet.swapJourneyPlan = async (req: { fromToken: { address: string; symbol: string; decimals: number }; toToken: { address: string; symbol: string; decimals: number } }) => {
          const src = { chain: 'base', ...req.fromToken }, dst = { chain: 'solana', ...req.toToken }
          const card = (family: string, label: string, executable: boolean, out: string, ccipUsd: number | null) => ({
            family, label, source: src, destination: dst, executable, validated: executable, finalExpectedRaw: out, finalMinRaw: out, finalOutputUsd: 100,
            legs: [
              { kind: 'swap', label: `Swap ${src.symbol} → cbADA on base`, status: 'quoted', from: src, to: cbBase, inputBasis: 'exact', inRaw: '100000000', expectedOutRaw: '372239925', minOutRaw: '370378725', via: 'LI.FI', expiresAt: 1, reason: null },
              { kind: 'bridge', label: 'Bridge cbADA base → solana (Chainlink CCIP)', status: 'prepared', from: cbBase, to: cbSol, inputBasis: 'floor', inRaw: '370378725', expectedOutRaw: '370378725', minOutRaw: '370378725', via: 'Chainlink CCIP', expiresAt: null, reason: null },
              { kind: 'swap', label: `Swap cbADA → ${dst.symbol} on solana`, status: 'quoted', from: cbSol, to: dst, inputBasis: 'indicative', inRaw: '370378725', expectedOutRaw: out, minOutRaw: out, via: 'Jupiter', expiresAt: 2, reason: null },
            ],
            costs: [
              { label: 'Chainlink CCIP fee', leg: 1, chain: 'base', symbol: 'ETH', decimals: 18, amountRaw: '1384650232086707', usd: ccipUsd, kind: 'fee', includedInOutput: false },
              { label: 'base network fee for the CCIP send', leg: 1, chain: 'base', symbol: 'ETH', decimals: 18, amountRaw: null, usd: executable ? 0.01 : null, kind: 'gas', includedInOutput: false },
            ],
            blockers: executable ? [] : ['Sending cbADA over Chainlink CCIP is not implemented or validated in this wallet yet.'],
          })
          const rec = card('cbada-ccip', 'cbADA via Chainlink CCIP (stub: executable)', true, '9900000000', 3.46)
          const preview = card('cbada-ccip', 'cbADA via Chainlink CCIP', false, '99990000000', null)
          return { ok: true, value: { candidates: [rec, preview], ranking: { recommended: { candidate: rec, reason: 'best-net-result', best: rec, shortfallBps: 0 }, noRecommendation: null, executable: [rec], previews: [preview] } } }
        }
      })
      await pickNetwork(page, 'From network', 'base')
      await pickNetwork(page, 'To network', 'solana')
      await page.getByPlaceholder('0.0').first().fill('100')
      const panel = page.getByTestId('journey-routes')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await panel.getByRole('button', { name: 'Find routes' }).click()
      await expect(panel.getByText('Recommended')).toBeVisible({ timeout: 10_000 })
      const rec = panel.getByTestId('journey-recommended-cbada-ccip')
      await expect(rec.getByText(/Costs: ≈\$3\.47 in total/)).toBeVisible()
      // The preview has a LARGER output but is listed apart and never recommended or called cheapest.
      const pre = panel.getByTestId('journey-preview-cbada-ccip')
      await expect(pre.getByText(/\(estimate\)/)).toBeVisible()
      await expect(pre.getByText('Costs (total unknown)')).toBeVisible()
      await expect(pre.getByText(/not implemented or validated/)).toBeVisible()
      await expect(panel.getByText(/cheapest/i)).toHaveCount(0)
      await panel.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/journey-base-solana.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })

  test('a slow answer for an old amount is dropped, never shown under the new amount', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      await open(page, ctx)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __release: () => void; __calls: string[] }
        w.__calls = []
        w.wallet.getBalances = async () => ({ chains: { base: { native: '0.1' }, solana: { native: '1' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => ({ quote: null, error: 'stub' })
        const answer = (label: string) => {
          const c = { family: 'cbada-ccip', label, source: { chain: 'base', address: 'x', symbol: 'ETH', decimals: 18 }, destination: { chain: 'solana', address: 'y', symbol: 'SOL', decimals: 9 },
            legs: [], costs: [], executable: false, validated: false, finalExpectedRaw: null, finalMinRaw: null, finalOutputUsd: null, blockers: [] }
          return { ok: true, value: { candidates: [c], ranking: { recommended: null, noRecommendation: 'No route can be executed yet.', executable: [], previews: [c] } } }
        }
        w.wallet.swapJourneyPlan = async (req: { sellAmountRaw: string }) => {
          w.__calls.push(req.sellAmountRaw)
          if (w.__calls.length === 1) { await new Promise<void>(r => { w.__release = r }); return answer('STALE answer for the old amount') }
          return answer('FRESH answer for the new amount')
        }
      })
      await pickNetwork(page, 'From network', 'base')
      await pickNetwork(page, 'To network', 'solana')
      const amount = page.getByPlaceholder('0.0').first()
      await amount.fill('1')
      const panel = page.getByTestId('journey-routes')
      await panel.getByRole('button', { name: 'Find routes' }).click()
      await expect(panel.getByRole('button', { name: 'Checking each route…' })).toBeVisible()
      await amount.fill('2')
      await page.evaluate(() => (window as unknown as { __release: () => void }).__release())
      await page.waitForTimeout(500)
      await expect(panel.getByText(/STALE answer/)).toHaveCount(0)
      await expect(panel.getByRole('button', { name: 'Find routes' })).toBeEnabled()
      await panel.getByRole('button', { name: 'Find routes' }).click()
      await expect(panel.getByText(/FRESH answer for the new amount/)).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText(/STALE answer/)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('restored journeys: this wallet only, re-checked by saved hash, and no way to send again', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2] ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      // Stub BEFORE the Swap screen mounts: the view loads the list on mount.
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __rechecks: string[] }
        w.__rechecks = []
        w.wallet.getBalances = async () => ({ chains: { base: { native: '0.1' }, solana: { native: '1' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.journeyList = async () => ({ ok: true, value: {
          active: [{ id: 'j1', bridge: 'ccip-cbada', createdAt: Date.now() - 600_000, legs: [
            { role: 'source-swap', chain: 'base', state: 'skipped', txHash: null, providerRef: null, inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
            { role: 'bridge', chain: 'base', state: 'uncertain', txHash: '0x' + 'cd'.repeat(32), providerRef: null, approvalTxHash: '0x' + '77'.repeat(32), inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
            { role: 'destination-swap', chain: 'solana', state: 'skipped', txHash: null, providerRef: null, inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
          ] }],
          awaitingEvidence: 1, finished: 0, otherWallets: 2, unreadable: [],
        } })
        w.wallet.journeyRecheck = async (id: string) => {
          w.__rechecks.push(id)
          return { ok: true, value: { journeyId: id, legs: [{ role: 'bridge', kind: 'approval', chain: 'base', txHash: '0x' + '77'.repeat(32), onChain: 'confirmed', allowanceCovers: true,
            messageId: null, delivery: null, note: 'Approval confirmed. The transfer itself has not been sent.' }, { role: 'bridge', kind: 'transaction', allowanceCovers: null, chain: 'base', txHash: '0x' + 'cd'.repeat(32), onChain: 'confirmed',
            messageId: '0x' + 'ab'.repeat(32), delivery: { state: 'delivered', signature: '5yDeliverySignature1111111111111111111111111', sequenceNumber: '9' }, note: null }] } }
        }
      })
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      const view = page.getByTestId('journeys-in-progress')
      await expect(view).toBeVisible({ timeout: 15_000 })
      await expect(view.getByText(/Bridge cbADA → cbADA on Base — sent — outcome unknown/)).toBeVisible()
      await expect(view.getByText(/never sent a second time/)).toBeVisible()
      await view.getByRole('button', { name: 'Check on chain' }).click()
      await expect(view.getByText(/on chain: succeeded/).first()).toBeVisible({ timeout: 10_000 })
      await expect(view.getByText(/Delivered on Solana \(proven by the OffRamp event and the exact credit\)/)).toBeVisible()
      await expect(view.getByText(/approval 0x77777777/)).toBeVisible()
      await expect(view.getByText(/Approval on Base: on chain: succeeded · allowance covers the amount/)).toBeVisible()
      // The only action is checking: nothing that sends.
      await expect(view.getByRole('button')).toHaveCount(1)
      await expect(view.getByRole('button', { name: /resend|send again|retry/i })).toHaveCount(0)
      expect(await page.evaluate(() => (window as unknown as { __rechecks: string[] }).__rechecks)).toEqual(['j1'])
      await view.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/journeys-in-progress.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })

  test('cbADA Base -> Solana: live terms are shown, approved by proposal id only, and nothing is sent', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      await open(page, ctx)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __auth: unknown[][]; __cancel: unknown[][]; __reviews: number; __saved: boolean; __cancelled: boolean }
        w.__auth = []; w.__cancel = []; w.__reviews = 0; w.__saved = false; w.__cancelled = false
        w.wallet.getBalances = async () => ({ chains: { base: { native: '0.1' }, solana: { native: '1' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => ({ quote: null, error: 'stub: no direct route' })
        const cbBase = { chain: 'base', address: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', symbol: 'cbADA', decimals: 6 }
        const cbSol = { chain: 'solana', address: 'cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg', symbol: 'cbADA', decimals: 6 }
        const listed = (t: typeof cbBase) => ({ ...t, name: 'Coinbase Wrapped ADA', logoUri: null, isNative: false, verified: true, source: 'relay' })
        w.wallet.swapGetTokens = async (req: { chain: string; address?: string }) => {
          const t = req.chain === 'solana' ? cbSol : cbBase
          return { tokens: req.address && req.address.toLowerCase() === t.address.toLowerCase() ? [listed(t)] : [], error: null }
        }
        const skip = (label: string, a: unknown) => ({ kind: 'swap', label, status: 'skipped', from: a, to: a, inputBasis: 'exact', inRaw: '1000000', expectedOutRaw: '1000000', minOutRaw: '1000000', via: null, expiresAt: null, reason: 'Already cbADA; no swap needed.' })
        w.wallet.swapJourneyPlan = async () => {
          const c = { family: 'cbada-ccip', label: 'cbADA via Chainlink CCIP', source: cbBase, destination: cbSol, executable: false, validated: false,
            finalExpectedRaw: '1000000', finalMinRaw: '1000000', finalOutputUsd: null,
            legs: [skip('Swap cbADA → cbADA on Base', cbBase),
              { kind: 'bridge', label: 'Bridge cbADA Base → Solana (Chainlink CCIP)', status: 'prepared', from: cbBase, to: cbSol, inputBasis: 'floor', inRaw: '1000000', expectedOutRaw: '1000000', minOutRaw: '1000000', via: 'Chainlink CCIP', expiresAt: null, reason: null },
              skip('Swap cbADA → cbADA on Solana', cbSol)],
            costs: [{ label: 'Chainlink CCIP fee', leg: 1, chain: 'base', symbol: 'ETH', decimals: 18, amountRaw: '1381990916993365', usd: null, kind: 'fee', includedInOutput: false }],
            blockers: ['Sending cbADA over Chainlink CCIP is not implemented or validated in this wallet yet.'] }
          return { ok: true, value: { candidates: [c], ranking: { recommended: null, noRecommendation: 'No route can be executed yet.', executable: [], previews: [c] } } }
        }
        const review = (amountRaw: string, problems: string[]) => ({
          proposalId: 'p' + (++w.__reviews), quotedAt: Date.now(), expiresAt: Date.now() + 120_000,
          sender: '0x720f28c62b844e7dd8705ab0a7651f3f575384f4', accountIndex: 0, recipient: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', amountRaw,
          baseToken: cbBase.address, solanaMint: cbSol.address, router: '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD',
          ccipFeeWei: '1381990916993365', maxCcipFeeWei: '1520190008692701', needsApproval: true, allowanceRaw: '0', maxFeePerGasWei: '7000000',
          approvalGas: { estimateUnits: '56338', ceilingUnits: '84507', maxWei: '1183098000000', l1FeeWei: '1262269329' },
          sendGas: { estimateUnits: null, ceilingUnits: '450000', maxWei: '6300000000000', l1FeeWei: '2471736671' },
          totalMaxEthWei: '1527673106692701', cbAdaBalanceRaw: '5000000', ethBalanceWei: '20000000000000000',
          outboundRateLimit: { enabled: true, availableRaw: '10000000000000', capacityRaw: '10000000000000' }, problems,
        })
        w.wallet.journeyCbAdaReview = async (amountRaw: string) => ({ ok: true, value: review(amountRaw, w.__reviews === 0 ? ['The wallet does not hold enough cbADA on Base.'] : []) })
        w.wallet.journeyCbAdaAuthorize = async (...args: unknown[]) => { w.__auth.push(args); w.__saved = true; return { ok: true, value: { journeyId: 'cbada-1' } } }
        w.wallet.journeyCancel = async (...args: unknown[]) => { w.__cancel.push(args); w.__cancelled = true; return { ok: true, value: { journeyId: 'cbada-1' } } }
        w.wallet.journeyList = async () => ({ ok: true, value: {
          active: w.__saved && !w.__cancelled ? [{ id: 'cbada-1', bridge: 'ccip-cbada', createdAt: Date.now(), cancellable: true,
            authorization: { sender: '0x720f28c62b844e7dd8705ab0a7651f3f575384f4', accountIndex: 0, maxCcipFeeWei: '1520190008692701', maxApprovalGasWei: '1183098000000', maxSendGasWei: '6300000000000', approvedAt: Date.now() },
            legs: [
              { role: 'source-swap', chain: 'base', state: 'skipped', txHash: null, providerRef: null, approvalTxHash: null, approvedInputRaw: null, inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
              { role: 'bridge', chain: 'base', state: 'approved', txHash: null, providerRef: null, approvalTxHash: null, approvedInputRaw: '2000000', inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
              { role: 'destination-swap', chain: 'solana', state: 'skipped', txHash: null, providerRef: null, approvalTxHash: null, approvedInputRaw: null, inputSymbol: 'cbADA', outputSymbol: 'cbADA' },
            ] }] : [],
          awaitingEvidence: 0, finished: 0, otherWallets: 0, unreadable: [],
        } })
      })
      await pickNetwork(page, 'From network', 'base')
      await pickNetwork(page, 'To network', 'solana')
      for (const [name, address] of [['Pay token', '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c'], ['Receive token', 'cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg']]) {
        await page.getByRole('button', { name }).click()
        const dialog = page.getByRole('dialog', { name })
        await dialog.getByRole('textbox', { name: 'Search tokens' }).fill(address)
        await dialog.getByRole('option').filter({ hasText: 'cbADA' }).first().click()
        await expect(page.getByRole('button', { name })).toContainText('cbADA')
      }
      await page.getByPlaceholder('0.0').first().fill('1')
      const panel = page.getByTestId('journey-routes')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await panel.getByRole('button', { name: 'Find routes' }).click()
      const terms = panel.getByTestId('cbada-terms')
      await expect(terms).toBeVisible({ timeout: 10_000 })
      await expect(terms.getByText(/nothing is signed or sent/)).toBeVisible()

      // A live problem blocks approval.
      await terms.getByRole('button', { name: 'Review transfer terms' }).click()
      await expect(terms.getByTestId('cbada-terms-problems')).toContainText('does not hold enough cbADA')
      await expect(terms.getByRole('checkbox')).toBeDisabled()
      await expect(terms.getByRole('button', { name: 'Approve terms' })).toBeDisabled()

      // A new amount resets the panel; the next review is clean.
      await page.getByPlaceholder('0.0').first().fill('2')
      await panel.getByRole('button', { name: 'Find routes' }).click()
      await terms.getByRole('button', { name: 'Review transfer terms' }).click()
      await expect(terms.getByText('0x720f28c62b844e7dd8705ab0a7651f3f575384f4 · account 1')).toBeVisible({ timeout: 10_000 })
      await expect(terms.getByText('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV · this account')).toBeVisible()
      await expect(terms.getByText(/^2 cbADA/)).toBeVisible()
      await expect(terms.getByText('0.00152 ETH', { exact: true })).toBeVisible()
      await expect(terms.getByText(/needed, for exactly 2 cbADA · max gas 0\.000001183 ETH/)).toBeVisible()
      await expect(terms.getByText('0.0000063 ETH', { exact: true })).toBeVisible()
      await expect(terms.getByText('0.001528 ETH')).toBeVisible()
      await expect(terms.getByText(/10,000,000 cbADA available/)).toBeVisible()
      const approve = terms.getByRole('button', { name: 'Approve terms' })
      await expect(approve).toBeDisabled()
      await terms.getByRole('checkbox').check()
      await expect(approve).toBeEnabled()
      await terms.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/cbada-terms-review.png', fullPage: true })
      await approve.click()
      await expect(terms.getByTestId('cbada-terms-saved')).toContainText('nothing was signed or sent')
      // Only the proposal id crossed to the privileged layer.
      expect(await page.evaluate(() => (window as unknown as { __auth: unknown[][] }).__auth)).toEqual([['p2']])

      // The saved transfer appears under Journeys in progress, cancellable because nothing was sent.
      const view = page.getByTestId('journeys-in-progress')
      await expect(view).toBeVisible({ timeout: 10_000 })
      await expect(view.getByText(/Approved terms: 2 cbADA from 0x720f28…5384f4/)).toBeVisible()
      await expect(view.getByText(/Sending is not enabled in this build/)).toBeVisible()
      await expect(view.getByRole('button', { name: /resend|send again|retry/i })).toHaveCount(0)
      await view.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/cbada-terms-saved.png', fullPage: true })
      await view.getByRole('button', { name: 'Cancel (nothing was sent)' }).click()
      await view.getByRole('button', { name: 'Confirm: cancel this transfer' }).click()
      await expect(view).toHaveCount(0, { timeout: 10_000 })
      expect(await page.evaluate(() => (window as unknown as { __cancel: unknown[][] }).__cancel)).toEqual([['cbada-1']])
    } finally {
      await ctx.close()
    }
  })

  test('USDCx withdrawal journey: where the funds are, and burn -> operator -> release evidence; no resend', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2] ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __checked: boolean }
        w.__checked = false
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '10' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        const burn = '887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86'
        w.wallet.journeyList = async () => ({ ok: true, value: {
          active: w.__checked ? [] : [{ id: 'u1', bridge: 'xreserve-cardano-ethereum', createdAt: Date.now() - 3_600_000, cancellable: false, authorization: null,
            holding: { chain: 'ethereum', symbol: 'USDC', decimals: 6, amountRaw: null, settled: false },
            legs: [
              { role: 'source-swap', chain: 'cardano', state: 'skipped', txHash: null, providerRef: null, approvalTxHash: null, approvedInputRaw: null, inputSymbol: 'USDCx', outputSymbol: 'USDCx' },
              { role: 'bridge', chain: 'cardano', state: 'uncertain', txHash: burn, providerRef: null, approvalTxHash: null, approvedInputRaw: '2802000000', inputSymbol: 'USDCx', outputSymbol: 'USDC' },
              { role: 'destination-swap', chain: 'ethereum', state: 'skipped', txHash: null, providerRef: null, approvalTxHash: null, approvedInputRaw: null, inputSymbol: 'USDC', outputSymbol: 'USDC' },
            ] }],
          awaitingEvidence: 1, finished: w.__checked ? 1 : 0, otherWallets: 0, unreadable: [],
        } })
        // The check proves arrival: the stored journey completes and leaves the active list.
        w.wallet.journeyRecheck = async (id: string) => (w.__checked = true, { ok: true, value: { journeyId: id, legs: [{
          role: 'bridge', kind: 'transaction', chain: 'cardano', txHash: burn, onChain: 'confirmed', allowanceCovers: null, messageId: null, delivery: null,
          burn: { burn: 'verified', burnDepth: 1623, burnFinal: true, provider: 'finalized', providerStatus: 'finalized',
            releaseTxHash: '0x37dce9fab6f48033691f841be3c783bd9154998054490d535795cac2876b5630', credit: 'verified', creditedRaw: '2800000000', reason: null },
          note: null }] } })
      })
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      const view = page.getByTestId('journeys-in-progress')
      await expect(view).toBeVisible({ timeout: 15_000 })
      await view.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/usdcx-journey-in-transit.png', fullPage: true })
      await expect(view.getByTestId('journey-holding')).toHaveText('Funds now: in transit to USDC on Ethereum — waiting for proof of arrival.')
      await expect(view.getByText(/Bridge USDCx → USDC on Cardano — sent — outcome unknown/)).toBeVisible()
      // Nothing that sends: no resend, retry, and no cancel once a burn was sent.
      await expect(view.getByRole('button')).toHaveCount(1)
      await view.getByRole('button', { name: 'Check on chain' }).click()
      const finished = view.getByTestId('journey-finished-u1')
      await expect(finished).toBeVisible({ timeout: 10_000 })
      await expect(finished.getByText('1. Burn on Cardano: verified against the approved terms · 1623 blocks deep')).toBeVisible()
      await expect(finished.getByText('2. IOG operator: finalized (finalized)')).toBeVisible()
      await expect(finished.getByText(/3\. Release on Ethereum: credit verified — 2,800 USDC · 0x37dce9fa…/)).toBeVisible()
      await expect(view.getByTestId('journey-holding')).toHaveCount(0)
      await view.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/usdcx-journey-evidence.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Cardano -> Solana (NEAR Intents)', () => {
  test('quotes ADA -> SOL in DEX Swap, discloses custody and refund, and tracks delivery by deposit address', async () => {
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

      const DEPOSIT = 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c5'
      await page.evaluate(({ DEPOSIT }) => {
        const w = window as unknown as { wallet: Record<string, unknown>; __statusReqs: unknown[]; __n: number }
        w.__statusReqs = []; w.__n = 0
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '120' }, solana: { native: '0.5' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async (req: { toAddress: string; taker: string }) => ({
          error: null,
          quote: {
            provider: 'near-intents', fromChain: 'cardano', toChain: 'solana',
            fromTokenAddress: 'lovelace', toTokenAddress: 'So11111111111111111111111111111111111111112', fromTokenSymbol: 'ADA', toTokenSymbol: 'SOL',
            sellAmountRaw: '10000000', buyAmountRaw: '19917228', minBuyAmountRaw: '19718055', minReceivedSource: 'provider',
            estimatedGasRaw: '0', slippageBps: 100, priceImpactPct: 0, rate: 0.0019917, expiresAt: Date.now() + 60_000,
            isCrossChain: true, toAddress: req.toAddress, bridgeTool: 'near-intents', estimatedDurationSec: 24,
            appFee: { policyVersion: 'x', provider: 'near-intents', requestedBps: 0, appliedBps: 0, base: 'input', chain: 'cardano',
              tokenAddress: null, tokenSymbol: null, tokenDecimals: null, amountRaw: '0', recipient: null, recipientKind: 'none',
              collection: 'in-swap', providerSharePct: null, verification: 'none-requested', evidence: [] },
            externalFees: [{ name: 'NEAR Intents payout fee', tokenSymbol: 'SOL', tokenDecimals: 9, amountRaw: '97781', includedInQuotedOutput: true }],
            requestId: null, txData: {}, intentId: 'stub',
            nearIntents: { originAsset: 'nep141:cardano.omft.near', destinationAsset: 'nep141:sol.omft.near', slippageBps: 100,
              refundTo: req.taker, recipient: req.toAddress, refundFeeLovelace: '200000' },
          },
        })
        w.wallet.swapExecute = async () => ({ txHash: 'ab'.repeat(32), explorerUrl: `https://cardanoscan.io/transaction/${'ab'.repeat(32)}`, approvalTxHash: null, requestId: DEPOSIT })
        w.wallet.swapCrossStatus = async (req: unknown) => {
          w.__statusReqs.push(req); w.__n++
          return w.__n < 2
            ? { status: 'pending', state: 'bridging', error: null, providerStatus: 'PROCESSING', message: null }
            : { status: 'done', state: 'completed', error: null, message: null, providerStatus: 'SUCCESS', deliveredAmountSource: 'onchain',
                delivered: { chain: 'solana', address: 'So11111111111111111111111111111111111111112', symbol: null, decimals: null, amountRaw: '19905000' },
                destTxHash: 'solsig', destExplorerUrl: 'https://solscan.io/tx/solsig' }
        }
      }, { DEPOSIT })

      await pickNetwork(page, 'From network', 'cardano')
      await pickNetwork(page, 'To network', 'solana')
      // A real swap, not the exchange hand-off or the journey previews only.
      await expect(page.getByRole('button', { name: 'From network', exact: true })).toHaveAttribute('data-value', 'cardano')
      await expect(page.getByRole('button', { name: 'To network', exact: true })).toHaveAttribute('data-value', 'solana')
      await page.getByPlaceholder('0.0').first().fill('10')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      const terms = page.getByTestId('near-intents-terms')
      await expect(terms).toBeVisible({ timeout: 10_000 })
      await expect(terms).toContainText('one-time NEAR Intents deposit address on Cardano')
      await expect(terms).toContainText('held by NEAR Intents\' bridge')
      await expect(terms).toContainText('minus a 0.2 ADA refund fee')
      await expect(page.getByText('NEAR Intents (1Click)')).toBeVisible()
      await terms.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/near-intents-quote.png', fullPage: true })

      await page.getByRole('button', { name: /^Swap / }).click()
      await expect(page.getByText(/Swap complete/)).toBeVisible({ timeout: 40_000 })
      await page.screenshot({ path: 'test-results/near-intents-complete.png', fullPage: true })
      const reqs = await page.evaluate(() => (window as unknown as { __statusReqs: Array<Record<string, unknown>> }).__statusReqs)
      expect(reqs[0]).toMatchObject({ provider: 'near-intents', requestId: DEPOSIT, toChain: 'solana', minBuyAmountRaw: '19718055' })
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Cardano token -> Solana (multi-step)', () => {
  test('one plan, one approval: hops run in order, a price drop pauses for consent, and the result is measured', async () => {
    test.setTimeout(150_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })

      await page.evaluate(() => {
        type Hop = Record<string, unknown>
        const w = window as unknown as { wallet: Record<string, unknown>; __calls: Array<[string, unknown]> }
        w.__calls = []
        const hop = (o: Hop): Hop => ({ fromDecimals: 6, toDecimals: 6, state: 'pending', provider: null, txHash: null, sellRaw: null, measuredOutRaw: null, message: null, ...o })
        const hops = () => [
          hop({ kind: 'cardano-dex', fromChain: 'cardano', toChain: 'cardano', fromSymbol: 'USDCx', toSymbol: 'ADA', approvedMinOutRaw: '9800000', plannedSellRaw: '5000000' }),
          hop({ kind: 'near-intents', fromChain: 'cardano', toChain: 'solana', fromSymbol: 'ADA', toSymbol: 'SOL', toDecimals: 9, approvedMinOutRaw: '19500000', plannedSellRaw: '9800000' }),
        ]
        const view = (state: string, reason: string | null, mut: (h: Hop[]) => void) => {
          const h = hops(); mut(h)
          return { id: 'chain-1', createdAt: 1, hops: h, finalMinRaw: '19500000', finalExpectedRaw: '19900000', state, reason }
        }
        const firstDone = (h: Hop[]) => { Object.assign(h[0], { state: 'completed', measuredOutRaw: '9910000' }) }
        const seq = [
          view('running', null, h => { h[0].state = 'submitted'; h[0].txHash = 'aa' }),
          view('running', null, firstDone),
          view('paused', 'The price moved: step 2 now guarantees less than you approved. Your funds are 9.91 ADA on Cardano. Continue at the new minimum, or stop here.', firstDone),
        ]
        let n = 0
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '20' }, solana: { native: '0' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => { w.__calls.push(['swapGetQuote', null]); return { error: 'single quote must not be used', quote: null } }
        w.wallet.swapExecute = async () => { w.__calls.push(['swapExecute', null]); throw new Error('must not execute directly') }
        w.wallet.swapChainList = async () => ({ ok: true, value: [] })
        w.wallet.swapChainQuote = async (req: unknown) => {
          w.__calls.push(['swapChainQuote', req])
          return { ok: true, value: { planId: 'plan-1', hops: hops(), finalMinRaw: '19500000', finalExpectedRaw: '19900000', expiresAt: Date.now() + 60_000,
            routes: [
              { kind: 'cardano-dex', provider: 'minswap', fromSymbol: 'USDCx', toSymbol: 'ADA', minOutRaw: '9800000', chain: 'cardano' },
              { kind: 'near-intents', provider: 'near-intents', fromSymbol: 'ADA', toSymbol: 'SOL', minOutRaw: '19500000', chain: 'solana' },
            ] } }
        }
        w.wallet.swapChainStart = async (planId: string) => { w.__calls.push(['swapChainStart', planId]); return { ok: true, value: seq[n++] } }
        w.wallet.swapChainAdvance = async (req: { acceptNewMinimum?: boolean }) => {
          w.__calls.push(['swapChainAdvance', req])
          if (req.acceptNewMinimum) {
            return { ok: true, value: view('completed', null, h => {
              firstDone(h)
              Object.assign(h[1], { state: 'completed', approvedMinOutRaw: '19300000', measuredOutRaw: '19450000', txHash: 'bb' })
            }) }
          }
          return { ok: true, value: seq[Math.min(n++, seq.length - 1)] }
        }
      })

      await pickNetwork(page, 'From network', 'cardano')
      await page.getByRole('button', { name: 'Pay token' }).click()
      await page.getByRole('option').filter({ hasText: 'USDCx' }).click()
      await pickNetwork(page, 'To network', 'solana')
      await page.getByPlaceholder('0.0').first().fill('5')
      await page.getByRole('button', { name: 'Get Quote' }).click()

      const plan = page.getByTestId('chained-swap-quote')
      await expect(plan).toBeVisible({ timeout: 10_000 })
      await expect(plan).toContainText('2 steps, one approval')
      await expect(plan).toContainText('USDCx → ADA · Cardano DEX (best route)')
      await expect(plan).toContainText('ADA → SOL · NEAR Intents')
      await expect(plan).toContainText('0.0195 SOL')
      await expect(page.getByTestId('chained-swap-terms')).toContainText('you approve once')
      await plan.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/chained-swap-quote.png', fullPage: true })

      await page.getByRole('button', { name: 'Swap USDCx → SOL' }).click()
      const progress = page.getByTestId('chained-swap-progress')
      await expect(progress).toBeVisible()
      await expect(page.getByTestId('chained-swap-reason')).toContainText('The price moved', { timeout: 20_000 })
      await expect(page.getByTestId('chain-step-1')).toContainText('done')
      await page.screenshot({ path: 'test-results/chained-swap-paused.png', fullPage: true })
      // Paused for consent: nothing advances on its own.
      const count = () => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)
      const before = await count()
      await page.waitForTimeout(4000)
      expect(await count()).toBe(before)

      await page.getByRole('button', { name: 'Continue at the new minimum' }).click()
      await expect(progress).toContainText('Swap complete')
      await expect(progress).toContainText('Received 0.01945 SOL on Solana')
      await page.screenshot({ path: 'test-results/chained-swap-complete.png', fullPage: true })
      await progress.getByRole('button', { name: 'Close' }).click()
      await expect(progress).toHaveCount(0)

      const calls = await page.evaluate(() => (window as unknown as { __calls: Array<[string, unknown]> }).__calls)
      expect(calls.filter(c => c[0] === 'swapGetQuote' || c[0] === 'swapExecute')).toHaveLength(0)
      expect(calls.filter(c => c[0] === 'swapChainStart')).toEqual([['swapChainStart', 'plan-1']])
      expect(calls.find(c => c[0] === 'swapChainQuote')?.[1]).toMatchObject({ fromSymbol: 'USDCx', toChain: 'solana', toSymbol: 'SOL', sellAmountRaw: '5000000' })
      expect(calls.filter(c => c[0] === 'swapChainAdvance' && (c[1] as { acceptNewMinimum?: boolean }).acceptNewMinimum)).toHaveLength(1)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Cardano swap (SundaeSwap V3 order)', () => {
  test('names SundaeSwap, its protocol fee and the returned deposit on the quote', async () => {
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

      // Shaped like the quote the privileged layer produced live on 2026-10-28 (10 ADA -> SNEK).
      await page.evaluate(({ MIN }) => {
        const w = window as unknown as { wallet: Record<string, unknown> }
        w.wallet.getBalances = async () => ({ chains: { cardano: { native: '120' }, ethereum: { native: '0' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapGetQuote = async () => ({
          error: null,
          quote: {
            provider: 'minswap', fromChain: 'cardano', toChain: 'cardano',
            fromTokenAddress: 'lovelace', toTokenAddress: MIN, fromTokenSymbol: 'ADA', toTokenSymbol: 'MIN',
            sellAmountRaw: '10000000', buyAmountRaw: '3269000', minBuyAmountRaw: '3236000', minReceivedSource: 'provider',
            estimatedGasRaw: '0', slippageBps: 100, priceImpactPct: 1.03, rate: 0.3269, expiresAt: Date.now() + 45_000,
            isCrossChain: false, bridgeTool: 'SundaeSwap V3', estimatedDurationSec: 60, feeBps: 0,
            appFee: { policyVersion: 'x', provider: 'minswap', requestedBps: 0, appliedBps: 0, base: 'input', chain: 'cardano',
              tokenAddress: null, tokenSymbol: null, tokenDecimals: null, amountRaw: '0', recipient: null, recipientKind: 'none',
              collection: 'in-swap', providerSharePct: null, verification: 'none-requested', evidence: [] },
            externalFees: [
              { name: 'SundaeSwap protocol fee (maximum)', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: '1280000', includedInQuotedOutput: false },
              { name: 'Minswap aggregator fee', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: '850000', includedInQuotedOutput: false },
            ],
            txData: { cbor: '84a0a0f5f6' }, approvalTx: null, intentId: 'stub',
            cardanoOrder: { protocol: 'SundaeSwapV3', path: ['lovelace', MIN], batcherFeeLovelace: '1280000', depositLovelace: '2000000',
              aggregatorFeeLovelace: '850000', poolIdent: 'cacb7fd5f5b84bf876d40dc60d4991c72112d78d76132b1fb769e6ad' },
            cardanoCost: { txFeeLovelace: '207829', batcherFeeLovelace: '1280000', depositLovelace: '2000000', aggregatorFeeLovelace: '850000',
              adaSpentLovelace: '14337829', validUntilSlot: '201682507', orderMinimumRaw: '3236000', killable: null },
          },
        })
      }, { MIN })

      await pickNetwork(page, 'From network', 'cardano')
      await pickNetwork(page, 'To network', 'cardano')
      await page.getByPlaceholder('0.0').first().fill('10')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      const terms = page.getByText("This places a SundaeSwap order through Minswap's aggregator.")
      await expect(terms).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('not refunded automatically')).toBeVisible()
      await expect(page.getByText('This places a Minswap order.')).toHaveCount(0)
      await expect(page.getByText('Deposit (returned)')).toBeVisible()
      await terms.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/sundae-quote.png', fullPage: true })
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Swap history', () => {
  test('lists a multi-step swap once (its steps folded in) and a single swap, newest first', async () => {
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
      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown> }
        const hop = (o: Record<string, unknown>) => ({ fromDecimals: 6, toDecimals: 6, state: 'completed', provider: null, via: null, txHash: 'ab'.repeat(32), sellRaw: null, measuredOutRaw: null, message: null, intentId: null, ...o })
        w.wallet.swapChainList = async () => ({ ok: true, value: [{ id: 'chain-1', createdAt: 2_000, state: 'completed', reason: null, finalMinRaw: '13060835', finalExpectedRaw: '13393448', hops: [
          hop({ kind: 'cardano-dex', fromChain: 'cardano', toChain: 'cardano', fromSymbol: 'SNEK', toSymbol: 'ADA', fromDecimals: 0, plannedSellRaw: '1318', sellRaw: '1318', measuredOutRaw: '3949926', provider: 'minswap', via: 'SundaeSwap V3', intentId: 'step-1', approvedMinOutRaw: '1' }),
          hop({ kind: 'near-intents', fromChain: 'cardano', toChain: 'solana', fromSymbol: 'ADA', toSymbol: 'SOL', toDecimals: 9, plannedSellRaw: '1', measuredOutRaw: '7691162', provider: 'near-intents', via: 'near-intents', intentId: 'step-2', approvedMinOutRaw: '1' }),
          hop({ kind: 'dest-dex', fromChain: 'solana', toChain: 'solana', fromSymbol: 'SOL', toSymbol: 'TROLL', fromDecimals: 9, plannedSellRaw: '1', measuredOutRaw: '14661171', provider: 'jupiter', txHash: 'sig', intentId: 'step-3', approvedMinOutRaw: '1' }),
        ] }] })
        const session = (id: string, createdAt: number, o: Record<string, unknown> = {}) => ({ id, createdAt, provider: 'minswap', fromChain: 'cardano', toChain: 'cardano',
          fromTokenSymbol: 'ADA', fromTokenDecimals: 6, toTokenSymbol: 'SNEK', toTokenDecimals: 0, sellAmountRaw: '10000000', expectedBuyAmountRaw: '3269',
          deliveredAmountRaw: '3260', deliveredTokenSymbol: 'SNEK', deliveredTokenDecimals: 0, state: 'completed', bridgeTool: 'SundaeSwap V3', sourceTxHash: 'cd'.repeat(32),
          sourceExplorerUrl: 'https://cardanoscan.io/transaction/' + 'cd'.repeat(32), destExplorerUrl: null, ...o })
        w.wallet.swapSessions = async () => [session('step-1', 2_001), session('step-2', 2_002), session('single', 3_000)]
      })
      await page.getByRole('button', { name: 'Recent swaps' }).click()
      const list = page.getByTestId('swap-history-list')
      await expect(list).toBeVisible()
      await expect(list.locator(':scope > div')).toHaveCount(2)
      await expect(list.locator(':scope > div').first()).toContainText('10 ADA → 3,260 SNEK')
      await expect(list).toContainText('1,318 SNEK → 14.661171 TROLL')
      await expect(list).toContainText('SNEK → ADA · SundaeSwap V3')
      await expect(list).toContainText('ADA → SOL · NEAR Intents')
      await expect(list).toContainText('SOL → TROLL · Jupiter')
      await page.screenshot({ path: 'test-results/swap-history.png', fullPage: true })
      await page.getByRole('dialog', { name: 'Swap history' }).getByRole('button', { name: 'Close' }).click()
      await expect(list).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('Into Cardano (NEAR Intents)', () => {
  test('Base USDC -> ADA is one swap whose disclosure names a Base deposit and a Base refund; SOL -> a Cardano token is multi-step', async () => {
    test.setTimeout(150_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })

      await page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __req: unknown[]; __chain: unknown[] }
        w.__req = []; w.__chain = []
        w.wallet.getBalances = async () => ({ chains: { base: { native: '0.01' }, solana: { native: '1' }, cardano: { native: '5' } } })
        w.wallet.getTokens = async () => ({ tokens: [] })
        w.wallet.swapGetTokens = async () => ({ tokens: [], error: null })
        w.wallet.swapReconcile = async () => []
        w.wallet.swapChainList = async () => ({ ok: true, value: [] })
        w.wallet.swapGetQuote = async (req: { fromChain: string; toChain: string; taker: string; toAddress: string; fromToken: string }) => {
          w.__req.push(req)
          return { error: null, quote: {
            provider: 'near-intents', fromChain: req.fromChain, toChain: 'cardano', fromTokenAddress: req.fromToken, toTokenAddress: 'lovelace',
            fromTokenSymbol: 'USDC', toTokenSymbol: 'ADA', sellAmountRaw: '5000000', buyAmountRaw: '24674970', minBuyAmountRaw: '24440301',
            minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 100, priceImpactPct: 0, rate: 4.93, expiresAt: Date.now() + 60_000,
            isCrossChain: true, toAddress: req.toAddress, bridgeTool: 'near-intents', estimatedDurationSec: 37,
            appFee: { policyVersion: 'x', provider: 'near-intents', requestedBps: 0, appliedBps: 0, base: 'input', chain: 'base',
              tokenAddress: null, tokenSymbol: null, tokenDecimals: null, amountRaw: '0', recipient: null, recipientKind: 'none',
              collection: 'in-swap', providerSharePct: null, verification: 'none-requested', evidence: [] },
            externalFees: [], requestId: null, txData: {}, intentId: 'stub',
            nearIntents: { originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', destinationAsset: 'nep141:cardano.omft.near',
              slippageBps: 100, refundTo: req.taker, recipient: req.toAddress, refundFeeLovelace: '100000' },
          } }
        }
        w.wallet.swapChainQuote = async (req: unknown) => {
          w.__chain.push(req)
          return { ok: true, value: { planId: 'p', finalMinRaw: '8275000', finalExpectedRaw: '8400000', expiresAt: Date.now() + 60_000,
            hops: [
              { kind: 'near-intents', fromChain: 'solana', toChain: 'cardano', fromSymbol: 'SOL', toSymbol: 'ADA', fromDecimals: 9, toDecimals: 6,
                approvedMinOutRaw: '14630908', plannedSellRaw: '30000000', state: 'pending', provider: null, txHash: null, sellRaw: null, measuredOutRaw: null, message: null },
              { kind: 'cardano-dex', fromChain: 'cardano', toChain: 'cardano', fromSymbol: 'ADA', toSymbol: 'MIN', fromDecimals: 6, toDecimals: 6,
                approvedMinOutRaw: '8275000', plannedSellRaw: '10330908', state: 'pending', provider: null, txHash: null, sellRaw: null, measuredOutRaw: null, message: null },
            ], routes: [
              { kind: 'near-intents', provider: 'near-intents', fromSymbol: 'SOL', toSymbol: 'ADA', minOutRaw: '14630908', chain: 'cardano' },
              { kind: 'cardano-dex', provider: 'minswap', fromSymbol: 'ADA', toSymbol: 'MIN', minOutRaw: '8275000', chain: 'cardano' },
            ] } }
        }
      })

      // ── Base USDC -> ADA: a single NEAR swap ────────────────────────────────
      await pickNetwork(page, 'From network', 'base')
      await page.getByRole('button', { name: 'Pay token' }).click()
      await page.getByRole('option').filter({ hasText: 'USD Coin' }).first().click()
      await pickNetwork(page, 'To network', 'cardano')
      await page.getByRole('button', { name: 'Receive token' }).click()
      await page.getByRole('option').filter({ hasText: 'Cardano' }).first().click()
      await expect(page.getByText('On-chain bridging between Cardano')).toHaveCount(0)
      await page.getByPlaceholder('0.0').first().fill('5')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      const terms = page.getByTestId('near-intents-terms')
      await expect(terms).toBeVisible({ timeout: 10_000 })
      await expect(terms).toContainText('one-time NEAR Intents deposit address on Base')
      await expect(terms).toContainText('returned to your Base address')
      await expect(terms).toContainText('minus a 0.1 USDC refund fee')
      await terms.scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/into-cardano-quote.png', fullPage: true })
      const sent = await page.evaluate(() => (window as unknown as { __req: Array<Record<string, unknown>> }).__req)
      expect(sent[sent.length - 1]).toMatchObject({ fromChain: 'base', toChain: 'cardano', toToken: 'lovelace' })

      // ── SOL -> a Cardano token: multi-step ──────────────────────────────────
      await pickNetwork(page, 'From network', 'solana')
      await pickNetwork(page, 'To network', 'cardano')
      await page.getByRole('button', { name: 'Receive token' }).click()
      await page.getByRole('option').filter({ hasText: 'Minswap' }).first().click()
      await page.getByPlaceholder('0.0').first().fill('0.03')
      await page.getByRole('button', { name: 'Get Quote' }).click()
      const plan = page.getByTestId('chained-swap-quote')
      await expect(plan).toBeVisible({ timeout: 10_000 })
      await expect(plan).toContainText('SOL → ADA · NEAR Intents')
      await expect(plan).toContainText('ADA → MIN · Cardano DEX (best route)')
      const chain = await page.evaluate(() => (window as unknown as { __chain: Array<Record<string, unknown>> }).__chain)
      expect(chain[chain.length - 1]).toMatchObject({ fromChain: 'solana', toChain: 'cardano', sellAmountRaw: '30000000' })
    } finally {
      await ctx.close()
    }
  })
})
