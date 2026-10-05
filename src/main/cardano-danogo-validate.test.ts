/**
 * Danogo CLMM swaps built by Minswap's aggregator: the separate pre-signing
 * validator, the witness merge used at signing, and the captured transactions
 * checked against Danogo's PUBLISHED swap rules.
 *
 * Fixtures are real, unsigned, read-only captures (2026-10-05,
 * src/main/__fixtures__/minswap/*-danogo-*.json) with the pool and wallet inputs
 * resolved from Koios at capture time. Nothing here was signed or submitted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateDanogoSwapTx } from './cardano-danogo-validate'
import {
  validateMinswapOrderTx, indexWalletUtxos, CardanoSwapValidationError, mergeWitnessSets,
  splitTxRoot, hexToBytesStrict, type MinswapOrderExpectation,
} from './cardano-swap-validate'
import { termsFromEstimate, minswapQuoteDirect, MinswapQuoteError, type MinswapEstimate, type MinswapEstimateRequest } from './minswap-client'
import { checkMinReceived } from '../shared/swap-policy-checks'
import { validateSwapQuoteForExecution } from '../shared/swap-execution-checks'
import { withMinReceived, selectSafeRoute } from '../shared/swap-candidates'
import { DANOGO_CLMM, decodeDanogoPoolDatum, decodeDanogoSwapRedeemer, danogoMaxPayout } from './danogo-clmm'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { CARDANO_LOVELACE } from '../shared/swap-token-identity'

const FIX = join(__dirname, '__fixtures__', 'minswap')
interface Resolved { ref: string; address: string; lovelace: string; assets: Array<{ unit: string; quantity: string }>; inlineDatum: string | null }
interface Fixture {
  sender: string
  estimateRequest: MinswapEstimateRequest
  estimate: MinswapEstimate
  buildTx: { cbor: string }
  poolInput: Resolved
  walletInputs: Resolved[]
}
const load = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8')) as Fixture
const BUY = load('ada-usdcx-danogo-20')   // 20 ADA -> USDCx
const SELL = load('usdcx-ada-danogo-2')   // 2 USDCx -> ADA
const USDCX = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378'
const SENDER_PAYMENT = 'def3ae76d194a05fc6fc4e29e281d628ab84ee5a466e81e41e465e88'
const OTHER_HASH = '00'.repeat(28)
/** Validity start of both captures: the slot they were built at. */
const NOW = 199658029n

const utxosOf = (fx: Fixture) => indexWalletUtxos(fx.walletInputs.map(u => {
  const [txHash, i] = u.ref.split('#')
  return { txHash, txIndex: Number(i), lovelace: BigInt(u.lovelace), assets: u.assets.map(a => ({ unit: a.unit, quantity: BigInt(a.quantity) })) }
}))

function expectationFor(fx: Fixture, over: Partial<MinswapOrderExpectation> = {}): MinswapOrderExpectation {
  const t = termsFromEstimate(fx.estimateRequest, fx.estimate, 'DanogoCLMMV1')
  return {
    walletAddress: fx.sender, network: 'mainnet',
    sellUnit: fx.estimateRequest.token_in, sellAmountRaw: fx.estimateRequest.amount,
    buyUnit: fx.estimateRequest.token_out,
    buyAmountRaw: t.buyAmountRaw, minBuyAmountRaw: t.minBuyAmountRaw, terms: t.terms,
    ...over,
  }
}

const validate = (fx: Fixture, tx = fx.buildTx.cbor, exp = expectationFor(fx), utxos = utxosOf(fx), slot: bigint | null = NOW) =>
  validateDanogoSwapTx(tx, exp, utxos, slot)
const refuse = (pattern: RegExp, ...args: Parameters<typeof validate>) => {
  expect(() => validate(...args)).toThrow(CardanoSwapValidationError)
  expect(() => validate(...args)).toThrow(pattern)
}
/** Replace the first `n`-th occurrence of `from` inside the body bytes only. */
function tamperBody(txHex: string, from: string, to: string, occurrence = 1): string {
  const p = splitTxRoot(hexToBytesStrict(txHex))
  const body = Buffer.from(p.body).toString('hex')
  let idx = -1
  for (let k = 0; k < occurrence; k++) { idx = body.indexOf(from, idx + 1); if (idx < 0) throw new Error('pattern not in body') }
  const patched = body.slice(0, idx) + to + body.slice(idx + from.length)
  return txHex.replace(body, patched)
}

describe('validateDanogoSwapTx — the recorded Danogo swaps pass', () => {
  it('20 ADA -> USDCx: delivers exactly the quoted USDCx, debits exactly the sale and the fees', () => {
    const v = validate(BUY)
    expect(v.deliveredRaw).toBe('5298566')
    expect(v.redeemer.delta).toBe(20_000_000n)
    expect(v.cost).toMatchObject({
      txFeeLovelace: '477729', aggregatorFeeLovelace: '850000', dexFeeLovelace: '100000',
      batcherFeeLovelace: '0', depositLovelace: '0', killable: null,
      // 20 ADA + 0.1 Danogo + 0.85 aggregator + network fee
      adaSpentLovelace: String(20_000_000 + 100_000 + 850_000 + 477_729),
      orderMinimumRaw: '5298566',
    })
    expect(v.txId).toBe('fe059246cbf7195c36dd92c843711c298dfe309c11d36dabfa34d9452f59d819')
  })

  it('2 USDCx -> ADA: delivers the pool payout net of the Danogo fee; the wallet pays only network and aggregator fees', () => {
    const v = validate(SELL)
    expect(v.deliveredRaw).toBe('7450965')
    expect(v.redeemer.delta).toBe(-2_000_000n)
    expect(v.cost.adaSpentLovelace).toBe(String(850_000 + 484_774))
  })

  it('the quote for an ADA purchase states the delivered amount (amount_out less the swap fee)', () => {
    expect(expectationFor(SELL).buyAmountRaw).toBe('7450965')
    expect(expectationFor(SELL).minBuyAmountRaw).toBe('7450965')
    expect(expectationFor(BUY).buyAmountRaw).toBe('5298566')
  })
})

describe('validateDanogoSwapTx — refuses anything outside the approved swap', () => {
  it('the Minswap V2 order validator still refuses the Danogo shape outright', () => {
    const exp = { ...expectationFor(BUY), terms: { ...expectationFor(BUY).terms, protocol: 'MinswapV2' as const } }
    expect(() => validateMinswapOrderTx(BUY.buildTx.cbor, exp, utxosOf(BUY), NOW)).toThrow(/already carries witnesses or scripts/)
  })

  it('a Minswap V2 expectation is not accepted by the Danogo validator', () => {
    const exp = { ...expectationFor(BUY), terms: { ...expectationFor(BUY).terms, protocol: 'MinswapV2' as const } }
    refuse(/only accepts Danogo swaps/, BUY, BUY.buildTx.cbor, exp)
  })

  it('proceeds redirected away from the wallet', () => {
    refuse(/neither this wallet, the Danogo pool nor the aggregator/, BUY, tamperBody(BUY.buildTx.cbor, SENDER_PAYMENT, OTHER_HASH))
  })

  it('a pool other than Danogo\'s published pool script', () => {
    // The first occurrence is the pool output's payment credential.
    refuse(/neither this wallet, the Danogo pool|does not return the Danogo pool/, BUY,
      tamperBody(BUY.buildTx.cbor, DANOGO_CLMM.poolScriptHash, OTHER_HASH))
  })

  it('a protocol config other than the published one', () => {
    refuse(/published pool script and protocol config/, BUY,
      tamperBody(BUY.buildTx.cbor, DANOGO_CLMM.protocolConfigRef.split('#')[0], 'ab'.repeat(32)))
  })

  it('a different sale amount in the redeemer', () => {
    const tx = BUY.buildTx.cbor.split('01312d00').join('01312d01')
    refuse(/sells a different amount/, BUY, tx)
  })

  it('a quote for a different sell amount', () => {
    refuse(/sells a different amount|does not balance/, BUY, BUY.buildTx.cbor, expectationFor(BUY, { sellAmountRaw: '19000000' }))
  })

  it('a minimum above what the transaction delivers', () => {
    refuse(/delivers less than the minimum/, SELL, SELL.buildTx.cbor, expectationFor(SELL, { buyAmountRaw: '7450966', minBuyAmountRaw: '7450966' }))
  })

  it('a different aggregator fee than quoted', () => {
    const exp = expectationFor(BUY)
    refuse(/aggregator fee differs/, BUY, BUY.buildTx.cbor, { ...exp, terms: { ...exp.terms, aggregatorFeeLovelace: '800000' } })
  })

  it('a Danogo swap fee other than the protocol\'s', () => {
    const exp = expectationFor(BUY)
    refuse(/swap fee differs/, BUY, BUY.buildTx.cbor, { ...exp, terms: { ...exp.terms, dexFeeLovelace: '200000' } })
  })

  it('the wallet\'s own coin put up as collateral', () => {
    const utxos = new Map(utxosOf(BUY))
    utxos.set('fbd23ce6c4330a6168217bbab71d87774a8053b43bff8a6eafbebe9b36a3b15f#8', { lovelace: 5_000_000n, assets: [] })
    refuse(/collateral/, BUY, BUY.buildTx.cbor, expectationFor(BUY), utxos)
  })

  it('a wallet input that is no longer unspent (two foreign inputs)', () => {
    refuse(/exactly one pool/, BUY, BUY.buildTx.cbor, expectationFor(BUY), new Map())
  })

  it('an expired validity window', () => {
    refuse(/expired/, BUY, BUY.buildTx.cbor, expectationFor(BUY), utxosOf(BUY), NOW + 360n)
  })

  it('a token-to-token expectation', () => {
    refuse(/between ADA and a token/, BUY, BUY.buildTx.cbor,
      expectationFor(BUY, { sellUnit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b' }))
  })

  it('the wrong network', () => {
    refuse(/network/, BUY, BUY.buildTx.cbor, expectationFor(BUY, { network: 'testnet' }))
  })
})

describe('mergeWitnessSets — the wallet signature is added, everything else is kept byte for byte', () => {
  const ours = Uint8Array.from([0xa1, 0x00, 0x81, 0x82, 0x58, 0x20, ...new Array(32).fill(7), 0x58, 0x40, ...new Array(64).fill(9)])

  it('an empty provider set yields exactly the wallet set (V2 orders unchanged)', () => {
    expect(mergeWitnessSets(Uint8Array.from([0xa0]), ours)).toEqual(ours)
  })

  it('Danogo: provider vkey first, then ours; redeemer bytes untouched', () => {
    const provider = splitTxRoot(hexToBytesStrict(BUY.buildTx.cbor)).witnessSet
    const merged = mergeWitnessSets(provider, ours)
    const decoded = decodeCbor(merged) as CborMap
    const vkeys = decoded.getInt(0) as Uint8Array[][]
    expect(vkeys).toHaveLength(2)
    expect(Buffer.from(vkeys[1][0]).toString('hex')).toBe('07'.repeat(32))
    // The redeemer entry's exact bytes survive.
    const redeemerHex = Buffer.from(provider).toString('hex').slice(Buffer.from(provider).toString('hex').indexOf('0584'))
    expect(Buffer.from(merged).toString('hex').endsWith(redeemerHex)).toBe(true)
  })

  it('a tag-258 vkey set keeps its tag', () => {
    // {0: 258([[vk, sig]])}
    const vk = [0x82, 0x58, 0x20, ...new Array(32).fill(1), 0x58, 0x40, ...new Array(64).fill(2)]
    const provider = Uint8Array.from([0xa1, 0x00, 0xd9, 0x01, 0x02, 0x81, ...vk])
    const merged = Buffer.from(mergeWitnessSets(provider, ours)).toString('hex')
    expect(merged.startsWith('a100d9010282')).toBe(true)
  })

  it('a wallet set carrying anything but vkeys is refused', () => {
    expect(() => mergeWitnessSets(splitTxRoot(hexToBytesStrict(BUY.buildTx.cbor)).witnessSet, Uint8Array.from([0xa1, 0x05, 0x80])))
      .toThrow(CardanoSwapValidationError)
  })
})

describe('the recorded transactions follow Danogo\'s published swap rule', () => {
  const datumOfOutput = (fx: Fixture) => {
    const body = decodeCbor(splitTxRoot(hexToBytesStrict(fx.buildTx.cbor)).body) as CborMap
    const out = (body.getInt(1) as CborMap[])[0]
    return { datum: decodeDanogoPoolDatum((out.getInt(2) as [bigint, Uint8Array])[1]), value: out.getInt(1) as [bigint, CborMap] }
  }
  const poolIn = (fx: Fixture) => ({
    datum: decodeDanogoPoolDatum(Buffer.from(fx.poolInput.inlineDatum as string, 'hex')),
    lovelace: BigInt(fx.poolInput.lovelace),
    usdcx: BigInt(fx.poolInput.assets.find(a => a.unit === USDCX)!.quantity),
  })
  const usdcxOf = (value: [bigint, CborMap]) => {
    for (const [policy, names] of value[1].entries) {
      if (Buffer.from(policy as Uint8Array).toString('hex') === USDCX.slice(0, 56)) return (names as CborMap).entries[0][1] as bigint
    }
    throw new Error('no USDCx')
  }

  for (const [name, fx] of [['20 ADA -> USDCx', BUY], ['2 USDCx -> ADA', SELL]] as const) {
    it(`${name}: pays out no more than the rule allows, and updates only the fields it may`, () => {
      const pin = poolIn(fx)
      const { datum: outDatum, value } = datumOfOutput(fx)
      const delta = BigInt(fx.estimateRequest.amount) * (fx.estimateRequest.token_in === CARDANO_LOVELACE ? 1n : -1n)
      expect(pin.datum.tokenX).toBe(CARDANO_LOVELACE)
      expect(pin.datum.tokenY).toBe(USDCX)
      // Swap fee: total_swap_fee grows by exactly protocol_config.swap_fee.
      expect(outDatum.totalSwapFee - pin.datum.totalSwapFee).toBe(DANOGO_CLMM.swapFeeLovelace)
      // Platform fee accrues on the side being sold: FLOOR(pf + lp/1e4 * rate/1e4 * change).
      const accrued = (pin.datum.lpFeeRate * DANOGO_CLMM.platformFeeRate * (delta > 0n ? delta : -delta)) / 100_000_000n
      if (delta > 0n) {
        expect(outDatum.platformFeeX).toBe(pin.datum.platformFeeX + accrued)
        expect(outDatum.platformFeeY).toBe(pin.datum.platformFeeY)
      } else {
        expect(outDatum.platformFeeY).toBe(pin.datum.platformFeeY + accrued)
        expect(outDatum.platformFeeX).toBe(pin.datum.platformFeeX)
      }
      // Fields the swap may not change.
      for (const k of ['tokenX', 'tokenY', 'lpFeeRate', 'sqrtLowerPrice', 'sqrtUpperPrice', 'minXChange', 'minYChange', 'circulatingLpToken'] as const) {
        expect(outDatum[k]).toEqual(pin.datum[k])
      }
      // What the pool paid, excluding the swap fee it collected in ADA.
      const outLovelace = value[0]
      const outUsdcx = usdcxOf(value)
      const maxPayout = danogoMaxPayout({ reserveX: pin.lovelace, reserveY: pin.usdcx }, pin.datum, delta)
      if (delta > 0n) {
        expect(outLovelace - pin.lovelace).toBe(delta + DANOGO_CLMM.swapFeeLovelace)
        const paid = pin.usdcx - outUsdcx
        expect(paid).toBe(5_298_566n)
        expect(paid <= maxPayout).toBe(true)
        expect(paid >= pin.datum.minYChange).toBe(true)
      } else {
        expect(outUsdcx - pin.usdcx).toBe(-delta)
        const paid = pin.lovelace - outLovelace + DANOGO_CLMM.swapFeeLovelace
        expect(paid).toBe(7_550_965n)
        expect(paid <= maxPayout).toBe(true)
        expect(paid >= pin.datum.minXChange).toBe(true)
      }
    })
  }

  it('the redeemer decodes as a single-pool swap at the pool input and output', () => {
    const r = decodeDanogoSwapRedeemer(Buffer.from('000300000000000000000000000000000000000000000000000000000000000001312d00', 'hex'))
    expect(r).toEqual({ inIdx: 0, poolInIdx: 0, poolOutIdx: 0, delta: 20_000_000n })
    expect(decodeDanogoSwapRedeemer(Buffer.from('01030000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe17b80', 'hex')).delta).toBe(-2_000_000n)
    expect(() => decodeDanogoSwapRedeemer(Buffer.from('0001', 'hex'))).toThrow(/single-pool swap/)
    expect(() => decodeDanogoSwapRedeemer(Buffer.from('000200000000000000000000000000000000000000000000000000000000000001312d00', 'hex'))).toThrow(/not a swap/)
  })
})

describe('termsFromEstimate — Danogo routes', () => {
  const est = BUY.estimate
  const req = BUY.estimateRequest
  const bad = (e: Partial<MinswapEstimate>, pattern: RegExp) =>
    expect(() => termsFromEstimate(req, { ...est, ...e }, 'DanogoCLMMV1')).toThrow(pattern)

  it('reads one pool, ADA on one side, with the protocol swap fee', () => {
    expect(termsFromEstimate(req, est, 'DanogoCLMMV1').terms).toEqual({
      protocol: 'DanogoCLMMV1', path: [CARDANO_LOVELACE, USDCX],
      batcherFeeLovelace: '0', depositLovelace: '0', aggregatorFeeLovelace: '850000', dexFeeLovelace: '100000',
    })
  })
  it('refuses a split', () => bad({ paths: [est.paths![0], est.paths![0]] }, /split/))
  it('refuses more than one pool', () => bad({ paths: [[est.paths![0][0], est.paths![0][0]]] }, /more than one Danogo pool/))
  it('refuses another protocol', () => bad({ paths: [[{ ...est.paths![0][0], protocol: 'MinswapV2' }]] }, /not Danogo/))
  it('refuses a different swap fee', () => bad({ total_dex_fee: '200000' }, /swap fee/))
  it('refuses a deposit', () => bad({ deposits: '2000000' }, /deposit/))
  it('throws the quote error type', () => expect(() => termsFromEstimate(req, { ...est, deposits: '1' }, 'DanogoCLMMV1')).toThrow(MinswapQuoteError))
})

describe('minswapQuoteDirect — Danogo candidate', () => {
  const fetchReturning = (...bodies: unknown[]) => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const fn = async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify(bodies.shift() ?? {}), { status: 200 })
    }
    return { fn, calls }
  }
  const input = (fx: Fixture, protocol?: 'DanogoCLMMV1') => ({
    sellUnit: fx.estimateRequest.token_in, buyUnit: fx.estimateRequest.token_out, sellAmountRaw: fx.estimateRequest.amount,
    slippageBps: 50, sender: fx.sender, fromSymbol: 'A', toSymbol: 'B', protocol,
  })

  it('asks for one Danogo pool, builds with Minswap\'s own minimum, and quotes the delivered amount', async () => {
    const { fn, calls } = fetchReturning(SELL.estimate, SELL.buildTx)
    const q = await minswapQuoteDirect(input(SELL, 'DanogoCLMMV1'), fn)
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['estimate', 'build-tx'])
    expect(calls[0].body).toMatchObject({ include_protocols: ['DanogoCLMMV1'], allow_multi_hops: false })
    expect(calls[1].body.min_amount_out).toBe(SELL.estimate.min_amount_out)
    expect(q.buyAmountRaw).toBe('7450965')
    expect(q.minBuyAmountRaw).toBe('7450965')
    expect(q.cardanoOrder?.protocol).toBe('DanogoCLMMV1')
    expect(q.bridgeTool).toBe('Danogo CLMM')
    expect(q.externalFees?.find(f => f.name === 'Danogo swap fee')).toMatchObject({ amountRaw: '100000', includedInQuotedOutput: true })
    expect(checkMinReceived(q).ok).toBe(true)
    expect(() => validateSwapQuoteForExecution(q, Date.now(), () => false)).not.toThrow()
  })

  it('ranks beside a Minswap V2 candidate on what the user receives; the other stays an alternative', async () => {
    const v2fx = JSON.parse(readFileSync(join(FIX, 'ada-usdcx-1hop.json'), 'utf8'))
    const v2 = await minswapQuoteDirect(input(BUY), fetchReturning(v2fx.estimate, v2fx.buildTx).fn)
    const dn = await minswapQuoteDirect(input(BUY, 'DanogoCLMMV1'), fetchReturning(BUY.estimate, BUY.buildTx).fn)
    const ready = [withMinReceived(v2)!, withMinReceived(dn)!]
    const picked = selectSafeRoute(ready, [])
    const best = BigInt(v2.buyAmountRaw) > BigInt(dn.buyAmountRaw) ? v2 : dn
    expect(picked.quote?.cardanoOrder?.protocol).toBe(best.cardanoOrder?.protocol)
    expect(picked.routing?.safeCandidates).toBe(2)
  })
})
