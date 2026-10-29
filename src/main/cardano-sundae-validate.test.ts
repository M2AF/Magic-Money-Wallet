import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateSundaeOrderTx } from './cardano-sundae-validate'
import { validateMinswapOrderTx, indexWalletUtxos, walletKeys, CardanoSwapValidationError, type MinswapOrderExpectation } from './cardano-swap-validate'
import { decodeSundaeV3OrderDatum, SundaeOrderError, SUNDAE_V3 } from './sundae-v3-order'
import { termsFromEstimate, MinswapQuoteError, type MinswapEstimate, type MinswapEstimateRequest } from './minswap-client'

/**
 * The transaction here was built LIVE by agg-api.minswap.org on 2026-10-28
 * (`include_protocols: ["SundaeSwapV3"]`, 10 ADA -> SNEK) for a public mainnet
 * address, and never signed. Tampered variants swap bytes of equal length, so
 * the CBOR stays well-formed and only the validator's judgement is under test.
 */

const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'sundae', 'ada-snek-v3.json'), 'utf8')) as {
  sender: string
  estimateRequest: MinswapEstimateRequest
  estimate: MinswapEstimate
  buildTx: { cbor: string }
  utxos: Array<{ txHash: string; txIndex: number; lovelace: string; assets: Array<{ unit: string; quantity: string }> }>
}
const utxos = indexWalletUtxos(fx.utxos.map(u => ({
  txHash: u.txHash, txIndex: u.txIndex, lovelace: BigInt(u.lovelace),
  assets: u.assets.map(a => ({ unit: a.unit, quantity: BigInt(a.quantity) })),
})))
const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b'
const POOL = 'cacb7fd5f5b84bf876d40dc60d4991c72112d78d76132b1fb769e6ad'
const w = walletKeys(fx.sender, 'mainnet')
const TX = fx.buildTx.cbor

function expectation(over: Partial<MinswapOrderExpectation> = {}): MinswapOrderExpectation {
  const t = termsFromEstimate(fx.estimateRequest, fx.estimate, 'SundaeSwapV3')
  return {
    walletAddress: fx.sender, network: 'mainnet', sellUnit: 'lovelace', sellAmountRaw: '10000000',
    buyUnit: SNEK, buyAmountRaw: t.buyAmountRaw, minBuyAmountRaw: t.minBuyAmountRaw, terms: t.terms, ...over,
  }
}

/** Replace a unique substring of the transaction, keeping its length. */
function tamper(find: string, replace: string): string {
  expect(replace.length).toBe(find.length)
  expect(TX.split(find).length - 1).toBe(1)
  return TX.replace(find, replace)
}

const run = (tx: string, e = expectation()) => validateSundaeOrderTx(tx, e, utxos, null)
const refuses = (tx: string, why: RegExp, e = expectation()) => {
  expect(() => run(tx, e)).toThrow(CardanoSwapValidationError)
  expect(() => run(tx, e)).toThrow(why)
}

/** The order's inline datum (hex) inside the fixture. */
const DATUM = (() => {
  const start = TX.indexOf('d8799fd8799f581c' + POOL)
  return TX.slice(start, TX.indexOf('43d87980ff', start) + 10)
})()

describe('SundaeSwap V3 order (live Minswap aggregator build)', () => {
  it('accepts the order exactly as built, and reads its costs out of the transaction', () => {
    const r = run(TX)
    expect(r.order).toMatchObject({
      poolIdent: POOL, ownerKeyHash: w.stakeKeyHash, maxProtocolFee: 1_280_000n,
      offerUnit: 'lovelace', offerAmount: 10_000_000n, minReceivedUnit: SNEK, minReceived: 3236n,
    })
    expect(r.cost).toMatchObject({ batcherFeeLovelace: '1280000', depositLovelace: '2000000', aggregatorFeeLovelace: '850000', orderMinimumRaw: '3236', killable: null })
    expect(BigInt(r.cost.adaSpentLovelace)).toBe(BigInt(r.cost.txFeeLovelace) + 13_280_000n + 850_000n)
  })

  it('refuses a lower minimum, a different pool, owner, destination, amount or fee', () => {
    refuses(tamper('44534e454b190ca4', '44534e454b190001'), /minimum received is below/)
    refuses(TX, /different pool/, expectation({ terms: { ...expectation().terms, poolIdent: 'ab'.repeat(28) } }))
    refuses(tamper(`d8799f581c${w.stakeKeyHash}ff1a00138800`, `d8799f581c${'ab'.repeat(28)}ff1a00138800`), /someone other than this wallet/)
    refuses(tamper(`d8799fd8799f581c${w.paymentKeyHash}ff`, `d8799fd8799f581c${'ab'.repeat(28)}ff`), /proceeds to an address that is not this wallet/)
    refuses(TX, /sells a different amount/, expectation({ sellAmountRaw: '9000000' }))
    refuses(TX, /protocol fee differs/, expectation({ terms: { ...expectation().terms, batcherFeeLovelace: '1000000' } }))
    refuses(TX, /below the one you approved/, expectation({ minBuyAmountRaw: '3240' }))
  })

  it('refuses an order at another script or staked to an unknown key, and a changed aggregator fee', () => {
    refuses(tamper(SUNDAE_V3.orderScriptHash + SUNDAE_V3.aggregatorOrderStakeHash, 'ab'.repeat(28) + SUNDAE_V3.aggregatorOrderStakeHash), /neither this wallet/)
    refuses(tamper(SUNDAE_V3.orderScriptHash + SUNDAE_V3.aggregatorOrderStakeHash, SUNDAE_V3.orderScriptHash + 'ab'.repeat(28)), /staked to an unknown key/)
    refuses(TX, /aggregator fee differs/, expectation({ terms: { ...expectation().terms, aggregatorFeeLovelace: '850001' } }))
  })

  it('refuses coins that are not this wallet\'s unspent coins', () => {
    expect(() => validateSundaeOrderTx(TX, expectation(), new Map(), null)).toThrow(/not an unspent coin of this wallet/)
  })

  it('refuses a transaction whose ADA does not balance to the quoted costs (an unexplained 1 lovelace)', () => {
    const r = run(TX)
    const inputs = [...utxos.keys()].filter(k => TX.includes(k.split('#')[0]))
    expect(inputs.length).toBeGreaterThan(0)
    const skewed = new Map(utxos)
    const u = skewed.get(inputs[0])!
    skewed.set(inputs[0], { ...u, lovelace: u.lovelace + 1n })
    expect(r.txId).toMatch(/^[0-9a-f]{64}$/)
    expect(() => validateSundaeOrderTx(TX, expectation(), skewed, null)).toThrow(/does not balance/)
  })

  it('is not accepted by the Minswap V2 check, nor the reverse (one validator per shape)', () => {
    expect(() => validateMinswapOrderTx(TX, { ...expectation(), terms: { ...expectation().terms, protocol: 'MinswapV2' } }, utxos, null)).toThrow(CardanoSwapValidationError)
    refuses(TX, /only SundaeSwap V3/, expectation({ terms: { ...expectation().terms, protocol: 'MinswapV2' } }))
  })
})

describe('SundaeSwap V3 order selling a token (live build, 2 USDCx -> ADA)', () => {
  const fx2 = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'sundae', 'usdcx-ada-v3.json'), 'utf8')) as typeof fx
  const utxos2 = indexWalletUtxos(fx2.utxos.map(u => ({
    txHash: u.txHash, txIndex: u.txIndex, lovelace: BigInt(u.lovelace),
    assets: u.assets.map(a => ({ unit: a.unit, quantity: BigInt(a.quantity) })),
  })))
  const t = termsFromEstimate(fx2.estimateRequest, fx2.estimate, 'SundaeSwapV3')
  const e2: MinswapOrderExpectation = {
    walletAddress: fx2.sender, network: 'mainnet', sellUnit: fx2.estimateRequest.token_in, sellAmountRaw: '2000000',
    buyUnit: 'lovelace', buyAmountRaw: t.buyAmountRaw, minBuyAmountRaw: t.minBuyAmountRaw, terms: t.terms,
  }
  it('accepts it: the order locks exactly the USDCx sold, plus the fee and deposit in ADA', () => {
    const r = validateSundaeOrderTx(fx2.buildTx.cbor, e2, utxos2, null)
    expect(r.order).toMatchObject({ offerUnit: e2.sellUnit, offerAmount: 2_000_000n, minReceivedUnit: 'lovelace', minReceived: BigInt(t.minBuyAmountRaw) })
    expect(r.cost.adaSpentLovelace).toBe((BigInt(r.cost.txFeeLovelace) + BigInt(t.terms.batcherFeeLovelace) + BigInt(t.terms.depositLovelace) + BigInt(t.terms.aggregatorFeeLovelace)).toString())
  })
  it('refuses it when the quote says a different token or amount was sold', () => {
    expect(() => validateSundaeOrderTx(fx2.buildTx.cbor, { ...e2, sellAmountRaw: '1999999' }, utxos2, null)).toThrow(/sells a different amount/)
    expect(() => validateSundaeOrderTx(fx2.buildTx.cbor, { ...e2, sellUnit: SNEK, terms: { ...t.terms, path: [SNEK, 'lovelace'] } }, utxos2, null)).toThrow(CardanoSwapValidationError)
  })
})

describe('SundaeSwap V3 datum decoder', () => {
  const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)))
  it('decodes the live datum', () => {
    expect(decodeSundaeV3OrderDatum(bytes(DATUM)).destination).toEqual({ payment: { kind: 'key', hash: w.paymentKeyHash }, stake: { kind: 'key', hash: w.stakeKeyHash } })
  })
  it('refuses no pool, a Strategy order, a datum on the proceeds and other extension data', () => {
    // pool_ident Some(…) -> None-tagged constructor (constr 1) of the same length
    expect(() => decodeSundaeV3OrderDatum(bytes(DATUM.replace('d8799fd8799f581c', 'd8799fd87a9f581c')))).toThrow(/names no pool/)
    expect(() => decodeSundaeV3OrderDatum(bytes(DATUM.replace('d87a9f9f4040', 'd8799f9f4040')))).toThrow(/is not a swap/)
    expect(() => decodeSundaeV3OrderDatum(bytes(DATUM.replace('ffffffffd87980ff', 'ffffffffd87b80ff')))).toThrow(/attaches a datum/)
    expect(() => decodeSundaeV3OrderDatum(bytes(DATUM.replace('43d87980ff', '43d87a80ff')))).toThrow(SundaeOrderError)
  })
})

describe('SundaeSwap V3 estimate', () => {
  it('carries the pool id, and refuses a route the aggregator sent through Minswap V1 instead', () => {
    expect(termsFromEstimate(fx.estimateRequest, fx.estimate, 'SundaeSwapV3').terms).toMatchObject({ protocol: 'SundaeSwapV3', poolIdent: POOL, path: ['lovelace', SNEK] })
    const v1 = { ...fx.estimate, paths: [[{ ...fx.estimate.paths![0][0], protocol: 'Minswap' }]] }
    expect(() => termsFromEstimate(fx.estimateRequest, v1, 'SundaeSwapV3')).toThrow(MinswapQuoteError)
    expect(() => termsFromEstimate(fx.estimateRequest, v1, 'SundaeSwapV3')).toThrow(/not SundaeSwap V3/)
  })
})
