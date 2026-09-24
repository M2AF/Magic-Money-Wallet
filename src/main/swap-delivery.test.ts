/**
 * Measured delivery, and the status/minimum logic that now runs on it.
 *
 * Recorded 2026-09-22 (read-only): destination tx 2uiseb…WQEZF for 55 MON -> SOL
 * is ONE system transfer of 12026493 lamports from a Relay solver
 * (F7p3…gmNe, which also paid the 8135-lamport fee) to the recipient. LI.FI's
 * status said 11717316 — its quoted toAmount 12017756 x (1 - 2.5%), not a
 * measurement. The second swap matched the same formula to within 1 lamport.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { solanaCredit, type ParsedSolanaTxLike } from './swap-delivery'

const ME = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'
const SOLVER = 'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe'
const WSOL = 'So11111111111111111111111111111111111111112'
const SYSTEM = '11111111111111111111111111111111'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** The recorded destination transaction, reduced to what is read. */
const recorded: ParsedSolanaTxLike = {
  meta: {
    err: null, fee: 8135,
    preBalances: [100000000, 23390230, 1],
    postBalances: [100000000 - 12034628, 23390230 + 12026493, 1],
    preTokenBalances: [], postTokenBalances: [],
  },
  transaction: { message: { accountKeys: [{ pubkey: SOLVER }, { pubkey: ME }, { pubkey: SYSTEM }] } },
}

describe('solanaCredit', () => {
  it('measures the recorded delivery: +12026493 lamports, not LI.FI\'s 11717316', () => {
    expect(solanaCredit(recorded, ME, WSOL)).toBe(12026493n)
    expect(solanaCredit(recorded, ME, SYSTEM)).toBe(12026493n)   // either native spelling
  })

  it('adds the network fee back when the RECIPIENT paid it', () => {
    const selfPaid: ParsedSolanaTxLike = {
      meta: { err: null, fee: 5000, preBalances: [1000000], postBalances: [1000000 + 50000 - 5000] },
      transaction: { message: { accountKeys: [{ pubkey: ME }] } },
    }
    expect(solanaCredit(selfPaid, ME, WSOL)).toBe(50000n)
  })

  it('counts SOL delivered as wrapped SOL in a token account', () => {
    const wrapped: ParsedSolanaTxLike = {
      meta: {
        err: null, fee: 5000, preBalances: [1, 1], postBalances: [1, 1],
        preTokenBalances: [], postTokenBalances: [{ owner: ME, mint: WSOL, uiTokenAmount: { amount: '777' } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: SOLVER }, { pubkey: 'someTokenAccount' }] } },
    }
    expect(solanaCredit(wrapped, ME, WSOL)).toBe(777n)
  })

  it('SPL: the recipient\'s balance change for THAT mint only', () => {
    const spl: ParsedSolanaTxLike = {
      meta: {
        err: null, fee: 5000, preBalances: [1, 1], postBalances: [1, 1],
        preTokenBalances: [{ owner: ME, mint: USDC, uiTokenAmount: { amount: '100' } }],
        postTokenBalances: [
          { owner: ME, mint: USDC, uiTokenAmount: { amount: '600' } },
          { owner: ME, mint: 'OtherMint1111111111111111111111111111111111', uiTokenAmount: { amount: '999' } },
          { owner: SOLVER, mint: USDC, uiTokenAmount: { amount: '5' } },
        ],
      },
      transaction: { message: { accountKeys: [{ pubkey: SOLVER }, { pubkey: 'ata' }] } },
    }
    expect(solanaCredit(spl, ME, USDC)).toBe(500n)
  })

  it('is null — never 0 — for a failed tx or a recipient the tx does not touch', () => {
    expect(solanaCredit({ ...recorded, meta: { ...recorded.meta!, err: { InstructionError: [0, 'x'] } } }, ME, WSOL)).toBeNull()
    expect(solanaCredit(recorded, 'SomeoneElse1111111111111111111111111111111', WSOL)).toBeNull()
    expect(solanaCredit(recorded, ME, USDC)).toBeNull()
  })
})

// ── The status fetch: measured amount replaces the provider's, and the ──────
// ── approved-minimum check runs on the MEASURED amount. ─────────────────────

const measure = vi.hoisted(() => ({ measureDelivery: vi.fn() }))
vi.mock('./swap-delivery', async (orig) => ({ ...(await orig<typeof import('./swap-delivery')>()), ...measure }))

import { getCrossSwapStatus, setSwapFetch } from './swap-proxy'
import type { WalletConfig } from './secure-store'

const CONFIG = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig
/** The Worker's LI.FI status for the reported swap. */
const lifiStatus = (over: Record<string, unknown> = {}) => ({
  status: 'done', providerStatus: 'DONE', providerSubstatus: 'COMPLETED',
  receivedAmountRaw: '11717316', receivedTokenAddress: SYSTEM, receivedTokenSymbol: 'SOL',
  receivedTokenDecimals: 9, receivedTokenChain: '1151111081099710',
  destTxHash: '2uiseb2KmBqfESijNCHH29Kj2oxSEjKsER39KASTaopjKH8DJL4jdaNZK7gHsW2UjaFWpzcMmgBLSimhNL3WQEZF',
  ...over,
})
const request = (over: Record<string, unknown> = {}) => ({
  provider: 'lifi' as const, txHash: '0x4974', fromChain: 'monad', toChain: 'solana',
  bridgeTool: 'relaydepository', expectedToTokenAddress: WSOL,
  recipient: ME, minBuyAmountRaw: '11424383', ...over,
})
const realFetch = globalThis.fetch

describe('getCrossSwapStatus', () => {
  let body: Record<string, unknown> = lifiStatus()
  beforeEach(() => {
    measure.measureDelivery.mockReset()
    body = lifiStatus()
    setSwapFetch(async () => new Response(JSON.stringify(body), { status: 200 }))
  })
  afterAll(() => setSwapFetch((i, init) => realFetch(i, init)))

  it('shows the MEASURED amount, keeps the provider figure alongside, and stays completed', async () => {
    measure.measureDelivery.mockResolvedValue({ amountRaw: '12026493', source: 'onchain' })
    const s = await getCrossSwapStatus(request(), CONFIG)
    expect(s.state).toBe('completed')
    expect(s.delivered?.amountRaw).toBe('12026493')
    expect(s.deliveredAmountSource).toBe('onchain')
    expect(s.providerReportedAmountRaw).toBe('11717316')
    expect(measure.measureDelivery.mock.calls[0][0]).toMatchObject({ toChain: 'solana', recipient: ME, tokenAddress: WSOL })
  })

  it('flags a shortfall the provider figure would have hidden', async () => {
    // Provider says 11717316 (above the 11424383 floor); the chain says less.
    measure.measureDelivery.mockResolvedValue({ amountRaw: '11000000', source: 'onchain' })
    const s = await getCrossSwapStatus(request(), CONFIG)
    expect(s.state).toBe('partial')
    expect(s.message).toMatch(/less than the minimum you approved/)
  })

  it('falls back to the provider figure, labelled as such, when it cannot measure', async () => {
    measure.measureDelivery.mockResolvedValue(null)
    const s = await getCrossSwapStatus(request(), CONFIG)
    expect(s.delivered?.amountRaw).toBe('11717316')
    expect(s.deliveredAmountSource).toBe('provider')
    expect(s.state).toBe('completed')
  })

  it('does not measure a REFUND or a wrong-asset delivery', async () => {
    body = lifiStatus({ providerSubstatus: 'REFUNDED', receivedTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', receivedTokenChain: '143' })
    expect((await getCrossSwapStatus(request(), CONFIG)).state).toBe('refunded')
    body = lifiStatus({ receivedTokenAddress: USDC })
    expect((await getCrossSwapStatus(request(), CONFIG)).state).toBe('partial')
    expect(measure.measureDelivery).not.toHaveBeenCalled()
  })

  it('does not measure without a recipient to measure for', async () => {
    await getCrossSwapStatus(request({ recipient: null }), CONFIG)
    expect(measure.measureDelivery).not.toHaveBeenCalled()
  })
})
