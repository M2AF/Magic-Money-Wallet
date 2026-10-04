/**
 * The Cardano signing path in the executor. Key derivation and signing are
 * REAL (the standard "abandon … about" test mnemonic); the network edges —
 * reading the wallet's live coins and submitting — are mocked, so nothing here
 * reaches Cardano.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

import { executeSwap, executeBoundSwap } from './swap-executor'
import { deriveCardanoAddress, getCardanoSpendingKey } from './cardano-pure'
import { splitTxRoot, hexToBytesStrict, txIdOf, CardanoSwapValidationError } from './cardano-swap-validate'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { termsFromEstimate } from './minswap-client'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { SwapSigningIdentity } from './swap-intent'
import { bindSwapIntent, buildSwapIdentity, wasSwapIntentBroadcast, __clearSwapIntents } from './swap-intent'
import type { WalletConfig } from './secure-store'
import { setSwapSessionPersistence, __resetSwapSessions, listSessions, prepareCardanoSwapBroadcast } from './swap-sessions'
import type { SettledSwapSessionMap } from '../shared/swap-settlement'

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
  __resetSwapSessions()
  __clearSwapIntents()
  net.checkCardanoSwapTx.mockReset()
  net.cip30SubmitTx.mockReset()
  net.checkCardanoSwapTx.mockResolvedValue({ txId: TX_ID, orderOutputIndex: 0, order: {}, cost: {} })
  net.cip30SubmitTx.mockResolvedValue(TX_ID)
})
afterEach(() => { __resetSwapSessions(); vi.useRealTimers() })

describe('executeSwap — Cardano', () => {
  it('releases an unsent bound intent after storage failure, then prevents replay after submission', async () => {
    const addresses = { evm: '0xwallet', solana: 'solwallet', cardano: OURS, accountIndex: 0 }
    const q = quote()
    const bound = bindSwapIntent({
      fromChain: 'cardano', toChain: 'cardano', fromToken: q.fromTokenAddress, toToken: q.toTokenAddress,
      fromSymbol: 'ADA', toSymbol: 'USDCx', sellAmountRaw: q.sellAmountRaw, slippageBps: 50,
      taker: OURS, toAddress: OURS, fromDecimals: 6, toDecimals: 6,
    }, q, buildSwapIdentity(addresses, 'cardano', 'cardano', false))
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    setSwapSessionPersistence({ load: async () => ({}), save })
    await expect(executeBoundSwap(bound, MNEMONIC, cfg, addresses, false)).rejects.toThrow(/Nothing was sent/)
    expect(wasSwapIntentBroadcast(bound.intentId!)).toBe(false)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
    await expect(executeBoundSwap(bound, MNEMONIC, cfg, addresses, false)).resolves.toMatchObject({ txHash: TX_ID })
    expect(wasSwapIntentBroadcast(bound.intentId!)).toBe(true)
    await expect(executeBoundSwap(bound, MNEMONIC, cfg, addresses, false)).rejects.toThrow(/already been submitted/)
    expect(net.cip30SubmitTx).toHaveBeenCalledTimes(1)
  })

  it('waits for a durable hash record before submitting; a restart retains uncertain receipt evidence', async () => {
    let saved: SettledSwapSessionMap = {}
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const save = vi.fn(async (map: SettledSwapSessionMap) => {
      await gate
      if (save.mock.calls.length > 1) throw new Error('storage failed after submission')
      saved = structuredClone(map)
    })
    const port = { load: async () => saved, save }
    setSwapSessionPersistence(port)
    net.cip30SubmitTx.mockRejectedValue(new Error('socket hang up'))
    const executing = executeSwap(quote(), MNEMONIC, cfg, 0, 'prepared-order', identity())
    const outcome = expect(executing).rejects.toThrow(/do not send it again/)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
    const record = save.mock.calls[0][0]['prepared-order']
    expect(record).toMatchObject({ sourceTxHash: TX_ID, sourceTxState: 'uncertain', state: 'unknown', settlesAfterSource: true })
    const json = JSON.stringify(record)
    for (const secret of [MNEMONIC, fx.buildTx.cbor, 'txData', 'signature']) expect(json).not.toContain(secret)
    release()
    await outcome
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    __resetSwapSessions()
    setSwapSessionPersistence(port)
    expect(await listSessions(identity())).toEqual([expect.objectContaining({ sourceTxHash: TX_ID, sourceTxState: 'uncertain' })])
    expect(net.cip30SubmitTx).toHaveBeenCalledTimes(1)
  })

  it('refuses submission when recovery storage is missing or its write fails', async () => {
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, 'no-store', identity())).rejects.toThrow(/recovery record.*Nothing was sent/)
    setSwapSessionPersistence({ load: async () => ({}), save: async () => { throw new Error('disk full') } })
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, 'failed-write', identity())).rejects.toThrow(/recovery record.*Nothing was sent/)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })

  it('does not overwrite existing evidence when loading it fails, and can retry the read', async () => {
    const save = vi.fn()
    const load = vi.fn().mockRejectedValueOnce(new Error('unreadable')).mockResolvedValue({})
    setSwapSessionPersistence({ load, save })
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, 'read-failed', identity())).rejects.toThrow(/Nothing was sent/)
    expect(save).not.toHaveBeenCalled()
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
    await executeSwap(quote(), MNEMONIC, cfg, 0, 'read-retried', identity())
    expect(load).toHaveBeenCalledTimes(2)
    expect(net.cip30SubmitTx).toHaveBeenCalledTimes(1)
  })

  it('rechecks expiry after a delayed storage acknowledgement', async () => {
    vi.useFakeTimers()
    const q = quote()
    setSwapSessionPersistence({ load: async () => ({}), save: async () => { vi.setSystemTime(q.expiresAt + 1) } })
    await expect(executeSwap(q, MNEMONIC, cfg, 0, 'expired-during-save', identity())).rejects.toThrow(/expired/)
    expect(net.cip30SubmitTx).not.toHaveBeenCalled()
  })

  it('shares the initial read and serializes snapshots so concurrent orders cannot erase each other', async () => {
    let resolveLoad!: (map: object) => void
    const load = vi.fn(() => new Promise<object>(resolve => { resolveLoad = resolve }))
    let releaseFirst!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    let saved: SettledSwapSessionMap = {}
    const save = vi.fn(async (map: SettledSwapSessionMap) => {
      if (Object.keys(map).length === 1) await first
      saved = structuredClone(map)
    })
    setSwapSessionPersistence({ load, save })
    const a = prepareCardanoSwapBroadcast('a', quote(), identity(), { from: 6, to: 6 }, TX_ID, 'https://example.com')
    const b = prepareCardanoSwapBroadcast('b', quote(), identity(), { from: 6, to: 6 }, TX_ID, 'https://example.com')
    expect(load).toHaveBeenCalledTimes(1)
    resolveLoad({})
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(Object.keys(save.mock.calls[0][0])).toEqual(['a'])
    releaseFirst()
    await Promise.all([a, b])
    expect(Object.keys(saved)).toEqual(['a', 'b'])
  })

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
