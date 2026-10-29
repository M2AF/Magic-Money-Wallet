/**
 * Cardano ADA -> Solana through NEAR Intents, in the executor. Key derivation,
 * the Cardano payment and its signature are REAL (the standard "abandon …
 * about" test mnemonic, the wallet's own builder); the network edges — the live
 * 1Click quote, coin selection and submission — are mocked. Nothing reaches a
 * network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

const net = vi.hoisted(() => ({
  prepareCardanoTransfer: vi.fn(),
  submitSignedCardanoTx: vi.fn(),
  liveNearIntentsDeposit: vi.fn(),
  submitOneClickDeposit: vi.fn(),
}))
vi.mock('./tx-sender', async (orig) => ({
  ...(await orig<typeof import('./tx-sender')>()),
  prepareCardanoTransfer: net.prepareCardanoTransfer,
  submitSignedCardanoTx: net.submitSignedCardanoTx,
}))
vi.mock('./near-intents-swap', async (orig) => ({
  ...(await orig<typeof import('./near-intents-swap')>()),
  liveNearIntentsDeposit: net.liveNearIntentsDeposit,
  submitOneClickDeposit: net.submitOneClickDeposit,
}))

import { executeSwap, executeBoundSwap } from './swap-executor'
import { deriveCardanoAddress, getCardanoSpendingKey, buildCardanoTx, decodeCardanoAddress } from './cardano-pure'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { wasSwapIntentBroadcast, __clearSwapIntents, bindSwapIntent, buildSwapIdentity } from './swap-intent'
import { setSwapSessionPersistence, __resetSwapSessions, listSessions } from './swap-sessions'
import { NearIntentsError } from './near-intents-client'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { SwapSigningIdentity } from './swap-intent'
import type { WalletConfig } from './secure-store'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const entropy = mnemonicToEntropy(MNEMONIC, wordlist)
const OURS = deriveCardanoAddress(entropy, 0)
const SOLANA = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'
const DEPOSIT = 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c5'
const STRANGER = 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const AMOUNT = 25_000_000n

function quote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return {
    provider: 'near-intents', fromChain: 'cardano', toChain: 'solana',
    fromTokenAddress: 'lovelace', toTokenAddress: SOL_MINT, fromTokenSymbol: 'ADA', toTokenSymbol: 'SOL',
    sellAmountRaw: AMOUNT.toString(), buyAmountRaw: '50000000', minBuyAmountRaw: '49500000', minReceivedSource: 'provider',
    estimatedGasRaw: '0', slippageBps: 100, priceImpactPct: 0, rate: 0, expiresAt: Date.now() + 60_000,
    isCrossChain: true, toAddress: SOLANA, bridgeTool: 'near-intents',
    appFee: feeFreeRecord('near-intents', 'cardano', 'test'), requestId: null, txData: {},
    nearIntents: { originAsset: 'nep141:cardano.omft.near', destinationAsset: 'nep141:sol.omft.near', slippageBps: 100, refundTo: OURS, recipient: SOLANA, refundFeeLovelace: '200000' },
    ...over,
  }
}
const identity = (over: Partial<SwapSigningIdentity> = {}): SwapSigningIdentity => ({
  walletId: 'w', accountIndex: 0, environment: 'mainnet', sourceAddress: OURS, destinationAddress: SOLANA, ...over,
})
const cfg = {} as WalletConfig
const ADDRESSES = { evm: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', solana: SOLANA, cardano: OURS, accountIndex: 0 }
/** The real path: the quote is bound to the request and this wallet, then executed from the stored copy. */
function bound(q = quote()) {
  const request = { fromChain: 'cardano', toChain: 'solana', fromToken: 'lovelace', toToken: SOL_MINT, fromSymbol: 'ADA', toSymbol: 'SOL',
    sellAmountRaw: q.sellAmountRaw, slippageBps: 100, taker: OURS, toAddress: SOLANA, fromDecimals: 6, toDecimals: 9 } as never
  return bindSwapIntent(request, q, buildSwapIdentity(ADDRESSES, 'cardano', 'solana', false))
}
const run = (q = quote()) => { const b = bound(q); return { intentId: b.intentId as string, done: executeBoundSwap(b, MNEMONIC, cfg, ADDRESSES, false) } }

/** A real, signed payment built by the wallet's own builder. */
function payment(over: { to?: string; amount?: bigint; extraTo?: string } = {}) {
  const spendKey = getCardanoSpendingKey(entropy, 0)
  const built = buildCardanoTx({
    utxos: [{ txHash: 'ab'.repeat(32), txIndex: 0, lovelace: 100_000_000n, assets: [] }],
    toAddress: decodeCardanoAddress(over.to ?? DEPOSIT), changeAddress: decodeCardanoAddress(over.extraTo ?? OURS),
    amountLovelace: over.amount ?? AMOUNT, fee: 200_000n, ttl: 1000n, spendKey,
  })
  return { txCbor: built.txCbor, txHash: built.txHash, fee: built.fee, inputs: [`${'ab'.repeat(32)}#0`] }
}

let saved: unknown[] = []
beforeEach(() => {
  __resetSwapSessions(); __clearSwapIntents(); saved = []
  for (const f of Object.values(net)) f.mockReset()
  setSwapSessionPersistence({ load: async () => ({}), save: async (m) => { saved.push(structuredClone(m)) } })
  net.liveNearIntentsDeposit.mockResolvedValue({ depositAddress: DEPOSIT, deadlineMs: Date.now() + 3 * 86400e3, correlationId: 'c' })
  net.prepareCardanoTransfer.mockImplementation(async () => payment())
  net.submitSignedCardanoTx.mockImplementation(async (_cbor: Uint8Array, txHash: string) => ({ txHash, explorerUrl: 'x' }))
  net.submitOneClickDeposit.mockResolvedValue(undefined)
})
afterEach(() => { __resetSwapSessions() })

describe('executeSwap — Cardano -> Solana via NEAR Intents', () => {
  it('pays exactly the quoted ADA to the live deposit address, saving the record BEFORE submitting, once', async () => {
    let recordAtSubmit: unknown = null
    net.submitSignedCardanoTx.mockImplementation(async (_c: Uint8Array, txHash: string) => {
      recordAtSubmit = (await listSessions(identity({ walletId: `${ADDRESSES.evm.toLowerCase()}|${SOLANA}` }))).find(s => s.sourceTxHash === txHash)
      return { txHash, explorerUrl: 'x' }
    })
    const { intentId, done } = run()
    const r = await done
    const { txHash } = payment()
    expect(r).toMatchObject({ txHash, requestId: DEPOSIT, approvalTxHash: null })
    expect(recordAtSubmit).toMatchObject({ sourceTxHash: txHash, providerRequestId: DEPOSIT, provider: 'near-intents', toChain: 'solana' })
    expect(net.submitSignedCardanoTx).toHaveBeenCalledTimes(1)
    expect(net.prepareCardanoTransfer.mock.calls[0][0]).toMatchObject({ toAddress: DEPOSIT, fromAddress: OURS, amountLovelace: AMOUNT, ttlSlots: 600n })
    expect(net.submitOneClickDeposit).toHaveBeenCalledWith(DEPOSIT, txHash)
    expect(wasSwapIntentBroadcast(intentId)).toBe(true)
  })

  it('a live quote that fails its checks (e.g. the price moved) sends nothing and records nothing', async () => {
    net.liveNearIntentsDeposit.mockRejectedValue(new NearIntentsError('The price moved: the guaranteed minimum is now below what you approved. Refresh the quote.'))
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, 'intent-2', identity())).rejects.toThrow(/price moved.*Nothing was sent/)
    expect(net.prepareCardanoTransfer).not.toHaveBeenCalled()
    expect(net.submitSignedCardanoTx).not.toHaveBeenCalled()
    expect((await listSessions(identity())).find(s => s.id === 'intent-2')).toBeUndefined()
    expect(wasSwapIntentBroadcast('intent-2')).toBe(false)
  })

  it('refuses before any network call when the terms do not name this wallet', async () => {
    await expect(executeSwap(quote({ nearIntents: { ...quote().nearIntents!, refundTo: STRANGER } }), MNEMONIC, cfg, 0, 'i3', identity()))
      .rejects.toThrow(/different Cardano address/)
    await expect(executeSwap(quote(), MNEMONIC, cfg, 0, 'i4', identity({ destinationAddress: 'So11111111111111111111111111111111111111112' })))
      .rejects.toThrow(/not this wallet's own/)
    expect(net.liveNearIntentsDeposit).not.toHaveBeenCalled()
  })

  it('refuses when the signing key does not control the quoted Cardano address', async () => {
    await expect(executeSwap(quote({ nearIntents: { ...quote().nearIntents!, refundTo: STRANGER } }), MNEMONIC, cfg, 0, 'i5', identity({ sourceAddress: STRANGER })))
      .rejects.toThrow(/different Cardano address than the one this wallet would sign with/)
    expect(net.submitSignedCardanoTx).not.toHaveBeenCalled()
  })

  it('refuses a signed payment that is not exactly the quoted deposit', async () => {
    for (const bad of [payment({ amount: AMOUNT - 1n }), payment({ to: STRANGER }), payment({ extraTo: STRANGER })]) {
      net.prepareCardanoTransfer.mockResolvedValueOnce(bad)
      await expect(executeSwap(quote(), MNEMONIC, cfg, 0, `bad-${Math.random()}`, identity())).rejects.toThrow(/exactly the quoted deposit/)
    }
    expect(net.submitSignedCardanoTx).not.toHaveBeenCalled()
  })

  it('an unanswered submission is recorded as uncertain and never resent', async () => {
    net.submitSignedCardanoTx.mockRejectedValue(new Error('timeout'))
    const { intentId, done } = run()
    await expect(done).rejects.toThrow(/do not send it again/)
    expect(net.submitSignedCardanoTx).toHaveBeenCalledTimes(1)
    const s = (await listSessions(identity({ walletId: `${ADDRESSES.evm.toLowerCase()}|${SOLANA}` }))).find(x => x.id === intentId)
    expect(s).toMatchObject({ sourceTxHash: payment().txHash, providerRequestId: DEPOSIT })
    expect(wasSwapIntentBroadcast(intentId)).toBe(true)
    // The same intent can never be executed again.
    await expect(executeBoundSwap({ ...quote(), intentId }, MNEMONIC, cfg, ADDRESSES, false)).rejects.toThrow()
    expect(net.submitSignedCardanoTx).toHaveBeenCalledTimes(1)
  })

  it('refuses a NEAR Intents quote that carries a transaction, or sells a token other than ADA', async () => {
    await expect(executeSwap(quote({ txData: { cbor: 'aa' } }), MNEMONIC, cfg, 0, 'i7', identity())).rejects.toThrow(/must not carry a transaction/)
    await expect(executeSwap(quote({ fromTokenAddress: 'abc' }), MNEMONIC, cfg, 0, 'i8', identity())).rejects.toThrow(/ADA only/)
    expect(net.liveNearIntentsDeposit).not.toHaveBeenCalled()
  })
})
