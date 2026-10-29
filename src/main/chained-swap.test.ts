/**
 * Multi-hop swaps (SNEK on Cardano -> BONK on Solana and friends). Every
 * network edge is a fake; what is tested is the plan, the per-hop minimums,
 * and the state machine that runs each hop exactly once.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  planChainedSwap, createChainedSwap, advanceChainedSwap, chainedSwapStore, ChainedSwapLocked, NATIVE,
  type ChainedSwapDeps, type ChainHop,
} from './chained-swap'
import type { NormalizedSwapQuote, SwapQuoteRequest } from './swap-proxy'

const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const SOL = NATIVE.solana

/** Deterministic fake prices: out = in * rate, min = 99% of out. */
const MEME = '0x532f27101965dd16442e59d40670faf5ebb142e4'
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const RATES: Record<string, number> = {
  [`${SNEK}>lovelace`]: 2, [`lovelace>${SOL}`]: 2, [`${SOL}>${BONK}`]: 50, [`lovelace>${BONK}`]: NaN,
  // Into Cardano: a Base memecoin -> USDC -> ADA -> SNEK; BONK -> SOL -> ADA.
  [`${MEME}>${BASE_USDC}`]: 0.001, [`${BASE_USDC}>lovelace`]: 4, [`lovelace>${SNEK}`]: 0.25,
  [`${BONK}>${SOL}`]: 0.02, [`${SOL}>lovelace`]: 0.5,
}
function fakeQuote(req: SwapQuoteRequest, scale = 1): NormalizedSwapQuote | null {
  const rate = RATES[`${req.fromToken}>${req.toToken}`]
  if (!rate || Number.isNaN(rate)) return null
  const out = BigInt(Math.floor(Number(req.sellAmountRaw) * rate * scale))
  return {
    provider: req.fromChain === 'cardano' && req.toChain === 'cardano' ? 'minswap' : req.fromChain === 'cardano' ? 'near-intents' : 'jupiter',
    fromChain: req.fromChain, toChain: req.toChain, fromTokenAddress: req.fromToken, toTokenAddress: req.toToken,
    fromTokenSymbol: req.fromSymbol, toTokenSymbol: req.toSymbol, sellAmountRaw: req.sellAmountRaw,
    buyAmountRaw: out.toString(), minBuyAmountRaw: (out * 99n / 100n).toString(), estimatedGasRaw: '0', slippageBps: 100,
    priceImpactPct: 0, rate, expiresAt: Date.now() + 60_000, txData: {},
  } as NormalizedSwapQuote
}

function harness(over: Partial<ChainedSwapDeps> & { scale?: () => number } = {}) {
  let map: Record<string, string> = {}
  const store = chainedSwapStore(async () => ({ ...map }), async (m) => { map = { ...m } })
  const sent = new Map<string, { txHash: string; requestId: string | null }>()
  const delivered = new Map<string, string>()   // txHash -> measured output
  let n = 0
  const deps: ChainedSwapDeps = {
    quote: vi.fn(async (req: SwapQuoteRequest) => { const q = fakeQuote(req, over.scale?.() ?? 1); return q ? { quote: q, error: null } : { quote: null, error: 'no route' } }),
    addresses: { cardano: 'addr1ours', solana: 'SoLoursxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', evm: '0x' + '1'.repeat(40) },
    feeReserve: vi.fn(async () => 10_000_000n),
    // As the real bindSwapIntent: a quote is only bound to the request it answers.
    bind: vi.fn((r: SwapQuoteRequest, q: NormalizedSwapQuote) => {
      if (r.sellAmountRaw !== q.sellAmountRaw || r.fromToken !== q.fromTokenAddress || r.toToken !== q.toTokenAddress) {
        throw new Error('Quote does not match the request (sell amount)')
      }
      return `intent-${++n}`
    }),
    execute: vi.fn(async (intentId: string, quote: NormalizedSwapQuote) => {
      const txHash = `tx-${intentId}`
      sent.set(intentId, { txHash, requestId: null })
      delivered.set(txHash, quote.buyAmountRaw)
      return { txHash }
    }),
    status: vi.fn(async (hop: ChainHop) => ({ state: 'completed', deliveredRaw: delivered.get(hop.txHash as string) ?? null, message: null })),
    // Planning-only Cardano estimate: the same fake prices, and a fixed 4 ADA order overhead.
    estimateCardano: vi.fn(async (r: SwapQuoteRequest) => {
      const q = fakeQuote(r)
      if (!q) throw new Error('no route')
      return { buyAmountRaw: q.buyAmountRaw, minBuyAmountRaw: q.minBuyAmountRaw as string, overheadLovelace: '4000000', provider: 'minswap' }
    }),
    sentFor: vi.fn(async (id: string) => sent.get(id) ?? null),
    store, now: () => 1, newId: () => 'chain-1',
    ...over,
  }
  return { deps, store, sent, map: () => map }
}

const req = (over = {}) => ({ fromToken: SNEK, fromSymbol: 'SNEK', fromDecimals: 0, toChain: 'solana', toToken: BONK, toSymbol: 'BONK', toDecimals: 5, sellAmountRaw: '10000000', slippageBps: 100, ...over })
const id = { walletId: 'w', accountIndex: 0 }

async function runToEnd(deps: ChainedSwapDeps, swapId: string, max = 12) {
  let c
  for (let k = 0; k < max; k++) {
    c = await advanceChainedSwap(swapId, deps)
    if (c.state !== 'running') break
  }
  return c!
}

describe('planChainedSwap', () => {
  it('SNEK -> BONK: three hops, each quoted on the previous hop\'s MINIMUM, the last keeping a fee reserve', async () => {
    const { deps } = harness()
    const p = await planChainedSwap(req(), deps)
    expect(p.hops.map(h => h.kind)).toEqual(['cardano-dex', 'near-intents', 'dest-dex'])
    const [a, b, c] = p.hops
    expect(b.plannedSellRaw).toBe(a.approvedMinOutRaw)
    expect(BigInt(c.plannedSellRaw)).toBe(BigInt(b.approvedMinOutRaw) - 10_000_000n)
    expect(p.finalMinRaw).toBe(c.approvedMinOutRaw)
    expect(p.routes.map(r => r.provider)).toEqual(['minswap', 'near-intents', 'jupiter'])
  })

  it('ADA -> BONK skips the Cardano hop; a token NEAR delivers directly skips the last hop', async () => {
    const { deps } = harness()
    expect((await planChainedSwap(req({ fromToken: 'lovelace', fromSymbol: 'ADA', fromDecimals: 6 }), deps)).hops.map(h => h.kind)).toEqual(['near-intents', 'dest-dex'])
    expect((await planChainedSwap(req({ toToken: SOL, toSymbol: 'SOL', toDecimals: 9 }), deps)).hops.map(h => h.kind)).toEqual(['cardano-dex', 'near-intents'])
  })

  it('refuses an amount too small to cover the destination network fee, and swaps into Cardano', async () => {
    const { deps } = harness({ feeReserve: vi.fn(async () => 10n ** 15n) })
    await expect(planChainedSwap(req(), deps)).rejects.toThrow(/too small/)
    await expect(planChainedSwap(req({ toChain: 'cardano' }), deps)).rejects.toThrow(/leaves Cardano/)
  })
})

describe('advanceChainedSwap — one approval, every hop run once', () => {
  it('runs all hops, each selling what was MEASURED, then completes', async () => {
    const { deps } = harness()
    const plan = await planChainedSwap(req(), deps)
    const c = await createChainedSwap(plan, id, deps)
    const done = await runToEnd(deps, c.id)
    expect(done.state).toBe('completed')
    expect(deps.execute).toHaveBeenCalledTimes(3)
    // Hop 2 sold hop 1's measured output, not the planned estimate.
    expect(done.hops[1].sellRaw).toBe(done.hops[0].measuredOutRaw)
    expect(BigInt(done.hops[2].sellRaw!)).toBe(BigInt(done.hops[1].measuredOutRaw!) - 10_000_000n)
  })

  it('saves the intent BEFORE executing a hop', async () => {
    const h = harness()
    let stored: string | undefined
    h.deps.execute = vi.fn(async (intentId: string) => {
      stored = JSON.parse(h.map()['chain-1']).hops[0].intentId
      return { txHash: `tx-${intentId}` }
    })
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    await advanceChainedSwap(c.id, h.deps)
    expect(stored).toBe('intent-1')
  })

  it('pauses when a fresh quote guarantees less than approved; continues only on explicit acceptance', async () => {
    let scale = 1
    const { deps } = harness({ scale: () => scale })
    const c = await createChainedSwap(await planChainedSwap(req(), deps), id, deps)
    await advanceChainedSwap(c.id, deps)              // hop 1 sent
    await advanceChainedSwap(c.id, deps)              // hop 1 completed
    scale = 0.5                                        // the price halves
    const paused = await advanceChainedSwap(c.id, deps)
    expect(paused.state).toBe('paused')
    expect(paused.reason).toMatch(/price moved.*Your funds are ADA on cardano/)
    expect(deps.execute).toHaveBeenCalledTimes(1)
    expect((await advanceChainedSwap(c.id, deps)).state).toBe('paused')   // a poll alone never continues
    const resumed = await advanceChainedSwap(c.id, deps, { acceptNewMinimum: true })
    expect(resumed.hops[1].state).toBe('submitted')
    expect(deps.execute).toHaveBeenCalledTimes(2)
  })

  it('a locked wallet pauses the swap; it continues once unlocked', async () => {
    let locked = true
    const h = harness()
    const inner = h.deps.execute
    h.deps.execute = vi.fn(async (i: string, q: NormalizedSwapQuote) => { if (locked) throw new ChainedSwapLocked(); return inner(i, q) })
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    const p = await advanceChainedSwap(c.id, h.deps)
    expect(p).toMatchObject({ state: 'paused', reason: 'Unlock the wallet to continue this swap.' })
    expect(p.hops[0].state).toBe('pending')
    locked = false
    expect((await advanceChainedSwap(c.id, h.deps)).hops[0].state).toBe('submitted')
  })

  it('after a crash mid-execution, a hop that WAS sent is followed, not sent again', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    const crashed = { ...c, hops: c.hops.map((x, k) => k === 0 ? { ...x, state: 'executing' as const, intentId: 'intent-9' } : x) }
    await h.store.put(crashed)
    h.sent.set('intent-9', { txHash: 'tx-intent-9', requestId: null })
    const r = await advanceChainedSwap(c.id, h.deps)
    expect(r.hops[0]).toMatchObject({ state: 'submitted', txHash: 'tx-intent-9' })
    expect(h.deps.execute).not.toHaveBeenCalled()
  })

  it('after a crash mid-execution, a hop that was NOT sent is quoted again (and only then executed)', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    await h.store.put({ ...c, hops: c.hops.map((x, k) => k === 0 ? { ...x, state: 'executing' as const, intentId: 'intent-9' } : x) })
    const r1 = await advanceChainedSwap(c.id, h.deps)
    expect(r1.hops[0]).toMatchObject({ state: 'pending', intentId: null })
    expect(h.deps.execute).not.toHaveBeenCalled()
    expect((await advanceChainedSwap(c.id, h.deps)).hops[0].state).toBe('submitted')
    expect(h.deps.execute).toHaveBeenCalledTimes(1)
  })

  it('an execution error after the hop was recorded as sent is followed, never resent', async () => {
    const h = harness()
    h.deps.execute = vi.fn(async (intentId: string) => { h.sent.set(intentId, { txHash: `tx-${intentId}`, requestId: null }); throw new Error('submit timed out') })
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    const r = await advanceChainedSwap(c.id, h.deps)
    expect(r.hops[0]).toMatchObject({ state: 'submitted', txHash: 'tx-intent-1' })
    await advanceChainedSwap(c.id, h.deps)
    expect(h.deps.execute).toHaveBeenCalledTimes(1)
  })

  it('an execution error whose swap record cannot be read stops for review, never resends', async () => {
    const h = harness()
    h.deps.execute = vi.fn(async () => { throw new Error('submit timed out') })
    h.deps.sentFor = vi.fn(async () => { throw new Error('storage unavailable') })
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    const r = await advanceChainedSwap(c.id, h.deps)
    expect(r.state).toBe('needs-review')
    expect(r.reason).toMatch(/not sent again/)
    await advanceChainedSwap(c.id, h.deps)
    expect(h.deps.execute).toHaveBeenCalledTimes(1)
  })

  it('a step that could not be quoted pauses, and is quoted again on the next poll (not left paused)', async () => {
    let down = false
    const h = harness()
    const real = h.deps.quote
    h.deps.quote = vi.fn(async (r: SwapQuoteRequest) => (down && r.fromChain === 'cardano' && r.toChain === 'solana'
      ? { quote: null, error: 'no route' } : real(r)))
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    down = true
    await advanceChainedSwap(c.id, h.deps)            // hop 1 sent
    let r = await advanceChainedSwap(c.id, h.deps)    // hop 1 measured
    r = await advanceChainedSwap(c.id, h.deps)        // hop 2: quote fails
    expect(r.state).toBe('paused')
    expect(r.reason).toMatch(/retried automatically/)
    down = false
    r = await advanceChainedSwap(c.id, h.deps)
    expect(r.hops[1].state).toBe('submitted')
  })

  it('a bind that refuses the quote pauses with the reason saved, and nothing is executed', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    h.deps.bind = vi.fn(() => { throw new Error('Quote does not match the request (sell amount)') })
    const r = await advanceChainedSwap(c.id, h.deps)
    expect(r.state).toBe('paused')
    expect(r.reason).toMatch(/could not be prepared \(Quote does not match/)
    expect(h.deps.execute).not.toHaveBeenCalled()
    expect(JSON.parse(h.map()[c.id]).state).toBe('paused')   // persisted, not only shown
  })

  describe('into Cardano', () => {
    const into = (over = {}) => ({ fromChain: 'base', fromToken: MEME, fromSymbol: 'MEME', fromDecimals: 18, toChain: 'cardano',
      toToken: SNEK, toSymbol: 'SNEK', toDecimals: 0, sellAmountRaw: '10000000000', slippageBps: 100, ...over })

    it('memecoin on Base -> SNEK: src-dex to USDC, NEAR to ADA, then a Cardano order that keeps its fees and deposit back', async () => {
      const h = harness()
      const plan = await planChainedSwap(into(), h.deps)
      expect(plan.hops.map(x => x.kind)).toEqual(['src-dex', 'near-intents', 'cardano-dex'])
      const [src, near, dex] = plan.hops
      expect(src).toMatchObject({ fromChain: 'base', toToken: BASE_USDC, approvedMinOutRaw: '9900000' })
      // USDC is not the native coin: NEAR sells the whole minimum, no reserve.
      expect(near).toMatchObject({ fromChain: 'base', toChain: 'cardano', plannedSellRaw: '9900000', approvedMinOutRaw: '39204000' })
      // 39.204 ADA minimum, less the 4 ADA order overhead and the 0.3 ADA margin.
      expect(dex.plannedSellRaw).toBe((39_204_000n - 4_000_000n - 300_000n).toString())
      expect(h.deps.estimateCardano).toHaveBeenCalled()
    })

    it('runs to the end; the Cardano step sells what ARRIVED less the reserve read from its own quote', async () => {
      const h = harness()
      h.deps.feeReserve = vi.fn(async (chain: string) => (chain === 'cardano' ? 4_500_000n : 10_000n))
      const c = await createChainedSwap(await planChainedSwap(into(), h.deps), id, h.deps)
      const done = await runToEnd(h.deps, c.id)
      expect(done.state).toBe('completed')
      const [, near, dex] = done.hops
      expect(dex.sellRaw).toBe((BigInt(near.measuredOutRaw as string) - 4_500_000n).toString())
      expect(h.deps.feeReserve).toHaveBeenCalledWith('cardano', expect.anything())
      expect(h.deps.execute).toHaveBeenCalledTimes(3)
    })

    it('BONK on Solana -> ADA: the NEAR step sells SOL, so it keeps the deposit fee back', async () => {
      const h = harness()
      const plan = await planChainedSwap(into({ fromChain: 'solana', fromToken: BONK, fromSymbol: 'BONK', fromDecimals: 5, toToken: 'lovelace', toSymbol: 'ADA', toDecimals: 6 }), h.deps)
      expect(plan.hops.map(x => x.kind)).toEqual(['src-dex', 'near-intents'])
      expect(plan.hops[1].plannedSellRaw).toBe((BigInt(plan.hops[0].approvedMinOutRaw) - 10_000_000n).toString())
    })

    it('refuses a chain with no bridge asset for tokens, and an amount too small for the Cardano order', async () => {
      const h = harness()
      await expect(planChainedSwap(into({ fromChain: 'robinhood' }), h.deps)).rejects.toThrow(/only ETH can be swapped into Cardano/)
      await expect(planChainedSwap(into({ sellAmountRaw: '1000000000' }), h.deps)).rejects.toThrow(/too small to cover the Cardano order/)
    })
  })

  it('a refunded hop stops the swap and says where the funds are', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    await advanceChainedSwap(c.id, h.deps); await advanceChainedSwap(c.id, h.deps)   // hop 1 done
    await advanceChainedSwap(c.id, h.deps)                                            // hop 2 sent
    h.deps.status = vi.fn(async () => ({ state: 'refunded', deliveredRaw: null, message: 'ADA returned.' }))
    const r = await advanceChainedSwap(c.id, h.deps)
    expect(r.state).toBe('stopped')
    expect(r.reason).toMatch(/Step 2 was refunded. Your funds are ADA on cardano/)
  })

  it('stop: allowed before a hop is sent, never abandons a sent hop', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    await advanceChainedSwap(c.id, h.deps)                                            // hop 1 sent
    expect((await advanceChainedSwap(c.id, h.deps, { stop: true })).state).toBe('running')
    await advanceChainedSwap(c.id, h.deps)                                            // hop 1 done
    const s = await advanceChainedSwap(c.id, h.deps, { stop: true })
    expect(s.state).toBe('stopped')
    expect(s.reason).toMatch(/Your funds are ADA on cardano/)
  })

  it('concurrent polls share one run: a hop is executed once', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    await Promise.all([advanceChainedSwap(c.id, h.deps), advanceChainedSwap(c.id, h.deps), advanceChainedSwap(c.id, h.deps)])
    expect(h.deps.execute).toHaveBeenCalledTimes(1)
  })
})

describe('chainedSwapStore', () => {
  it('never replaces a recorded hop transaction, and never reopens a finished swap', async () => {
    const h = harness()
    const c = await createChainedSwap(await planChainedSwap(req(), h.deps), id, h.deps)
    const sent = await advanceChainedSwap(c.id, h.deps)
    await expect(h.store.put({ ...sent, hops: sent.hops.map((x, k) => k === 0 ? { ...x, txHash: 'other' } : x) })).rejects.toThrow(/never replaced/)
    const done = await runToEnd(h.deps, c.id)
    await expect(h.store.put({ ...done, state: 'running' })).rejects.toThrow(/cannot be reopened/)
  })
})
