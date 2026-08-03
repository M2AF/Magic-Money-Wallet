/**
 * Regression tests for the native-asset burn.
 *
 * Sending plain ADA from a UTxO that also held tokens used to destroy them:
 * the asset was present on the input and absent from every output, so the
 * ledger burned it. These tests assert the built transaction balances
 * per-asset, by decoding the real CBOR rather than trusting the builder.
 */

import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { describe, expect, it } from 'vitest'
import {
  buildCardanoTx,
  decodeCardanoAddress,
  deriveCardanoAddress,
  getCardanoSpendingKey,
  minAdaForOutput,
  sumAssets,
  type CardanoUtxo,
} from './cardano-pure'
import { extractTxBody } from './cardano-cip30'
import { decodeTxBody } from './cardano-tx-inspect'

const MNEMONIC = 'test test test test test test test test test test test junk'
const ENTROPY = mnemonicToEntropy(MNEMONIC, wordlist)
const SPEND_KEY = getCardanoSpendingKey(ENTROPY)
const OWN = decodeCardanoAddress(deriveCardanoAddress(ENTROPY))
const FOREIGN = (() => { const b = Uint8Array.from(OWN); b[1] ^= 0xff; return b })()

const POLICY = 'a'.repeat(56)
const NFT = POLICY + '4e4654'        // "NFT"
const TOKEN = POLICY + '534e454b'    // "SNEK"

function utxo(lovelace: bigint, assets: CardanoUtxo['assets'] = [], hashByte = 0xab): CardanoUtxo {
  return { txHash: hashByte.toString(16).repeat(32), txIndex: 0, lovelace, assets }
}

/** Decode the built transaction the same way the ledger would read it. */
function outputsOf(txCbor: Uint8Array) {
  return decodeTxBody(extractTxBody(new Uint8Array(txCbor))).outputs
}

const build = (utxos: CardanoUtxo[], amount: bigint, extra: Partial<Parameters<typeof buildCardanoTx>[0]> = {}) =>
  buildCardanoTx({
    utxos, toAddress: FOREIGN, changeAddress: OWN,
    amountLovelace: amount, fee: 200_000n, spendKey: SPEND_KEY, ...extra,
  })

describe('native asset preservation', () => {
  it('returns an NFT to the change output when sending plain ADA', () => {
    const { txCbor } = build([utxo(10_000_000n, [{ unit: NFT, quantity: 1n }])], 3_000_000n)
    const outputs = outputsOf(txCbor)

    expect(outputs).toHaveLength(2)
    // Recipient gets ADA only — never the sender's NFT.
    expect(outputs[0].value.assets).toEqual([])
    expect(outputs[0].value.lovelace).toBe(3_000_000n)

    // The NFT comes back. Before the fix this array was empty and it was burned.
    const change = outputs[1]
    expect(change.value.assets).toHaveLength(1)
    expect(change.value.assets[0].unit).toBe(NFT)
    expect(change.value.assets[0].quantity).toBe(1n)
    expect(change.value.lovelace).toBe(10_000_000n - 3_000_000n - 200_000n)
  })

  it('preserves multiple assets across multiple inputs', () => {
    const { txCbor } = build([
      utxo(6_000_000n, [{ unit: NFT, quantity: 1n }], 0x11),
      utxo(6_000_000n, [{ unit: TOKEN, quantity: 500n }], 0x22),
    ], 3_000_000n)

    const change = outputsOf(txCbor)[1]
    const byUnit = Object.fromEntries(change.value.assets.map(a => [a.unit, a.quantity]))
    expect(byUnit[NFT]).toBe(1n)
    expect(byUnit[TOKEN]).toBe(500n)
  })

  it('merges duplicate units from separate UTxOs into one change entry', () => {
    const { txCbor } = build([
      utxo(6_000_000n, [{ unit: TOKEN, quantity: 300n }], 0x11),
      utxo(6_000_000n, [{ unit: TOKEN, quantity: 200n }], 0x22),
    ], 3_000_000n)

    const assets = outputsOf(txCbor)[1].value.assets
    expect(assets).toHaveLength(1)
    expect(assets[0].quantity).toBe(500n)
  })

  it('sends a token to the recipient and returns only the remainder', () => {
    const { txCbor } = build(
      [utxo(10_000_000n, [{ unit: TOKEN, quantity: 500n }])],
      2_000_000n,
      { sendAssets: [{ unit: TOKEN, quantity: 200n }] },
    )
    const outputs = outputsOf(txCbor)
    expect(outputs[0].value.assets).toEqual([
      expect.objectContaining({ unit: TOKEN, quantity: 200n }),
    ])
    expect(outputs[1].value.assets).toEqual([
      expect.objectContaining({ unit: TOKEN, quantity: 300n }),
    ])
  })

  it('omits the change entry for a token that is fully sent', () => {
    const { txCbor } = build(
      [utxo(10_000_000n, [{ unit: NFT, quantity: 1n }])],
      2_000_000n,
      { sendAssets: [{ unit: NFT, quantity: 1n }] },
    )
    const outputs = outputsOf(txCbor)
    expect(outputs[0].value.assets).toHaveLength(1)
    expect(outputs[1].value.assets).toEqual([])
  })

  it('refuses to send more of a token than the inputs hold', () => {
    expect(() => build(
      [utxo(10_000_000n, [{ unit: TOKEN, quantity: 100n }])],
      1_000_000n,
      { sendAssets: [{ unit: TOKEN, quantity: 500n }] },
    )).toThrow(/Insufficient token balance/)
  })

  it('REFUSES to build rather than dropping asset-bearing change', () => {
    // Change here is far below the min-ADA an asset-bearing output needs.
    // The old code silently dropped the output, burning the NFT with it.
    expect(() => build(
      [utxo(3_500_000n, [{ unit: NFT, quantity: 1n }])],
      3_290_000n,
    )).toThrow(/Cannot return 1 native asset/)
  })

  it('still absorbs pure-ADA dust into the fee', () => {
    // No assets at stake, so dropping sub-min-ADA change is safe and expected.
    const { txCbor } = build([utxo(3_500_000n)], 3_290_000n)
    const outputs = outputsOf(txCbor)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].value.lovelace).toBe(3_290_000n)
  })
})

describe('transaction body', () => {
  it('sets a TTL when one is supplied', () => {
    const { txCbor } = build([utxo(10_000_000n)], 1_000_000n, { ttl: 123_456_789n })
    expect(decodeTxBody(extractTxBody(new Uint8Array(txCbor))).ttl).toBe(123_456_789n)
  })

  it('omits the TTL when the chain tip is unavailable', () => {
    const { txCbor } = build([utxo(10_000_000n)], 1_000_000n)
    expect(decodeTxBody(extractTxBody(new Uint8Array(txCbor))).ttl).toBeUndefined()
  })

  it('uses the fee it was given, not a hardcoded one', () => {
    const { txCbor, fee } = build([utxo(10_000_000n)], 1_000_000n, { fee: 187_654n })
    expect(fee).toBe(187_654n)
    expect(decodeTxBody(extractTxBody(new Uint8Array(txCbor))).fee).toBe(187_654n)
  })

  it('rejects inputs that cannot cover amount + fee', () => {
    expect(() => build([utxo(1_000_000n)], 2_000_000n)).toThrow(/Insufficient funds/)
  })
})

describe('min-ADA', () => {
  it('requires more for an asset-bearing output than a bare one', () => {
    const bare = minAdaForOutput(OWN, [], 4310n)
    const withNft = minAdaForOutput(OWN, [{ unit: NFT, quantity: 1n }], 4310n)
    expect(withNft).toBeGreaterThan(bare)
    // Sanity: the old flat 1 ADA floor is not enough for a token output.
    expect(bare).toBeLessThan(1_500_000n)
  })

  it('grows with the number of distinct assets', () => {
    const one = minAdaForOutput(OWN, [{ unit: NFT, quantity: 1n }], 4310n)
    const two = minAdaForOutput(OWN, [
      { unit: NFT, quantity: 1n },
      { unit: TOKEN, quantity: 5n },
    ], 4310n)
    expect(two).toBeGreaterThan(one)
  })
})

describe('sumAssets', () => {
  it('collapses units and drops non-positive quantities', () => {
    expect(sumAssets([
      utxo(0n, [{ unit: TOKEN, quantity: 3n }], 0x11),
      utxo(0n, [{ unit: TOKEN, quantity: 4n }, { unit: NFT, quantity: 0n }], 0x22),
    ])).toEqual([{ unit: TOKEN, quantity: 7n }])
  })

  it('tolerates a UTxO with no assets field', () => {
    expect(sumAssets([{ txHash: 'ab'.repeat(32), txIndex: 0, lovelace: 1n } as CardanoUtxo])).toEqual([])
  })
})
