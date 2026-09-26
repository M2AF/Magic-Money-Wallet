import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  validateMinswapOrderTx, indexWalletUtxos, splitTxRoot, assembleSignedTx, txIdOf, hexToBytesStrict,
  CardanoSwapValidationError, MINSWAP_AGGREGATOR_FEE_KEY_HASH, type MinswapOrderExpectation,
} from './cardano-swap-validate'
import {
  minswapV2Pool, decodeMinswapV2OrderDatum, MinswapOrderError, MINSWAP_V2,
} from './minswap-v2-order'
import { termsFromEstimate, type MinswapEstimate, type MinswapEstimateRequest } from './minswap-client'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { cborArray, cborMap, cborUint, cborBytes } from './cardano-cip30'
import { CARDANO_LOVELACE, CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'

/**
 * Every transaction here was built LIVE by agg-api.minswap.org on 2026-09-26 for
 * a public mainnet address that holds USDCx, and never signed (see
 * docs/CARDANO-SWAP-DISCOVERY.md). The tampered variants change bytes of equal
 * length, so the CBOR stays well-formed and only the validator's judgement is
 * under test.
 */

const FIX = join(__dirname, '__fixtures__', 'minswap')
const load = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'))

interface Fixture {
  sender: string
  estimateRequest: MinswapEstimateRequest
  estimate: MinswapEstimate
  buildTx: { cbor: string }
}

const utxoDoc = load('sender-utxos') as {
  utxos: Array<{ txHash: string; txIndex: number; lovelace: string; assets: Array<{ unit: string; quantity: string }> }>
}
const walletUtxos = indexWalletUtxos(utxoDoc.utxos.map(u => ({
  txHash: u.txHash, txIndex: u.txIndex, lovelace: BigInt(u.lovelace),
  assets: u.assets.map(a => ({ unit: a.unit, quantity: BigInt(a.quantity) })),
})))

const USDCX = CARDANO_USDCX_UNIT.mainnet
const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b'
const SENDER_PAYMENT = 'def3ae76d194a05fc6fc4e29e281d628ab84ee5a466e81e41e465e88'
const OTHER_HASH = 'ab'.repeat(28)

function expectationFor(fx: Fixture, over: Partial<MinswapOrderExpectation> = {}): MinswapOrderExpectation {
  const t = termsFromEstimate(fx.estimateRequest, fx.estimate)
  return {
    walletAddress: fx.sender,
    network: 'mainnet',
    sellUnit: fx.estimateRequest.token_in,
    sellAmountRaw: fx.estimateRequest.amount,
    buyUnit: fx.estimateRequest.token_out,
    buyAmountRaw: t.buyAmountRaw,
    minBuyAmountRaw: t.minBuyAmountRaw,
    terms: t.terms,
    ...over,
  }
}

/** The order output's inline datum, as hex. */
function orderDatumHex(txHex: string): string {
  const body = decodeCbor(splitTxRoot(hexToBytesStrict(txHex)).body) as CborMap
  for (const out of body.getInt(1) as unknown[]) {
    if (out instanceof CborMap && out.getInt(2) !== undefined) {
      const opt = out.getInt(2) as [bigint, Uint8Array]
      return Buffer.from(opt[1]).toString('hex')
    }
  }
  throw new Error('fixture has no order output')
}

/** Replace the Nth occurrence of `find` inside the datum only, keeping the length. */
function tamperDatum(txHex: string, find: string, replace: string, occurrence = 1): string {
  expect(replace.length).toBe(find.length)
  const datum = orderDatumHex(txHex)
  let at = -1
  for (let i = 0; i < occurrence; i++) at = datum.indexOf(find, at + 1)
  expect(at).toBeGreaterThanOrEqual(0)
  const changed = datum.slice(0, at) + replace + datum.slice(at + find.length)
  expect(txHex.split(datum).length).toBe(2)
  return txHex.replace(datum, changed)
}

const fixtures: Array<[string, Fixture]> = [
  ['usdcx-snek-2hop', load('usdcx-snek-2hop')],
  ['ada-usdcx-2hop', load('ada-usdcx-2hop')],
  ['ada-usdcx-1hop', load('ada-usdcx-1hop')],
]

describe('Minswap V2 pool identity (offline, from the published contract)', () => {
  it('matches the test vector in minswap-dex-v2 utils.ak (ADA / MIN)', () => {
    const pool = minswapV2Pool(CARDANO_LOVELACE, '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e')
    expect(pool.lpAssetName).toBe('82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75')
    expect(pool.assetA).toBe(CARDANO_LOVELACE)
  })

  it('is order-independent, and names the ADA/USDCx pool the live orders use', () => {
    expect(minswapV2Pool(USDCX, CARDANO_LOVELACE)).toEqual(minswapV2Pool(CARDANO_LOVELACE, USDCX))
    expect(minswapV2Pool(CARDANO_LOVELACE, USDCX).lpAssetName)
      .toBe('4c414a51eac26e5f913a91265c2882e013e1d74dab9a5fe2f875f7df7c9bb4c1')
  })
})

describe('Minswap V2 order datum decoding', () => {
  it('decodes every live order sitting on the V2 order script', () => {
    const corpus = load('v2-order-datums') as { orders: Array<{ txIn: string; datum: string }> }
    expect(corpus.orders.length).toBeGreaterThan(20)
    // Measured: all 60 are plain swaps (58 single-hop, 1 three-hop, 1 with an
    // expiry) and every one is killable=false — an order the market moves away
    // from is NOT refunded by the batcher; it waits for its owner to cancel.
    let killable = 0
    for (const o of corpus.orders) {
      const d = decodeMinswapV2OrderDatum(Buffer.from(o.datum, 'hex'))
      expect(['swap-exact-in', 'swap-multi-routing']).toContain(d.stepKind)
      expect(d.lpAsset.policyId).toBe(MINSWAP_V2.lpPolicyId)
      if (d.killable) killable++
    }
    expect(killable).toBe(0)
  })

  it('reads the single-hop fixture exactly: owner, receivers, amount, floor, killable', () => {
    const fx = load('ada-usdcx-1hop') as Fixture
    const d = decodeMinswapV2OrderDatum(Buffer.from(orderDatumHex(fx.buildTx.cbor), 'hex'))
    expect(d.stepKind).toBe('swap-exact-in')
    expect(d.canceller).toEqual({ kind: 'key', hash: SENDER_PAYMENT })
    expect(d.successReceiver.payment.hash).toBe(SENDER_PAYMENT)
    expect(d.swapAmount).toBe(20_000_000n)
    expect(d.minimumReceive).toBe(BigInt(fx.estimate.min_amount_out as string))
    expect(d.routing).toHaveLength(1)
    expect(typeof d.killable).toBe('boolean')
  })

  it('refuses bytes that are not Plutus data instead of guessing', () => {
    expect(() => decodeMinswapV2OrderDatum(new Uint8Array([0x61, 0x41]))).toThrow(MinswapOrderError)   // text "A"
    expect(() => decodeMinswapV2OrderDatum(new Uint8Array([0xd8, 0x79, 0x80, 0x00]))).toThrow(MinswapOrderError) // trailing
  })
})

describe('validateMinswapOrderTx — the recorded live builds', () => {
  for (const [name, fx] of fixtures) {
    it(`accepts ${name} and reads its real costs out of the transaction`, () => {
      const v = validateMinswapOrderTx(fx.buildTx.cbor, expectationFor(fx), walletUtxos, null)
      expect(v.txId).toMatch(/^[0-9a-f]{64}$/)
      expect(v.cost.batcherFeeLovelace).toBe(fx.estimate.total_dex_fee)
      expect(v.cost.depositLovelace).toBe(fx.estimate.deposits)
      expect(BigInt(v.cost.orderMinimumRaw)).toBeGreaterThanOrEqual(BigInt(fx.estimate.min_amount_out as string))
      expect(BigInt(v.cost.txFeeLovelace)).toBeGreaterThan(0n)
      expect(BigInt(v.cost.txFeeLovelace)).toBeLessThan(2_000_000n)
    })
  }

  it('counts ADA sold as ADA spent, alongside the fees and the deposit', () => {
    const fx = load('ada-usdcx-1hop') as Fixture
    const v = validateMinswapOrderTx(fx.buildTx.cbor, expectationFor(fx), walletUtxos, null)
    const expected = 20_000_000n + BigInt(v.cost.txFeeLovelace) + BigInt(v.cost.batcherFeeLovelace)
      + BigInt(v.cost.depositLovelace) + BigInt(v.cost.aggregatorFeeLovelace)
    expect(BigInt(v.cost.adaSpentLovelace)).toBe(expected)
  })
})

describe('validateMinswapOrderTx — refuses anything outside the approved quote', () => {
  const two = load('usdcx-snek-2hop') as Fixture
  const one = load('ada-usdcx-1hop') as Fixture
  const refuse = (tx: string, exp: MinswapOrderExpectation, pattern: RegExp, utxos = walletUtxos, slot: bigint | null = null) => {
    expect(() => validateMinswapOrderTx(tx, exp, utxos, slot)).toThrow(CardanoSwapValidationError)
    expect(() => validateMinswapOrderTx(tx, exp, utxos, slot)).toThrow(pattern)
  }

  it('a "direct script" route (Danogo: pool UTxOs, redeemers, withdraw-zero) is refused outright', () => {
    const fx = load('usdcx-ada-danogo-direct') as Fixture
    const exp: MinswapOrderExpectation = {
      walletAddress: fx.sender, network: 'mainnet', sellUnit: USDCX, sellAmountRaw: '10000000',
      buyUnit: CARDANO_LOVELACE, buyAmountRaw: '38980252', minBuyAmountRaw: '38594307',
      terms: { protocol: 'MinswapV2', path: [USDCX, CARDANO_LOVELACE], batcherFeeLovelace: '0', depositLovelace: '0', aggregatorFeeLovelace: '850000' },
    }
    refuse(fx.buildTx.cbor, exp, /already carries witnesses or scripts/)
  })

  it('proceeds redirected to another address', () => {
    refuse(tamperDatum(one.buildTx.cbor, SENDER_PAYMENT, OTHER_HASH, 3), expectationFor(one), /proceeds to an address that is not this wallet/)
  })

  it('refund redirected to another address', () => {
    refuse(tamperDatum(one.buildTx.cbor, SENDER_PAYMENT, OTHER_HASH, 2), expectationFor(one), /refunds to an address that is not this wallet/)
  })

  it('an order someone else could cancel', () => {
    refuse(tamperDatum(one.buildTx.cbor, SENDER_PAYMENT, OTHER_HASH, 1), expectationFor(one), /someone other than this wallet could cancel/)
  })

  it('a floor below the one the user approved', () => {
    const min = BigInt(one.estimate.min_amount_out as string)
    const enc = (n: bigint) => '1a' + n.toString(16).padStart(8, '0')   // 4-byte uint, same width
    refuse(tamperDatum(one.buildTx.cbor, enc(min), enc(1_000_000n)), expectationFor(one), /minimum received is below/)
  })

  it('an order floor weaker than the quote claims', () => {
    refuse(one.buildTx.cbor, expectationFor(one, { minBuyAmountRaw: String(BigInt(one.estimate.min_amount_out as string) + 1n) }),
      /minimum received is below/)
  })

  it('a different sell amount', () => {
    refuse(one.buildTx.cbor, expectationFor(one, { sellAmountRaw: '19000000' }), /sells a different amount/)
  })

  it('a route that ends at a different token than the one approved', () => {
    const exp = expectationFor(two)
    refuse(two.buildTx.cbor, { ...exp, buyUnit: USDCX, terms: { ...exp.terms, path: [USDCX, SNEK, USDCX] } },
      /quoted route does not run|different token|does not trade|route revisits/)
  })

  it('a quoted path whose intermediate token does not match the pools in the order', () => {
    const exp = expectationFor(two)
    const forged = [exp.terms.path[0], CARDANO_LOVELACE, exp.terms.path[2]]
    refuse(two.buildTx.cbor, { ...exp, terms: { ...exp.terms, path: forged } }, /names a pool that does not trade/)
  })

  it('an aggregator fee paid to an address nobody pinned', () => {
    refuse(two.buildTx.cbor.replace(MINSWAP_AGGREGATOR_FEE_KEY_HASH, OTHER_HASH), expectationFor(two),
      /neither this wallet, the Minswap order script nor its fee address/)
  })

  it('an aggregator fee that differs from the quote', () => {
    const exp = expectationFor(two)
    refuse(two.buildTx.cbor, { ...exp, terms: { ...exp.terms, aggregatorFeeLovelace: '500000' } }, /aggregator fee differs/)
  })

  it('a batcher fee that differs from the quote', () => {
    const exp = expectationFor(two)
    refuse(two.buildTx.cbor, { ...exp, terms: { ...exp.terms, batcherFeeLovelace: '1000000' } }, /batcher fee differs/)
  })

  it('a coin that is not an unspent coin of this wallet', () => {
    const first = [...walletUtxos.keys()].find(k => two.buildTx.cbor.includes(k.split('#')[0]))!
    const fewer = new Map(walletUtxos)
    fewer.delete(first)
    refuse(two.buildTx.cbor, expectationFor(two), /spends a coin that is not an unspent coin of this wallet/, fewer)
  })

  it('a quote for another Cardano network', () => {
    refuse(one.buildTx.cbor, expectationFor(one, { network: 'testnet' }), /different Cardano network/)
  })

  it('an expired transaction, and one valid implausibly long', () => {
    const ttl = BigInt(validateMinswapOrderTx(one.buildTx.cbor, expectationFor(one), walletUtxos, null).cost.validUntilSlot)
    refuse(one.buildTx.cbor, expectationFor(one), /expired/, walletUtxos, ttl)
    refuse(one.buildTx.cbor, expectationFor(one), /unusually long/, walletUtxos, ttl - 7n * 3600n)
  })

  it('a changed network fee (the transaction no longer balances to the quoted costs)', () => {
    const fee = (decodeCbor(splitTxRoot(hexToBytesStrict(one.buildTx.cbor)).body) as CborMap).getInt(2) as bigint
    const enc = (n: bigint) => '021a' + n.toString(16).padStart(8, '0')
    expect(one.buildTx.cbor.split(enc(fee)).length).toBe(2)
    refuse(one.buildTx.cbor.replace(enc(fee), enc(fee + 1n)), expectationFor(one), /does not balance/)
  })

  it('malformed input', () => {
    refuse('zz', expectationFor(one), /not hex/)
    refuse(one.buildTx.cbor.slice(0, -2), expectationFor(one), /truncated|trailing/)
  })
})

describe('signed transaction assembly', () => {
  it('keeps the provider body byte-for-byte, so the id the wallet signed is the id that lands', () => {
    const fx = load('ada-usdcx-1hop') as Fixture
    const parts = splitTxRoot(hexToBytesStrict(fx.buildTx.cbor))
    const witness = cborMap([[cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32)), cborBytes(new Uint8Array(64))])])]])
    const signed = assembleSignedTx(parts, witness)
    const again = splitTxRoot(signed)
    expect(Buffer.from(again.body).equals(Buffer.from(parts.body))).toBe(true)
    expect(Buffer.from(again.auxData).equals(Buffer.from(parts.auxData))).toBe(true)
    expect(Buffer.from(again.witnessSet).equals(Buffer.from(witness))).toBe(true)
    expect(txIdOf(again.body)).toBe(txIdOf(parts.body))
  })
})
