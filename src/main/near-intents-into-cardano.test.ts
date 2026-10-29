/**
 * Into Cardano through NEAR Intents: the quote, the executable-quote checks
 * for a deposit paid on Base or Solana, and the deposit transfer the wallet
 * builds itself. The 1Click quotes are REAL signed responses recorded
 * 2026-10-29 (src/main/__fixtures__/near-intents/into-cardano-quotes.json);
 * keys are derived from the standard test mnemonic; network edges are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { VersionedTransaction, Connection, SystemProgram } from '@solana/web3.js'

const net = vi.hoisted(() => ({
  liveNearIntentsDeposit: vi.fn(),
  submitOneClickDeposit: vi.fn(),
  readEvmSellBalance: vi.fn(),
  getEvmPendingNonce: vi.fn(),
  simulateRawEvmTransaction: vi.fn(),
  sendRawEvmTransaction: vi.fn(),
  waitForEvmReceipt: vi.fn(),
}))
vi.mock('./near-intents-swap', async (orig) => ({
  ...(await orig<typeof import('./near-intents-swap')>()),
  liveNearIntentsDeposit: net.liveNearIntentsDeposit,
  submitOneClickDeposit: net.submitOneClickDeposit,
}))
vi.mock('./tx-sender', async (orig) => ({
  ...(await orig<typeof import('./tx-sender')>()),
  readEvmSellBalance: net.readEvmSellBalance,
  getEvmPendingNonce: net.getEvmPendingNonce,
  simulateRawEvmTransaction: net.simulateRawEvmTransaction,
  sendRawEvmTransaction: net.sendRawEvmTransaction,
  waitForEvmReceipt: net.waitForEvmReceipt,
}))

import {
  checkDepositAddress, checkExecutableQuote, parseOneClickQuoteResponse, verifyOneClickQuoteSignature,
  ONE_CLICK_CARDANO_ADA, __clearOneClickTokenCache, NearIntentsError,
} from './near-intents-client'
import { quoteNearIntentsToCardano } from './near-intents-swap'
import { executeSwap } from './swap-executor'
import { getEvmPrivateKey, getSolanaKeypair } from './wallet-core'
import { privateKeyToAccount } from 'viem/accounts'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { validateSwapQuoteForExecution } from '../shared/swap-execution-checks'
import { decideSwapPolicy } from './swap-policy'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { SwapSigningIdentity } from './swap-intent'
import type { WalletConfig } from './secure-store'

const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'near-intents', 'into-cardano-quotes.json'), 'utf8')) as {
  quotes: Record<string, Record<string, unknown>>; tokens: unknown[]
}
const live = (k: string) => parseOneClickQuoteResponse(fx.quotes[k])
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const BASE_USDC_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
const SOL_ASSET = 'nep141:sol.omft.near'
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const cfg = {} as WalletConfig

describe('deposit addresses, per chain', () => {
  const evm = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
  it('accepts a plain account on Base and Solana, never the wallet itself, the zero address or the system program', () => {
    expect(checkDepositAddress('base', '0xf5A6b76842cE7A0171bD6971992962758af3D5eB', evm)).toBeNull()
    expect(checkDepositAddress('base', evm.toLowerCase(), evm)).toMatch(/own address/)
    expect(checkDepositAddress('base', '0x' + '0'.repeat(40), evm)).toMatch(/not an EVM account/)
    expect(checkDepositAddress('base', 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c5', evm)).toMatch(/not an EVM account/)
    expect(checkDepositAddress('solana', '9fd7ypYudXd7Dd2AQsbGe3sPuHB5B9oyYizBXQLdPbvZ', 'other')).toBeNull()
    expect(checkDepositAddress('solana', '11111111111111111111111111111111', 'other')).toMatch(/not a Solana account/)
    expect(checkDepositAddress('solana', '0xf5A6b76842cE7A0171bD6971992962758af3D5eB', 'other')).toMatch(/not a Solana address/)
  })
})

describe('the live (executable) quote into Cardano', () => {
  const r = live('usdc-base-ada-live')
  const want = {
    originAsset: BASE_USDC_ASSET, originChain: 'base', destinationAsset: ONE_CLICK_CARDANO_ADA, amountLovelace: '5000000', slippageBps: 100,
    refundTo: r.quoteRequest.refundTo as string, recipient: r.quoteRequest.recipient as string, approvedMinOutRaw: r.quote.minAmountOut,
    now: Date.parse(r.timestamp),
  }
  it('verifies, matches the approved terms, and yields a Base deposit address', () => {
    expect(verifyOneClickQuoteSignature(r)).toBe(true)
    expect(checkExecutableQuote(r, want).depositAddress).toBe('0xf5A6b76842cE7A0171bD6971992962758af3D5eB')
    const s = live('sol-ada-live')
    expect(checkExecutableQuote(s, { ...want, originAsset: SOL_ASSET, originChain: 'solana', amountLovelace: '30000000',
      refundTo: s.quoteRequest.refundTo as string, approvedMinOutRaw: s.quote.minAmountOut, now: Date.parse(s.timestamp) }).depositAddress)
      .toBe('9fd7ypYudXd7Dd2AQsbGe3sPuHB5B9oyYizBXQLdPbvZ')
  })
  it('refuses another origin asset, a raised minimum, or a deposit address checked for the wrong chain', () => {
    expect(() => checkExecutableQuote(r, { ...want, originAsset: SOL_ASSET })).toThrow(/does not match/)
    expect(() => checkExecutableQuote(r, { ...want, approvedMinOutRaw: (BigInt(r.quote.minAmountOut) + 1n).toString() })).toThrow(/price moved/)
    expect(() => checkExecutableQuote(r, { ...want, originChain: 'solana' })).toThrow(/not a Solana address/)
  })
})

describe('quoteNearIntentsToCardano', () => {
  beforeEach(() => __clearOneClickTokenCache())
  const dry = fx.quotes['usdc-base-ada-dry'] as { quoteRequest: Record<string, unknown> }
  const fetchFn = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v0/tokens') ? fx.tokens : dry), { status: 200 }))
  const input = { fromChain: 'base', fromToken: BASE_USDC, fromDecimals: 6, fromSymbol: 'USDC', sellAmountRaw: '5000000', slippageBps: 100,
    taker: dry.quoteRequest.refundTo as string, toAddress: dry.quoteRequest.recipient as string }
  it('quotes Base USDC -> ADA with the signed figures, refunds to the source address', async () => {
    const q = await quoteNearIntentsToCardano(input, { fetchFn, now: Date.parse((fx.quotes['usdc-base-ada-dry'] as { timestamp: string }).timestamp) })
    expect(q).toMatchObject({ provider: 'near-intents', fromChain: 'base', toChain: 'cardano', toTokenAddress: 'lovelace', sellAmountRaw: '5000000',
      nearIntents: { originAsset: BASE_USDC_ASSET, destinationAsset: ONE_CLICK_CARDANO_ADA, refundTo: input.taker, recipient: input.toAddress } })
    expect(() => validateSwapQuoteForExecution({ ...q, expiresAt: Date.now() + 30_000 }, Date.now(), c => c === 'base')).not.toThrow()
    expect(decideSwapPolicy({ ...q, expiresAt: Date.now() + 30_000 }).allowed).toBe(true)
  })
  it('refuses a token NEAR does not list on that chain, and a response for someone else', async () => {
    await expect(quoteNearIntentsToCardano({ ...input, fromToken: '0x' + 'ab'.repeat(20) }, { fetchFn })).rejects.toThrow(NearIntentsError)
    await expect(quoteNearIntentsToCardano({ ...input, taker: '0x' + 'cd'.repeat(20) }, { fetchFn })).rejects.toThrow(/does not match/)
  })
})

describe('the deposit transfer the wallet builds and sends', () => {
  let evm = ''
  let sol = ''
  beforeEach(async () => {
    vi.clearAllMocks()
    evm = privateKeyToAccount(await getEvmPrivateKey(MNEMONIC, 0) as `0x${string}`).address
    sol = (await getSolanaKeypair(MNEMONIC, 0)).publicKey.toBase58()
    net.readEvmSellBalance.mockResolvedValue(10n ** 30n)
    net.getEvmPendingNonce.mockResolvedValue(7)
    net.simulateRawEvmTransaction.mockResolvedValue({ status: 'success' })
    net.sendRawEvmTransaction.mockResolvedValue({ txHash: '0x' + 'aa'.repeat(32), explorerUrl: 'https://basescan.org/tx/x' })
    net.waitForEvmReceipt.mockResolvedValue(undefined)
  })
  const DEPOSIT = '0xf5A6b76842cE7A0171bD6971992962758af3D5eB'
  const CARDANO = 'addr1q8008tnk6x22qh7xl38znc5p6c52hp8wtfrxaq0yrer9az8fahsvrvjs2nte6d95crak93gphy32u868qqtx3s4r5dxqxpj8mk'
  const q = (over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote => ({
    provider: 'near-intents', fromChain: 'base', toChain: 'cardano', fromTokenAddress: BASE_USDC, toTokenAddress: 'lovelace',
    fromTokenSymbol: 'USDC', toTokenSymbol: 'ADA', sellAmountRaw: '5000000', buyAmountRaw: '24674970', minBuyAmountRaw: '24440301',
    minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 100, priceImpactPct: 0, rate: 0, expiresAt: Date.now() + 60_000,
    isCrossChain: true, toAddress: CARDANO, bridgeTool: 'near-intents', appFee: feeFreeRecord('near-intents', 'base', 'test'),
    requestId: null, txData: {},
    nearIntents: { originAsset: BASE_USDC_ASSET, destinationAsset: ONE_CLICK_CARDANO_ADA, slippageBps: 100, refundTo: evm, recipient: CARDANO, refundFeeLovelace: null },
    ...over,
  })
  const id = (source: string, over: Partial<SwapSigningIdentity> = {}): SwapSigningIdentity =>
    ({ walletId: 'w', accountIndex: 0, environment: 'mainnet', sourceAddress: source, destinationAddress: CARDANO, ...over })

  it('USDC on Base: an ERC-20 transfer of exactly the amount to the deposit address, then the deposit is reported', async () => {
    net.liveNearIntentsDeposit.mockResolvedValue({ depositAddress: DEPOSIT, deadlineMs: Date.now() + 1e6, correlationId: null })
    const r = await executeSwap(q(), MNEMONIC, cfg, 0, undefined, id(evm))
    const tx = net.sendRawEvmTransaction.mock.calls[0][1]
    expect(tx).toMatchObject({ to: BASE_USDC, value: '0x0', chainId: 8453, nonce: 7 })
    expect(tx.data).toBe('0xa9059cbb' + DEPOSIT.slice(2).toLowerCase().padStart(64, '0') + (5_000_000).toString(16).padStart(64, '0'))
    expect(r.requestId).toBe(DEPOSIT)
    expect(net.submitOneClickDeposit).toHaveBeenCalledWith(DEPOSIT, '0x' + 'aa'.repeat(32))
  })

  it('a native coin: a plain transfer, value = the amount, no calldata', async () => {
    net.liveNearIntentsDeposit.mockResolvedValue({ depositAddress: DEPOSIT, deadlineMs: Date.now() + 1e6, correlationId: null })
    await executeSwap(q({ fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', fromTokenSymbol: 'ETH', sellAmountRaw: '1500000000000000' }),
      MNEMONIC, cfg, 0, undefined, id(evm))
    expect(net.sendRawEvmTransaction.mock.calls[0][1]).toMatchObject({ to: DEPOSIT, data: '0x', value: '0x' + (1_500_000_000_000_000n).toString(16) })
  })

  it('refuses, before any quote or transfer, a refund to another address or a payout not to this wallet', async () => {
    await expect(executeSwap(q(), MNEMONIC, cfg, 0, undefined, id('0x' + 'cd'.repeat(20)))).rejects.toThrow(/different base address/)
    await expect(executeSwap(q(), MNEMONIC, cfg, 0, undefined, id(evm, { destinationAddress: 'addr1other' }))).rejects.toThrow(/not this wallet/)
    expect(net.liveNearIntentsDeposit).not.toHaveBeenCalled()
    expect(net.sendRawEvmTransaction).not.toHaveBeenCalled()
  })

  it('Solana: only SOL, as one SystemProgram transfer of exactly the amount to the deposit, signed by this wallet', async () => {
    const SOL_DEPOSIT = '9fd7ypYudXd7Dd2AQsbGe3sPuHB5B9oyYizBXQLdPbvZ'
    net.liveNearIntentsDeposit.mockResolvedValue({ depositAddress: SOL_DEPOSIT, deadlineMs: Date.now() + 1e6, correlationId: null })
    const sent: Uint8Array[] = []
    vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 })
    vi.spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValue({ context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 1, returnData: null } } as never)
    vi.spyOn(Connection.prototype, 'sendRawTransaction').mockImplementation(async (raw) => { sent.push(raw as Uint8Array); return 'sig1' })
    vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue({ context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'confirmed', slot: 1, confirmations: 1 }] } as never)
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(10_000_000_000)
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) =>
      keys.map(() => ({ lamports: 10_000_000_000, owner: SystemProgram.programId, data: Buffer.alloc(0), executable: false, rentEpoch: 0 })) as never)
    const solQuote = q({ fromChain: 'solana', fromTokenAddress: 'So11111111111111111111111111111111111111112', fromTokenSymbol: 'SOL', sellAmountRaw: '30000000',
      appFee: feeFreeRecord('near-intents', 'solana', 'test'),
      nearIntents: { originAsset: SOL_ASSET, destinationAsset: ONE_CLICK_CARDANO_ADA, slippageBps: 100, refundTo: sol, recipient: CARDANO, refundFeeLovelace: null } })
    const r = await executeSwap(solQuote, MNEMONIC, cfg, 0, undefined, id(sol))
    expect(r).toMatchObject({ txHash: 'sig1', requestId: SOL_DEPOSIT })
    const tx = VersionedTransaction.deserialize(sent[0])
    const keys = tx.message.staticAccountKeys.map(k => k.toBase58())
    expect(keys[0]).toBe(sol)
    expect(tx.message.compiledInstructions).toHaveLength(1)
    const ix = tx.message.compiledInstructions[0]
    expect(keys[ix.programIdIndex]).toBe(SystemProgram.programId.toBase58())
    expect(keys[ix.accountKeyIndexes[1]]).toBe(SOL_DEPOSIT)
    expect(Buffer.from(ix.data).readBigUInt64LE(4)).toBe(30_000_000n)

    await expect(executeSwap({ ...solQuote, fromTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }, MNEMONIC, cfg, 0, undefined, id(sol)))
      .rejects.toThrow(/SOL only/)
  })
})
