import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// The Worker adapter is plain JS with no type declarations.
// @ts-expect-error -- untyped Worker adapter, exercised directly
import { validateRelaySteps, relayCheckEndpoint, RELAY_CHAIN, relayQuote, relayTightenedTolerance } from '../../cloudflare-worker/swap-relay.js'
import { mapRelayStatus } from '../shared/swap-lifecycle'
import { validateSwapQuoteForExecution } from './swap-executor'

/**
 * The Relay adapter, against RECORDED LIVE data (2026-09-20, read-only, burn
 * address, nothing signed):
 *
 *   quote-emo-pixl.json  the EMO(Monad) -> PIXL(Ethereum) route with our 1% fee
 *   success-*.json       real filled requests
 *   refund-*.json        real refunded requests
 *   failure-*.json       real failed requests
 *
 * The refund fixtures are the important ones. Relay pays a refund on the SOURCE
 * chain while `metadata.currencyOut` still names the token the user ASKED for on
 * the destination chain — so a mapper that reads `currencyOut` reports a refund
 * as a flawless delivery of exactly what was wanted.
 */

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'shared', '__fixtures__', 'relay', name), 'utf8'))

const MONAD = 143
const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'

describe('step validation — only routes this wallet can actually complete', () => {
  it('accepts the recorded EMO -> PIXL route (approve + deposit, source chain only)', () => {
    const q = fx('quote-emo-pixl.json')
    const r = validateRelaySteps(q.steps, MONAD)
    expect(r.ok).toBe(true)
    expect(r.approval?.to).toBeTruthy()
    expect(r.deposit?.to).toBeTruthy()
  })

  it('REFUSES a route with an item on the destination chain', () => {
    // The EMO route being source-only is a property of THAT route, not of Relay.
    const q = fx('quote-emo-pixl.json')
    const moved = JSON.parse(JSON.stringify(q.steps))
    moved[1].items[0].data.chainId = 1
    const r = validateRelaySteps(moved, MONAD)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/requires signing on chain 1/i)
  })

  it('REFUSES a signature step — a different signing path that is not wired', () => {
    const steps = [{ id: 'deposit', kind: 'signature', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }] }]
    expect(validateRelaySteps(steps, MONAD)).toMatchObject({ ok: false })
    expect(validateRelaySteps(steps, MONAD).reason).toMatch(/cannot sign/i)
  })

  it('REFUSES unknown step ids rather than skipping them', () => {
    const steps = [{ id: 'authorize', kind: 'transaction', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }] }]
    expect(validateRelaySteps(steps, MONAD).reason).toMatch(/unsupported 'authorize' step/i)
  })

  it('REFUSES duplicate approvals or deposits', () => {
    const one = { id: 'approve', kind: 'transaction', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }] }
    expect(validateRelaySteps([one, one], MONAD).reason).toMatch(/more than one approval/i)
    const dep = { id: 'deposit', kind: 'transaction', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }] }
    expect(validateRelaySteps([dep, dep], MONAD).reason).toMatch(/more than one deposit/i)
  })

  it('REFUSES a multi-transaction step and a step missing calldata', () => {
    const multi = [{ id: 'deposit', kind: 'transaction', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }, { data: { chainId: MONAD, to: '0x3', data: '0x4' } }] }]
    expect(validateRelaySteps(multi, MONAD).reason).toMatch(/only single-transaction steps/i)
    const bare = [{ id: 'deposit', kind: 'transaction', items: [{ data: { chainId: MONAD } }] }]
    expect(validateRelaySteps(bare, MONAD).reason).toMatch(/missing transaction data/i)
  })

  it('REFUSES an approval with no deposit to execute', () => {
    const steps = [{ id: 'approve', kind: 'transaction', items: [{ data: { chainId: MONAD, to: '0x1', data: '0x2' } }] }]
    expect(validateRelaySteps(steps, MONAD).reason).toMatch(/no deposit transaction/i)
  })

  it('REFUSES an approval whose spender is not the deposit target', () => {
    const q = fx('quote-emo-pixl.json')
    const moved = JSON.parse(JSON.stringify(q.steps))
    moved[1].items[0].data.to = '0x9999999999999999999999999999999999999999'
    expect(validateRelaySteps(moved, MONAD).reason).toMatch(/different contract than the one receiving the deposit/i)
  })

  it('REFUSES a non-standard approval payload', () => {
    const q = fx('quote-emo-pixl.json')
    const bad = JSON.parse(JSON.stringify(q.steps))
    bad[0].items[0].data.data = '0xdeadbeef'
    expect(validateRelaySteps(bad, MONAD).reason).toMatch(/not a standard ERC-20 approve/i)
  })

  it('REFUSES an empty or malformed step list', () => {
    expect(validateRelaySteps([], MONAD).ok).toBe(false)
    expect(validateRelaySteps(null, MONAD).ok).toBe(false)
  })
})

describe('the status endpoint Relay names is not an open redirect', () => {
  it('takes the relative path from the recorded route', () => {
    expect(relayCheckEndpoint(fx('quote-emo-pixl.json').steps)).toMatch(/^\/intents\/status\?requestId=0x/)
  })

  it('ignores an absolute URL a provider might hand back', () => {
    const steps = [{ id: 'deposit', kind: 'transaction', items: [{ data: {}, check: { endpoint: 'https://evil.test/steal' } }] }]
    expect(relayCheckEndpoint(steps)).toBeNull()
  })
})

describe('lifecycle, from real Relay records', () => {
  it('reports a real REFUND as refunded, never as a delivery', () => {
    for (const name of ['refund-1.json', 'refund-2.json']) {
      const rec = fx(name)
      const requested = rec.data.metadata.currencyOut.currency
      const r = mapRelayStatus({
        provider: 'relay', status: rec.status,
        failReason: rec.data.failReason,
        sourceChain: String(rec.data.inTxs[0].chainId),
        outboundChain: String((rec.data.outTxs[0] || {}).chainId ?? ''),
      }, requested.address)
      expect(r.state, name).toBe('refunded')
      expect(r.message, name).toMatch(/source chain/i)
    }
  })

  it('the refund fixtures really do pay out on the SOURCE chain', () => {
    // This is the fact the mapping depends on, asserted against the recording
    // rather than assumed: in and out are the same chain, while the REQUESTED
    // output was on a different one.
    for (const name of ['refund-1.json', 'refund-2.json']) {
      const d = fx(name).data
      expect(d.outTxs[0].chainId, name).toBe(d.inTxs[0].chainId)
      expect(d.metadata.currencyOut.currency.chainId, name).not.toBe(d.inTxs[0].chainId)
    }
  })

  it('reports a real FAILURE as failed and names the reason', () => {
    const rec = fx('failure-1.json')
    const r = mapRelayStatus({ provider: 'relay', status: rec.status, failReason: rec.data.failReason }, PIXL)
    expect(r.state).toBe('failed')
    expect(r.message).toMatch(/TRANSACTION_REVERTED/)
  })

  it('reports a real SUCCESS that delivered the requested token as completed', () => {
    const rec = fx('success-1.json')
    const out = rec.data.metadata.currencyOut.currency
    const r = mapRelayStatus({
      provider: 'relay', status: 'success',
      receivedTokenAddress: out.address, receivedTokenSymbol: out.symbol,
      receivedAmountRaw: rec.data.metadata.currencyOut.amount,
    }, out.address)
    expect(r.state).toBe('completed')
  })

  it('downgrades a "success" that delivered a DIFFERENT token to partial', () => {
    const rec = fx('success-1.json')
    const out = rec.data.metadata.currencyOut.currency
    const r = mapRelayStatus({
      provider: 'relay', status: 'success',
      receivedTokenAddress: out.address, receivedTokenSymbol: out.symbol,
      receivedAmountRaw: rec.data.metadata.currencyOut.amount,
    }, PIXL)
    expect(r.state).toBe('partial')
  })

  it('treats pending as bridging and an unrecorded request as unknown', () => {
    expect(mapRelayStatus({ provider: 'relay', status: 'pending' }, PIXL).state).toBe('bridging')
    // Observed live: /intents/status answers {"status":"unknown"} before the
    // deposit lands. That is NOT failure.
    expect(mapRelayStatus({ provider: 'relay', status: 'unknown' }, PIXL).state).toBe('unknown')
    expect(mapRelayStatus({ provider: 'relay', status: 'something-new' }, PIXL).state).toBe('unknown')
  })
})

describe('chain identity', () => {
  it('uses Relay ids that match the wallet registry, including the ones fixed this pass', () => {
    expect(RELAY_CHAIN.hyperevm).toBe(999)     // not 998, which is the testnet
    expect(RELAY_CHAIN.monad).toBe(143)
    expect(RELAY_CHAIN.robinhood).toBe(4663)
    expect(RELAY_CHAIN.arc).toBe(5042)
    expect(RELAY_CHAIN.solana).toBe(792703809) // Relay's own id, not LI.FI's
  })
})

describe('the real pre-signing validator accepts the normalized Relay plan', () => {
  it('passes validateSwapQuoteForExecution with an EXACT-amount approval', async () => {
    const q = fx('quote-emo-pixl.json')
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify(q), { status: 200 })) as typeof fetch
    try {
      const quote = await relayQuote({
        fromChain: 'monad', toChain: 'ethereum',
        sell: '0x81a224f8a62f52bde942dbf23a56df77a10b7777', buy: PIXL,
        sellSymbol: 'EMO', buySymbol: 'PIXL', amount: '100000000000000000000000', slippageBps: '200',
        taker: '0x5555555555555555555555555555555555555555',
        toAddress: '0x5555555555555555555555555555555555555555',
      }, { FEE_EVM: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', FEE_BPS: '100' }, false)
      expect(() => validateSwapQuoteForExecution(quote)).not.toThrow()
      // Relay approves exactly the sell amount — not an unlimited allowance.
      const d = String(quote.approvalTx.data).toLowerCase()
      expect(BigInt('0x' + d.slice(74, 138)).toString()).toBe(quote.sellAmountRaw)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})


describe('a floor that overshoots the approved slippage is re-asked TIGHTER, never accepted', () => {
  // Measured 2026-09-21, EMO -> MON on Monad: slippageTolerance 250 returned a
  // floor 2.52% below output. The wallet refuses any floor weaker than the
  // approved slippage, so that route could never have been signed.
  const quoteWith = (amount: bigint, min: bigint) =>
    ({ details: { currencyOut: { amount: amount.toString(), minimumAmount: min.toString() } } })

  it('returns null when the floor is already inside the bound', () => {
    expect(relayTightenedTolerance(quoteWith(1_000_000n, 975_000n), 250)).toBeNull()   // exactly 2.50%
    expect(relayTightenedTolerance(quoteWith(1_000_000n, 980_000n), 250)).toBeNull()
  })

  it('scales the tolerance down by the measured overshoot', () => {
    const t = relayTightenedTolerance(quoteWith(1_000_000n, 974_800n), 250)          // 2.52%
    expect(t).toBe(Math.floor((250 * 250) / 252) - 1)                                // 247
    expect(t!).toBeLessThan(250)
  })

  it('returns null when there is no floor to measure (the wallet refuses it on its own)', () => {
    expect(relayTightenedTolerance({ details: { currencyOut: { amount: '100' } } }, 250)).toBeNull()
    expect(relayTightenedTolerance(null, 250)).toBeNull()
  })

  it('re-asks once, and the quote it returns keeps the user-approved slippage', async () => {
    const q = fx('quote-emo-pixl.json')
    const out = BigInt(q.details.currencyOut.amount)
    const first = JSON.parse(JSON.stringify(q))
    first.details.currencyOut.minimumAmount = ((out * 9748n) / 10000n).toString()      // 2.52% below
    const bodies: { slippageTolerance: string }[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify(bodies.length === 1 ? first : q), { status: 200 })
    }) as typeof fetch
    try {
      const quote = await relayQuote({
        fromChain: 'monad', toChain: 'ethereum',
        sell: '0x81a224f8a62f52bde942dbf23a56df77a10b7777', buy: PIXL,
        sellSymbol: 'EMO', buySymbol: 'PIXL', amount: '100000000000000000000000', slippageBps: '250',
        taker: '0x5555555555555555555555555555555555555555',
        toAddress: '0x5555555555555555555555555555555555555555',
      }, { FEE_EVM: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', FEE_BPS: '100' }, false)
      expect(bodies).toHaveLength(2)
      expect(bodies[0].slippageTolerance).toBe('250')
      expect(Number(bodies[1].slippageTolerance)).toBeLessThan(250)
      // The approved bound the wallet checks against is the user's, unchanged.
      expect(quote.slippageBps).toBe(250)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
