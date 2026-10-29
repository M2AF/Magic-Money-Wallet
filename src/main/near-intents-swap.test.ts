/**
 * The NEAR Intents route in the swap pipeline: the dry quote as the screen sees
 * it (from the REAL recorded 1Click responses), and status with the destination
 * credit measured on chain. Nothing reaches a network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const delivery = vi.hoisted(() => ({ measureDelivery: vi.fn() }))
vi.mock('./swap-delivery', async (orig) => ({ ...(await orig<typeof import('./swap-delivery')>()), measureDelivery: delivery.measureDelivery }))

import { quoteNearIntentsFromCardano, nearIntentsSwapStatus } from './near-intents-swap'
import { __clearOneClickTokenCache } from './near-intents-client'
import { unsignableReason } from '../shared/swap-candidates'
import { validateSwapQuoteForExecution } from '../shared/swap-execution-checks'
import type { WalletConfig } from './secure-store'

const FIX = join(__dirname, '__fixtures__', 'near-intents')
const rec = JSON.parse(readFileSync(join(FIX, 'ada-sol-quotes.json'), 'utf8'))
const tokens = JSON.parse(readFileSync(join(FIX, 'tokens-subset.json'), 'utf8')).tokens
const CARDANO = rec.dry.body.quoteRequest.refundTo as string
const SOLANA = rec.dry.body.quoteRequest.recipient as string
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const now = Date.parse(rec.recordedAt)
const cfg = {} as WalletConfig

const fetchFn = vi.fn(async (url: string) => {
  if (url.endsWith('/v0/tokens')) return new Response(JSON.stringify(tokens), { status: 200 })
  if (url.endsWith('/v0/quote')) return new Response(JSON.stringify(rec.dry.body), { status: 201 })
  return new Response('{}', { status: 404 })
})
const req = { toChain: 'solana', toToken: SOL_MINT, toDecimals: 9, toSymbol: 'SOL', sellAmountRaw: '25000000', slippageBps: 100, taker: CARDANO, toAddress: SOLANA }

beforeEach(() => { __clearOneClickTokenCache(); fetchFn.mockClear(); delivery.measureDelivery.mockReset() })

describe('quoteNearIntentsFromCardano', () => {
  it('normalizes a real dry quote into a signable, fee-free cross-chain quote with no transaction', async () => {
    const q = await quoteNearIntentsFromCardano(req, { fetchFn, now })
    expect(q).toMatchObject({
      provider: 'near-intents', fromChain: 'cardano', toChain: 'solana', fromTokenAddress: 'lovelace', toTokenAddress: SOL_MINT,
      sellAmountRaw: '25000000', buyAmountRaw: rec.dry.body.quote.amountOut, minBuyAmountRaw: rec.dry.body.quote.minAmountOut,
      minReceivedSource: 'provider', isCrossChain: true, toAddress: SOLANA, txData: {},
      appFee: { requestedBps: 0, provider: 'near-intents' },
      nearIntents: { destinationAsset: 'nep141:sol.omft.near', refundTo: CARDANO, recipient: SOLANA, slippageBps: 100 },
    })
    expect(unsignableReason(q)).toBeNull()
    expect(() => validateSwapQuoteForExecution(q, now, () => false)).not.toThrow()
  })

  it('refuses a destination token NEAR Intents does not list, and a tampered quote', async () => {
    await expect(quoteNearIntentsFromCardano({ ...req, toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1w', toDecimals: 6 }, { fetchFn, now }))
      .rejects.toThrow(/does not offer/)
    const tampered = structuredClone(rec.dry.body); tampered.quote.minAmountOut = '1'
    const bad = vi.fn(async (url: string) => url.endsWith('/v0/tokens')
      ? new Response(JSON.stringify(tokens), { status: 200 }) : new Response(JSON.stringify(tampered), { status: 201 }))
    __clearOneClickTokenCache()
    await expect(quoteNearIntentsFromCardano(req, { fetchFn: bad, now })).rejects.toThrow(/signature/)
  })
})

describe('nearIntentsSwapStatus', () => {
  const status = (body: Record<string, unknown>) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  const base = { requestId: 'addr1vdeposit', toChain: 'solana', expectedToTokenAddress: SOL_MINT, recipient: SOLANA, minBuyAmountRaw: '1000' }

  it('SUCCESS counts only once the credit is measured on the destination chain', async () => {
    const body = { status: 'SUCCESS', swapDetails: { amountOut: '5000', destinationChainTxHashes: [{ hash: 'solsig', explorerUrl: 'x' }] } }
    delivery.measureDelivery.mockResolvedValueOnce({ amountRaw: '4990', source: 'onchain' })
    const done = await nearIntentsSwapStatus(base, cfg, status(body))
    expect(done).toMatchObject({ state: 'completed', deliveredAmountSource: 'onchain', delivered: { amountRaw: '4990' }, destTxHash: 'solsig' })

    delivery.measureDelivery.mockResolvedValueOnce(null)
    const waiting = await nearIntentsSwapStatus(base, cfg, status(body))
    expect(waiting).toMatchObject({ state: 'bridging', providerStatus: 'PROCESSING' })
  })

  it('a measured credit below the approved minimum is not a success', async () => {
    const body = { status: 'SUCCESS', swapDetails: { amountOut: '5000', destinationChainTxHashes: [{ hash: 'solsig', explorerUrl: 'x' }] } }
    delivery.measureDelivery.mockResolvedValueOnce({ amountRaw: '999', source: 'onchain' })
    const r = await nearIntentsSwapStatus(base, cfg, status(body))
    expect(r.state).not.toBe('completed')
  })

  it('maps refunds, failures, short deposits, pending and unknown statuses', async () => {
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'REFUNDED', swapDetails: { refundedAmount: '24800000' } }))).state).toBe('refunded')
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'FAILED', swapDetails: {} }))).state).toBe('failed')
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'INCOMPLETE_DEPOSIT', swapDetails: {} }))).state).toBe('refund-pending')
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'PENDING_DEPOSIT', swapDetails: {} }))).state).toBe('source-submitted')
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'PROCESSING', swapDetails: {} }))).state).toBe('bridging')
    expect((await nearIntentsSwapStatus(base, cfg, status({ status: 'SOMETHING_NEW', swapDetails: {} }))).state).toBe('unknown')
    expect(delivery.measureDelivery).not.toHaveBeenCalled()
  })

  it('without a recorded deposit address the status is unknown, never guessed', async () => {
    expect((await nearIntentsSwapStatus({ ...base, requestId: null }, cfg)).state).toBe('unknown')
  })

  it('a status read failure keeps polling', async () => {
    const r = await nearIntentsSwapStatus(base, cfg, vi.fn(async () => new Response('', { status: 503 })))
    expect(r.state).toBe('bridging')
  })
})
