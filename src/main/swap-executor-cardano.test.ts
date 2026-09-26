/**
 * The Cardano signing path in the executor. Key derivation and signing are
 * REAL (the standard "abandon … about" test mnemonic); the network edges —
 * reading the wallet's live coins and submitting — are mocked, so nothing here
 * reaches Cardano.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { blake2b } from '@noble/hashes/blake2b'

const net = vi.hoisted(() => ({
  checkCardanoSwapTx: vi.fn(),
  cip30SubmitTx: vi.fn(),
}))
vi.mock('./cardano-swap', async (orig) => ({
  ...(await orig<typeof import('./cardano-swap')>()),
  checkCardanoSwapTx: net.checkCardanoSwapTx,
}))
vi.mock('./cardano-cip30', async (orig) => ({
  ...(await orig<typeof import('./cardano-cip30')>()),
  cip30SubmitTx: net.cip30SubmitTx,
}))

import { executeSwap } from './swap-executor'
import { deriveCardanoAddress, getCardanoSpendingKey } from './cardano-pure'
import { splitTxRoot, hexToBytesStrict, txIdOf, CardanoSwapValidationError } from './cardano-swap-validate'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { termsFromEstimate } from './minswap-client'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { SwapSigningIdentity } from './swap-intent'
import type { WalletConfig } from './secure-store'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const entropy = mnemonicToEntropy(MNEMONIC, wordlist)
const OURS = deriveCardanoAddress(entropy, 0)
const keyHash = Buffer.from(blake2b(getCardanoSpendingKey(entropy, 0).pub, { dkLen: 28 })).toString('hex')

const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'minswap', 'ada-usdcx-1hop.json'), 'utf8'))
const terms = termsFromEstimate(fx.estimateRequest, fx.estimate)
const body = splitTxRoot(hexToBytesStrict(fx.buildTx.cbor)).body
const TX_ID = txIdOf(body)

function quote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return {
    provider: 'minswap', fromChain: 'cardano', toChain: 'cardano',
    fromTokenAddress: 'lovelace', toTokenAddress: CARDANO_USDCX_UNIT.mainnet,
    fromTokenSymbol: 'ADA', toTokenSymbol: 'USDCx',
    sellAmountRaw: '20000000', buyAmountRaw: terms.buyAmountRaw, minBuyAmountRaw: terms.minBuyAmountRaw,
    minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 50, priceImpactPct: 0, rate: 0,
    expiresAt: Date.now() + 30_000, isCrossChain: false, toAddress: OURS,
    appFee: feeFreeRecord('minswap', 'cardano', 'no integrator fee'),
    txData: { cbor: fx.buildTx.cbor }, approvalTx: null, cardanoOrder: terms.terms,
    ...over,
  }
}
const identity = (address = OURS): SwapSigningIdentity => ({
  walletId: 'w', accountIndex: 0, environment: 'mainnet', sourceAddress: address, destinationAddress: address,
})
const cfg = {} as WalletConfig

beforeEach(() => {
  net.checkCardanoSwapTx.mockReset()
  net.cip30SubmitTx.mockReset()
  net.checkCardanoSwapTx.mockResolvedValue({ txId: TX_ID, orderOutputIndex: 0, order: {}, cost: {} })
  net.cip30SubmitTx.mockResolvedValue(TX_ID)
})

describe('executeSwap — Cardano', () => {
  it('re-validates against live coins, signs with exactly one payment-key witness, keeps the body verbatim', async () => {
    const r = await executeSwap(quote(), MNEMONIC, cfg, 0, undefined, identity())
    expect(r.txHash).toBe(TX_ID)
    expect(r.explorerUrl).toContain(TX_ID)
    expect(net.checkCardanoSwapTx).toHaveBeenCalledWith(expect.objectContaining({ provider: 'minswap' }), OURS, cfg)

    const signedHex = net.cip30SubmitTx.mock.calls[0][0] as string
    const parts = splitTxRoot(hexToBytesStrict(signedHex))
    expect(Buffer.from(parts.body).equals(Buffer.from(body))).toBe(true)
    const witness = decodeCbor(parts.witnessSet) as CborMap
    const vkeys = witness.getInt(0) as Uint8Array[][]
    expect(witness.size).toBe(1)
    expect(vkeys).toHaveLength(1)
    expect(Buffer.from(blake2b(vkeys[0][0], { dkLen: 28 })).toString('hex')).toBe(keyHash)
  })

  it('refuses when the quote was built for an address this key does not control — nothing is checked or sent', async () => {
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, undefined, identity(fx.sender)))
      .rejects.toThrow(/different Cardano address/)
    expect(net.checkCardanoSwapTx).not.toHaveBeenCalled()
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })

  it('a failed pre-signing check says nothing was sent, and sends nothing', async () => {
    net.checkCardanoSwapTx.mockRejectedValue(new CardanoSwapValidationError('the order pays its proceeds to an address that is not this wallet'))
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, undefined, identity()))
      .rejects.toThrow(/not this wallet\. Nothing was sent/)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })

  it('an expired quote is not signed', async () => {
    await expect(executeSwap(quote({ expiresAt: Date.now() - 1 }), MNEMONIC, cfg, 0, undefined, identity()))
      .rejects.toThrow(/expired/)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })

  it('an uncertain submit names the transaction id and says not to resend', async () => {
    net.cip30SubmitTx.mockRejectedValue(new Error('socket hang up'))
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, undefined, identity()))
      .rejects.toThrow(new RegExp(`${TX_ID}.*do not send it again`))
  })

  it('never signs a quote from another provider or with EVM fields, via the shared structural check', async () => {
    await expect(executeSwap(quote({ provider: 'rango' }), MNEMONIC, cfg, 0, undefined, identity())).rejects.toThrow()
    await expect(executeSwap(quote({ txData: { cbor: fx.buildTx.cbor, to: '0x00' } }), MNEMONIC, cfg, 0, undefined, identity()))
      .rejects.toThrow(/EVM or Solana/)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })
})
