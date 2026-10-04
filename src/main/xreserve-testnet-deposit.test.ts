/**
 * Testnet-only xReserve deposit executor. No network, no keys: every chain
 * operation is a fake that records what the executor asked for. Nothing here
 * proves a live Sepolia → Preprod deposit; that needs a funded testnet run.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { bech32 } from '@scure/base'
import { keccak256, parseTransaction, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  prepareTestnetDeposit, approveTestnetDeposit, checkTestnetApproval, depositTestnet, checkTestnetDeposit,
  getTestnetDepositState, validatePreprodKey, validateCardanoSource, parseUsdc, formatUsdc, mapTrackingStore, __resetTestnetIntents,
  defaultTestnetOps, testnetInboundReads, cardanoSourceOf, recoverTestnetDeposits, dismissCorruptPendingSend,
  TestnetDepositError, TESTNET_INTENT_TTL_MS,
  type TestnetContext, type TestnetOps, type TestnetDepositPreview,
} from './xreserve-testnet-deposit'
import { handleXReserveTestnet, type XReserveTestnetHost } from './xreserve-testnet-handlers'
import { XRESERVE_SEPOLIA_PREPROD as PRE } from './xreserve-network'
import { decodeDepositToRemoteCalldata } from './xreserve-cardano-deposit'
import { inboundTrackingKey, parseInboundTrackingRecord } from './xreserve-inbound-tracking'
import { sendJournalPrefix, parseSendJournal, judgeJournal, NOT_SENT_DEPTH, type SendJournalEntry } from './xreserve-testnet-send-journal'
import type { InboundReads } from './xreserve-inbound-status'
import type { RawEvmTx } from './tx-sender'
import type { WalletConfig } from './secure-store'

const EVM = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const PKH = '1c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9'
const SKH = 'c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b6'.padEnd(56, '0')
const PREPROD_BASE = bech32.encode('addr_test', bech32.toWords(Uint8Array.from([0x00, ...Buffer.from(PKH + SKH, 'hex')])), 1000)
const MAINNET_ADDR = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const KEY = `preprod${'A1b2'.repeat(8)}`
const CONFIG = { testnetMode: true, blockfrostPreprodKey: KEY } as unknown as WalletConfig
const WALLET = { walletId: `${EVM}|SoLaNa`, accountIndex: 0, evmAddress: EVM, cardanoAddress: PREPROD_BASE as string }
const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const USDC = PRE.ethereum.usdc
const XRESERVE = PRE.ethereum.xReserve
const approveData = (amount: bigint) => `0x095ea7b3${XRESERVE.slice(2).toLowerCase().padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`

/**
 * Fake Sepolia: records every call in order. An approval "mines" when its
 * receipt is read as success, which sets the allowance, as approve() would.
 */
class FakeOps implements TestnetOps {
  log: string[] = []
  sent: RawEvmTx[] = []
  usdc: bigint | null = 50_000_000n
  eth: bigint | null = 10n ** 17n
  allowance: bigint | null = 0n
  sim: 'pass' | 'revert' | 'unavailable' = 'pass'
  /** Pending (mempool-inclusive) nonce. A successful send advances it. */
  nonceValue: number | null = 7
  tipHeight: number | Error = 4_100_000
  failSendTo: string | null = null
  failSendAdvancesNonce = false
  receipts: Record<string, 'success' | 'reverted' | 'pending'> = {}
  /** The fake Sepolia: transactions known to the node, by hash. */
  chain = new Map<string, Record<string, unknown>>()
  failSign: Error | null = null
  /** Make signDeposit return bytes for a DIFFERENT call (to prove the read-back check). */
  tamperSigned = false
  /** When the broadcast throws, did the node take it anyway? */
  landsOnFailure = false
  /** Sender's transaction count NOT_SENT_DEPTH blocks under the tip (null = unreadable). */
  usedNonceDeep: number | null = 0
  failTxRead = false
  defaultReceipt: 'success' | 'reverted' | 'pending' = 'success'
  signer = EVM
  private n = 0
  private approvals: Record<string, bigint> = {}
  async readUsdc() { this.log.push('readUsdc'); return this.usdc }
  async readEth() { this.log.push('readEth'); return this.eth }
  async readAllowance() { this.log.push('readAllowance'); return this.allowance }
  async simulate(_from: string, tx: RawEvmTx) {
    this.log.push(`simulate:${tx.to}`)
    return this.sim === 'pass' ? { status: 'pass' as const } : { status: this.sim, reason: 'nope' }
  }
  async nonce() { this.log.push('nonce'); return this.nonceValue }
  async send(tx: RawEvmTx) {
    this.log.push(`send:${tx.to}`)
    if (this.failSendTo === tx.to) {
      if (this.failSendAdvancesNonce && this.nonceValue != null) this.nonceValue++
      throw new Error('socket hang up')
    }
    this.sent.push(tx)
    if (this.nonceValue != null) this.nonceValue++
    const txHash = H(++this.n)
    if (tx.to === USDC) this.approvals[txHash] = BigInt(`0x${(tx.data as string).slice(74)}`)
    return { txHash, explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}` }
  }
  async receipt(hash: string, waitMs: number) {
    this.log.push(`receipt:${hash}:${waitMs}`)
    const r = this.receipts[hash] ?? this.defaultReceipt
    if (r === 'success' && this.approvals[hash] != null) this.allowance = this.approvals[hash]
    return r
  }
  async signDeposit(tx: RawEvmTx & { nonce: number }) {
    this.log.push('sign')
    if (this.failSign) throw this.failSign
    const flipLast = (d: string) => `${d.slice(0, -2)}${d.endsWith('ff') ? '01' : 'ff'}`
    const data = (this.tamperSigned ? flipLast(tx.data as string) : tx.data) as `0x${string}`
    const serialized = await TEST_SIGNER.signTransaction({
      chainId: tx.chainId, nonce: tx.nonce, to: tx.to as `0x${string}`, data, value: 0n,
      gas: 200_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n, type: 'eip1559',
    })
    return { serialized, txHash: keccak256(serialized) }
  }
  private land(serialized: `0x${string}`) {
    const t = parseTransaction(serialized)
    const hash = keccak256(serialized)
    this.chain.set(hash, {
      hash, from: EVM, nonce: `0x${(t.nonce as number).toString(16)}`, to: t.to, chainId: `0x${(t.chainId as number).toString(16)}`,
      value: '0x0', input: t.data, blockNumber: '0x10',
    })
    this.sent.push({ to: getAddress(t.to as string), data: t.data as string, value: '0x0', chainId: t.chainId as number, nonce: t.nonce as number })
    if (this.nonceValue != null) this.nonceValue++
    return hash
  }
  async broadcast(serialized: `0x${string}`) {
    const t = parseTransaction(serialized)
    const to = getAddress(t.to as string)
    this.log.push(`send:${to}`)
    if (this.failSendTo === to) {
      if (this.landsOnFailure) this.land(serialized)
      throw new Error('socket hang up')
    }
    const txHash = this.land(serialized)
    return { txHash, explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}` }
  }
  async transaction(hash: string) {
    this.log.push(`tx:${hash.slice(0, 10)}`)
    if (this.failTxRead) throw new Error('rpc down')
    return this.chain.get(hash) ?? null
  }
  async usedNonceAt() { return this.usedNonceDeep }
  async signerAddress() { return this.signer }
  async cardanoTip() {
    this.log.push('tip')
    if (this.tipHeight instanceof Error) throw this.tipHeight
    return { blockHeight: this.tipHeight }
  }
  sentTo = () => this.sent.map(t => t.to)
  /** Hashes of broadcast deposits, in order. */
  sentHashes = () => [...this.chain.keys()]
}

/** A throwaway test key: signs fake Sepolia deposits locally; never touches a network. */
const TEST_SIGNER = privateKeyToAccount(`0x${'11'.repeat(32)}`)

function setup(over: { config?: WalletConfig; wallet?: Partial<typeof WALLET>; map?: Record<string, string> } = {}) {
  const map: Record<string, string> = over.map ?? {}
  let failSave = false
  /** Fail a save that would add a key matching this (e.g. only the tracking record). */
  let failNewKey: ((key: string) => boolean) | null = null
  const store = mapTrackingStore(async () => ({ ...map }), async (m) => {
    if (failSave) throw new Error('disk full')
    if (failNewKey && Object.keys(m).some(k => !(k in map) && failNewKey!(k))) throw new Error('disk full')
    for (const k of Object.keys(map)) if (!(k in m)) delete map[k]   // a save REPLACES the whole map
    for (const k of Object.keys(m)) map[k] = m[k]
  })
  const ops = new FakeOps()
  const ctx: TestnetContext = {
    config: over.config ?? CONFIG, wallet: { ...WALLET, ...over.wallet }, ops, store, listStored: store.list, now: () => 1_000_000,
  }
  return {
    ctx, ops, map,
    setFailSave: (v: boolean) => { failSave = v },
    failSavesOf: (pred: ((key: string) => boolean) | null) => { failNewKey = pred },
  }
}

const expectedOf = (t: TestnetDepositPreview) => ({ amountRaw: t.amountRaw, maxFeeRaw: t.maxFeeRaw, recipient: t.recipient, sender: t.sender })
const prep = (ctx: TestnetContext, amount = '20', maxFee = '10') => prepareTestnetDeposit({ amount, maxFee }, ctx)

async function code(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { expect(e).toBeInstanceOf(TestnetDepositError); return (e as TestnetDepositError).code }
  throw new Error('expected a TestnetDepositError')
}

beforeEach(() => __resetTestnetIntents())

describe('amounts', () => {
  it('parses and formats USDC with at most 6 decimals', () => {
    expect(parseUsdc('12.5', 'x')).toBe(12_500_000n)
    expect(parseUsdc('0.000001', 'x')).toBe(1n)
    expect(formatUsdc(12_500_000n)).toBe('12.5')
    for (const bad of ['', '1.2345678', '-1', '1e3', ' ', '01', 5 as unknown as string]) {
      expect(() => parseUsdc(bad, 'x')).toThrow(TestnetDepositError)
    }
  })
  it('accepts only Blockfrost Preprod project ids (or empty to clear)', () => {
    expect(validatePreprodKey(` ${KEY} `)).toBe(KEY)
    expect(validatePreprodKey('')).toBe('')
    expect(() => validatePreprodKey('mainnetABCDEFGHIJKLMNOPQRSTUV')).toThrow(/Preprod project id/)
  })
})

describe('mainnet is disabled', () => {
  it('every entry point refuses outside Testnet Mode, before any chain read', async () => {
    const { ctx, ops } = setup({ config: { ...CONFIG, testnetMode: false } })
    expect(await code(prep(ctx, '1', '0.1'))).toBe('not-testnet')
    expect(await code(approveTestnetDeposit('x', ctx))).toBe('not-testnet')
    expect(await code(checkTestnetApproval('x', ctx))).toBe('not-testnet')
    expect(await code(depositTestnet({ intentId: 'x', expected: {} }, ctx))).toBe('not-testnet')
    expect(await code(checkTestnetDeposit({ sourceTxHash: H(1), auditDue: false }, ctx))).toBe('not-testnet')
    expect(ops.log).toEqual([])
    expect((await getTestnetDepositState(ctx)).testnet).toBe(false)
  })

  it('a prepared intent cannot be approved or deposited after leaving Testnet Mode', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    const off = { ...ctx, config: { ...CONFIG, testnetMode: false } }
    expect(await code(approveTestnetDeposit(p.intentId, off))).toBe('not-testnet')
    expect(await code(depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, off))).toBe('not-testnet')
    expect(ops.sent).toEqual([])
  })

  it('a mainnet Cardano address is never a recipient', async () => {
    const { ctx } = setup({ wallet: { cardanoAddress: MAINNET_ADDR } })
    expect(await code(prep(ctx, '1', '0.1'))).toBe('no-wallet')
  })

  it('every transaction sent is a Sepolia transaction to Circle\'s Sepolia contracts', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    await approveTestnetDeposit(p.intentId, ctx)
    const status = await checkTestnetApproval(p.intentId, ctx)
    await depositTestnet({ intentId: p.intentId, expected: expectedOf(status.terms as TestnetDepositPreview) }, ctx)
    expect(ops.sent.map(t => t.chainId)).toEqual([11155111, 11155111])
    expect(ops.sentTo()).toEqual([USDC, XRESERVE])
  })
})

describe('prepare', () => {
  it('previews the wallet\'s own sender and Preprod recipient, sends nothing, and needs a key only for Blockfrost', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    expect(p).toMatchObject({
      sourceChain: 'Ethereum Sepolia', destinationChain: 'Cardano Preprod', sender: EVM, recipient: PREPROD_BASE,
      recipientKind: 'base', amountRaw: '20000000', maxFeeRaw: '10000000', needsApproval: true, expiresAt: 1_000_000 + TESTNET_INTENT_TTL_MS,
    })
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)   // JSON-safe for every bridge
    expect(ops.sent).toEqual([])
    // Keyless Koios is the default: no Blockfrost project id is needed.
    const koios = setup({ config: { ...CONFIG, blockfrostPreprodKey: '' } })
    expect((await prep(koios.ctx)).amountRaw).toBe('20000000')
    // Blockfrost, when chosen, still requires its Preprod project id.
    const bfNoKey = setup({ config: { ...CONFIG, blockfrostPreprodKey: '', xreservePreprodSource: 'blockfrost' } as WalletConfig })
    expect(await code(prep(bfNoKey.ctx))).toBe('preprod-key-missing')
  })

  it('refuses a fee cap not below the amount, too little USDC, or no gas', async () => {
    const { ctx, ops } = setup()
    expect(await code(prep(ctx, '1', '1'))).toBe('invalid-amount')
    ops.usdc = 1_000_000n
    expect(await code(prep(ctx, '2', '0.5'))).toBe('insufficient-usdc')
    ops.usdc = 50_000_000n; ops.eth = 0n
    expect(await code(prep(ctx, '2', '0.5'))).toBe('no-gas')
  })
})

describe('action 1 — the approval, and nothing else', () => {
  it('signs ONLY the exact-amount approval with a pinned nonce, and returns its hash before confirmation', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    ops.log = []
    const a = await approveTestnetDeposit(p.intentId, ctx)
    expect(a).toMatchObject({ state: 'submitted', approvalTxHash: H(1), explorerUrl: `https://sepolia.etherscan.io/tx/${H(1)}`, terms: null })
    expect(ops.sent).toEqual([{ to: USDC, data: approveData(20_000_000n), value: '0x0', chainId: 11155111, nonce: 7 }])
    // No deposit work at all: no simulation, no Cardano tip, no xReserve send.
    expect(ops.log.some(l => l.startsWith('simulate') || l === 'tip' || l === `send:${XRESERVE}`)).toBe(false)
  })

  it('the confirmation check is read-only and returns the deposit terms AGAIN once confirmed', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    await approveTestnetDeposit(p.intentId, ctx)
    ops.receipts[H(1)] = 'pending'
    expect(await checkTestnetApproval(p.intentId, ctx)).toMatchObject({ state: 'pending', approvalTxHash: H(1), terms: null })
    ops.receipts[H(1)] = 'success'
    const c = await checkTestnetApproval(p.intentId, ctx)
    expect(c).toMatchObject({ state: 'confirmed', approvalTxHash: H(1) })
    expect(c.terms).toMatchObject({ intentId: p.intentId, amountRaw: '20000000', maxFeeRaw: '10000000', recipient: PREPROD_BASE, allowanceRaw: '20000000', needsApproval: false })
    expect(ops.sentTo()).toEqual([USDC])   // still only the approval
  })

  it('no automatic deposit: approving, confirming and checking again never send the deposit', async () => {
    const { ctx, ops, map } = setup()
    const p = await prep(ctx)
    await approveTestnetDeposit(p.intentId, ctx)
    for (let i = 0; i < 3; i++) await checkTestnetApproval(p.intentId, ctx)
    // "Closing the panel" is simply never calling depositTestnet.
    expect(ops.sentTo()).toEqual([USDC])
    expect(Object.keys(map)).toEqual([])
    // A new review later sees the approval in place and needs only the deposit click.
    const again = await prep(ctx)
    expect(again.needsApproval).toBe(false)
    expect(ops.sentTo()).toEqual([USDC])
  })

  it('a double click cannot send two approvals', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    const [first, second] = await Promise.allSettled([approveTestnetDeposit(p.intentId, ctx), approveTestnetDeposit(p.intentId, ctx)])
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'busy' } })
    expect(ops.sentTo()).toEqual([USDC])
  })

  it('an allowance already in place needs no approval', async () => {
    const { ctx, ops } = setup(); ops.allowance = 20_000_000n
    const p = await prep(ctx)
    expect(p.needsApproval).toBe(false)
    expect(await approveTestnetDeposit(p.intentId, ctx)).toMatchObject({ state: 'already-sufficient', terms: { needsApproval: false } })
    expect(ops.sent).toEqual([])
  })

  it('an uncertain approval is never re-sent while its nonce may still land, and a resend reuses that nonce', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    ops.failSendTo = USDC; ops.failSendAdvancesNonce = true
    expect(await code(approveTestnetDeposit(p.intentId, ctx))).toBe('approval-uncertain')
    // The node took nonce 7: approving again is refused, nothing new is sent.
    ops.failSendTo = null
    expect(await code(approveTestnetDeposit(p.intentId, ctx))).toBe('approval-pending')
    expect(ops.sent).toEqual([])

    const q = await prep(ctx)
    ops.failSendTo = USDC; ops.failSendAdvancesNonce = false; ops.nonceValue = 12
    expect(await code(approveTestnetDeposit(q.intentId, ctx))).toBe('approval-uncertain')
    // The node never took nonce 12: the retry reuses it, so at most one approval can mine.
    ops.failSendTo = null
    expect(await approveTestnetDeposit(q.intentId, ctx)).toMatchObject({ state: 'submitted' })
    expect(ops.sent.map(t => t.nonce)).toEqual([12])
  })

  it('a pending approval is not re-sent; a reverted one may be retried with a fresh nonce', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    await approveTestnetDeposit(p.intentId, ctx)   // nonce 7, pending nonce now 8
    ops.receipts[H(1)] = 'pending'
    expect(await code(approveTestnetDeposit(p.intentId, ctx))).toBe('approval-pending')
    ops.receipts[H(1)] = 'reverted'
    expect(await checkTestnetApproval(p.intentId, ctx)).toMatchObject({ state: 'failed', terms: null })
    expect(await approveTestnetDeposit(p.intentId, ctx)).toMatchObject({ state: 'submitted', approvalTxHash: H(2) })
    expect(ops.sent.map(t => t.nonce)).toEqual([7, 8])
  })
})

describe('action 2 — the deposit, as its own click', () => {
  async function approved(ctx: TestnetContext) {
    const p = await prep(ctx)
    await approveTestnetDeposit(p.intentId, ctx)
    return (await checkTestnetApproval(p.intentId, ctx)).terms as TestnetDepositPreview
  }

  it('after confirmation: rechecks allowance, reads the tip, simulates, pins the nonce, sends, then tracks', async () => {
    const { ctx, ops, map } = setup()
    const terms = await approved(ctx)
    ops.log = []
    const r = await depositTestnet({ intentId: terms.intentId, expected: expectedOf(terms) }, ctx)
    expect(ops.log).toEqual(['readAllowance', 'readUsdc', 'tip', `simulate:${XRESERVE}`, 'nonce', 'sign', `send:${XRESERVE}`])
    expect(ops.sent[1].nonce).toBe(8)
    expect(decodeDepositToRemoteCalldata(ops.sent[1].data as string)).toMatchObject({ value: 20_000_000n, maxFee: 10_000_000n, remoteDomain: 10004, localToken: USDC })
    expect(r).toMatchObject({ sourceTxHash: ops.sentHashes()[0], approvalTxHash: H(1), tracking: 'started' })
    const stored = parseInboundTrackingRecord(map[inboundTrackingKey({ walletId: WALLET.walletId, accountId: 'account-0', environment: 'testnet' }, r.sourceTxHash)])
    expect(Object.keys(map).filter(k => k.startsWith('xreserve-send:'))).toEqual([])   // journal cleared once tracked
    expect(stored).toMatchObject({
      identity: { environment: 'testnet' }, approvedSender: EVM, sourceTxHash: r.sourceTxHash,
      approved: { recipient: PREPROD_BASE, amountRaw: '20000000', maxFeeRaw: '10000000' },
      cardanoTipAtSubmission: { blockHeight: 4_100_000 }, cursors: { audit: { asset: PRE.cardano.usdcxUnit } },
    })
    expect(JSON.stringify(stored)).not.toMatch(/faadb53b|095ea7b3/)
  })

  it('never approves: a short allowance refuses the deposit with nothing sent', async () => {
    const { ctx, ops } = setup()
    const p = await prep(ctx)
    expect(await code(depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx))).toBe('approval-required')
    ops.allowance = null
    expect(await code(depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx))).toBe('approval-required')
    expect(ops.sent).toEqual([])
  })

  it('with the allowance already in place, the deposit click is the only transaction', async () => {
    const { ctx, ops } = setup(); ops.allowance = 20_000_000n
    const p = await prep(ctx)
    const r = await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx)
    expect(ops.sentTo()).toEqual([XRESERVE])
    expect(r.approvalTxHash).toBeNull()
  })

  it('refuses terms different from the prepared deposit — amount, fee cap, recipient or sender', async () => {
    const { ctx, ops } = setup()
    const terms = await approved(ctx)
    for (const change of [{ amountRaw: '21000000' }, { maxFeeRaw: '1' }, { recipient: MAINNET_ADDR }, { sender: `0x${'11'.repeat(20)}` }, null]) {
      const expected = change ? { ...expectedOf(terms), ...change } : undefined
      expect(await code(depositTestnet({ intentId: terms.intentId, expected }, ctx))).toBe('terms-changed')
    }
    expect(ops.sentTo()).toEqual([USDC])
  })

  it('refuses a different wallet, account or signer at the deposit click', async () => {
    const { ctx, ops } = setup()
    const terms = await approved(ctx)
    expect(await code(depositTestnet({ intentId: terms.intentId, expected: expectedOf(terms) }, { ...ctx, wallet: { ...WALLET, accountIndex: 1 } }))).toBe('identity-changed')
    ops.signer = `0x${'22'.repeat(20)}`
    expect(await code(depositTestnet({ intentId: terms.intentId, expected: expectedOf(terms) }, ctx))).toBe('identity-changed')
    expect(ops.sentTo()).toEqual([USDC])
  })

  it('a failure before sending (tip, simulation) sends nothing and leaves the deposit available', async () => {
    const { ctx, ops } = setup()
    const terms = await approved(ctx)
    const go = () => depositTestnet({ intentId: terms.intentId, expected: expectedOf(terms) }, ctx)
    ops.tipHeight = new Error('429')
    expect(await code(go())).toBe('tip-unavailable')
    ops.tipHeight = 4_100_000; ops.sim = 'revert'
    expect(await code(go())).toBe('simulation-failed')
    ops.sim = 'unavailable'
    expect(await code(go())).toBe('simulation-failed')
    expect(ops.sentTo()).toEqual([USDC])
    ops.sim = 'pass'
    expect(await go()).toMatchObject({ tracking: 'started' })
  })

  it('a deposit is sent at most once: a second click, a double click, or a retry after an uncertain send is refused', async () => {
    const { ctx, ops } = setup()
    const terms = await approved(ctx)
    const go = () => depositTestnet({ intentId: terms.intentId, expected: expectedOf(terms) }, ctx)
    const [a, b] = await Promise.allSettled([go(), go()])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect(await code(go())).toBe('intent-unknown')
    expect(ops.sentTo()).toEqual([USDC, XRESERVE])

    const s2 = setup(); s2.ops.allowance = 20_000_000n; s2.ops.failSendTo = XRESERVE
    const p = await prep(s2.ctx)
    const err = await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, s2.ctx).catch(e => e)
    expect(err).toMatchObject({ code: 'broadcast-uncertain' })
    expect(String(err.message)).toMatch(/nonce 7 .*its hash is 0x[0-9a-f]{64}.*do not send it again/)
    s2.ops.failSendTo = null
    expect(await code(depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, s2.ctx))).toBe('intent-unknown')
    // The recovery record is kept; no tracking record was invented.
    expect(Object.keys(s2.map).map(k => k.split(':')[0])).toEqual(['xreserve-send'])
  })

  it('an intent expires and cannot be reached from another account', async () => {
    const { ctx } = setup()
    const p = await prep(ctx)
    expect(await code(approveTestnetDeposit(p.intentId, { ...ctx, now: () => 1_000_000 + TESTNET_INTENT_TTL_MS + 1 }))).toBe('intent-unknown')
    const q = await prep(ctx)
    expect(await code(approveTestnetDeposit(q.intentId, { ...ctx, wallet: { ...WALLET, accountIndex: 2 } }))).toBe('identity-changed')
    expect(await code(approveTestnetDeposit('not-an-intent', ctx))).toBe('intent-unknown')
  })

  it('with every write failing, the deposit is not broadcast at all', async () => {
    const { ctx, ops, setFailSave } = setup(); ops.allowance = 20_000_000n; setFailSave(true)
    const p = await prep(ctx)
    const r = await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx).catch(e => e)
    // With every write failing, even the recovery record cannot be saved: nothing is broadcast.
    expect(r).toMatchObject({ code: 'journal-save-failed' })
    expect(ops.sent).toEqual([])
  })
})

describe('state and check', () => {
  it('lists only this wallet\'s testnet records, and checks one with this wallet\'s addresses', async () => {
    const { ctx, ops, map } = setup(); ops.allowance = 20_000_000n
    const p = await prep(ctx)
    const sent = await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx)
    map['xreserve-inbound:v1:testnet:someone-else:account-0:0xabc'] = '{}'
    const state = await getTestnetDepositState(ctx)
    expect(state).toMatchObject({ testnet: true, preprodKeySet: true, sender: EVM, recipient: PREPROD_BASE, pendingSends: [] })
    expect(state.deposits.map(d => d.sourceTxHash)).toEqual([sent.sourceTxHash])

    const reads: InboundReads = {
      readEthereumEvidence: async (h) => ({ sourceTxHash: h, evidence: { transaction: null, receipt: null, block: null, tipBlockNumber: '0x10' } }),
      fetchAttestation: async () => { throw new Error('not reached') },
      locatorReader: {} as never, auditReader: {} as never, network: PRE,
    }
    const r = await checkTestnetDeposit({ sourceTxHash: sent.sourceTxHash, auditDue: false }, ctx, reads)
    expect(r).toMatchObject({ kind: 'checked', status: { state: 'source-pending', sourceCode: 'not-found', retryable: true } })
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    const other = await checkTestnetDeposit({ sourceTxHash: sent.sourceTxHash, auditDue: false }, { ...ctx, wallet: { ...WALLET, accountIndex: 3 } }, reads)
    expect(other).toMatchObject({ kind: 'tracking-error', code: 'record-missing' })
  })
})

describe('tracking writes across separate handler calls', () => {
  /** One persisted map with slow reads and writes, as a platform store might be. */
  function slowPlatformStore() {
    let persisted: Record<string, string> = {}
    const pause = () => new Promise(r => setTimeout(r, 10))
    return {
      loadTracking: async () => { await pause(); return { ...persisted } },
      saveTracking: async (m: Record<string, string>) => { await pause(); persisted = { ...m } },
      snapshot: () => persisted,
    }
  }

  it('control: two independent store objects over one map DO lose a record without a shared queue', async () => {
    const platform = slowPlatformStore()
    const a = mapTrackingStore(platform.loadTracking, platform.saveTracking)
    const b = mapTrackingStore(platform.loadTracking, platform.saveTracking)
    await Promise.all([a.save('one', '1'), b.save('two', '2')])
    expect(Object.keys(platform.snapshot())).toHaveLength(1)
  })

  it('two concurrent deposit handler calls both keep their tracking records', async () => {
    const platform = slowPlatformStore()
    const ops = new FakeOps(); ops.allowance = 100_000_000n
    const host: XReserveTestnetHost = {
      loadConfig: async () => CONFIG,
      saveConfig: async () => {},
      loadAddresses: async () => ({ evm: EVM, solana: 'SoLaNa', cardano: PREPROD_BASE, accountIndex: 0 }),
      loadMnemonic: async () => 'test seed (never used by the fake ops)',
      loadTracking: platform.loadTracking,
      saveTracking: platform.saveTracking,
      ops: () => ops,
    }
    const prepared = await Promise.all([
      handleXReserveTestnet('xreserve:testnet-prepare', { amount: '20', maxFee: '10' }, host),
      handleXReserveTestnet('xreserve:testnet-prepare', { amount: '30', maxFee: '10' }, host),
    ])
    const previews = prepared.map(r => { if (!r.ok) throw new Error(r.message); return r.value as TestnetDepositPreview })
    const results = await Promise.all(previews.map(p =>
      handleXReserveTestnet('xreserve:testnet-deposit', { intentId: p.intentId, expected: expectedOf(p) }, host)))
    expect(results.map(r => r.ok && (r.value as { tracking: string }).tracking)).toEqual(['started', 'started'])
    const keys = Object.keys(platform.snapshot()).sort()
    expect(ops.sentHashes()).toHaveLength(2)
    expect(keys).toEqual(ops.sentHashes().map(h => inboundTrackingKey({ walletId: WALLET.walletId, accountId: 'account-0', environment: 'testnet' }, h)).sort())
    const state = await handleXReserveTestnet('xreserve:testnet-state', null, host)
    expect(state.ok && (state.value as { deposits: unknown[] }).deposits).toHaveLength(2)
  })

  it('the handler routes an approval to the approval only', async () => {
    const platform = slowPlatformStore()
    const ops = new FakeOps()
    const host: XReserveTestnetHost = {
      loadConfig: async () => CONFIG, saveConfig: async () => {},
      loadAddresses: async () => ({ evm: EVM, solana: 'SoLaNa', cardano: PREPROD_BASE, accountIndex: 0 }),
      loadMnemonic: async () => 'unused', loadTracking: platform.loadTracking, saveTracking: platform.saveTracking,
      ops: () => ops,
    }
    const p = await handleXReserveTestnet('xreserve:testnet-prepare', { amount: '20', maxFee: '10' }, host)
    if (!p.ok) throw new Error(p.message)
    const a = await handleXReserveTestnet('xreserve:testnet-approve', { intentId: (p.value as TestnetDepositPreview).intentId }, host)
    expect(a).toMatchObject({ ok: true, value: { state: 'submitted' } })
    expect(ops.sentTo()).toEqual([USDC])
    expect(await handleXReserveTestnet('xreserve:testnet-execute', {}, host)).toMatchObject({ ok: false, code: 'unknown-channel' })
  })
})

describe('Cardano Preprod source: keyless Koios by default, Blockfrost on request', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const NO_KEY = { testnetMode: true } as unknown as WalletConfig
  const BLOCKFROST = { testnetMode: true, blockfrostPreprodKey: KEY, xreservePreprodSource: 'blockfrost' } as unknown as WalletConfig

  it('the source defaults to Koios, and only koios/blockfrost are accepted', () => {
    expect(cardanoSourceOf(NO_KEY)).toBe('koios')
    expect(cardanoSourceOf(BLOCKFROST)).toBe('blockfrost')
    expect(validateCardanoSource('blockfrost')).toBe('blockfrost')
    expect(() => validateCardanoSource('mainnet-blockfrost')).toThrow(TestnetDepositError)
  })

  it('with Koios, the pre-submission tip and every Cardano status read go to Koios Preprod through the injected fetch, without a key', async () => {
    const globalFetch = vi.fn(async () => { throw new Error('global fetch must not be used') })
    vi.stubGlobal('fetch', globalFetch)
    const urls: string[] = []
    const fetchFn = async (url: string) => {
      urls.push(url)
      if (url.endsWith('/tip')) return new Response(JSON.stringify([{ block_height: 5238300, block_no: 5238300 }]))
      return new Response('[]')
    }
    expect(await defaultTestnetOps(NO_KEY, null, 0, fetchFn).cardanoTip()).toEqual({ blockHeight: 5238300 })
    const reads = testnetInboundReads(NO_KEY, fetchFn)
    expect(await reads.locatorReader.tip()).toEqual({ blockHeight: 5238300 })
    expect(await reads.auditReader.tip()).toEqual({ blockHeight: 5238300 })
    expect(urls).toEqual(Array(3).fill('https://preprod.koios.rest/api/v1/tip'))
    expect(reads.network).toBe(PRE)
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('with Blockfrost chosen, the tip comes from Blockfrost Preprod with the user\'s project id', async () => {
    const calls: Array<{ url: string; key: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, key: (init?.headers as Record<string, string>).project_id })
      return new Response(JSON.stringify({ height: 5238301 }))
    }))
    expect(await defaultTestnetOps(BLOCKFROST, null, 0).cardanoTip()).toEqual({ blockHeight: 5238301 })
    expect(calls).toEqual([{ url: 'https://cardano-preprod.blockfrost.io/api/v0/blocks/latest', key: KEY }])
  })

  it('state reports the source and whether it is ready; a status check with Koios needs no key', async () => {
    const { ctx } = setup({ config: NO_KEY })
    expect(await getTestnetDepositState(ctx)).toMatchObject({ cardanoSource: 'koios', cardanoSourceReady: true, preprodKeySet: false })
    const bf = setup({ config: { ...BLOCKFROST, blockfrostPreprodKey: '' } as WalletConfig })
    expect(await getTestnetDepositState(bf.ctx)).toMatchObject({ cardanoSource: 'blockfrost', cardanoSourceReady: false })
    expect(await checkTestnetDeposit({ sourceTxHash: H(9), auditDue: false }, bf.ctx)).toMatchObject({ kind: 'tracking-error', code: 'preprod-key-missing' })
    expect(await checkTestnetDeposit({ sourceTxHash: H(9), auditDue: false }, ctx)).toMatchObject({ kind: 'tracking-error', code: 'record-missing' })
  })

  it('the set-source handler validates the choice and works only in Testnet Mode', async () => {
    let saved: Partial<WalletConfig> | null = null
    const host = (config: WalletConfig): XReserveTestnetHost => ({
      loadConfig: async () => config, saveConfig: async (patch) => { saved = patch },
      loadAddresses: async () => ({ evm: EVM, solana: 'SoLaNa', cardano: PREPROD_BASE, accountIndex: 0 }),
      loadMnemonic: async () => 'unused', loadTracking: async () => ({}), saveTracking: async () => {},
    })
    expect(await handleXReserveTestnet('xreserve:testnet-set-source', { source: 'blockfrost' }, host(NO_KEY))).toEqual({ ok: true, value: true })
    expect(saved).toEqual({ xreservePreprodSource: 'blockfrost' })
    expect(await handleXReserveTestnet('xreserve:testnet-set-source', { source: 'nope' }, host(NO_KEY))).toMatchObject({ ok: false, code: 'invalid-source' })
    expect(await handleXReserveTestnet('xreserve:testnet-set-source', { source: 'koios' }, host({ testnetMode: false } as WalletConfig)))
      .toMatchObject({ ok: false, code: 'not-testnet' })
  })
})

// ── Crash recovery ────────────────────────────────────────────────────────────

describe('deposit crash recovery', () => {
  const ID = { walletId: WALLET.walletId, accountId: 'account-0', environment: 'testnet' as const }
  const journalsOf = (map: Record<string, string>) => Object.keys(map).filter(k => k.startsWith(sendJournalPrefix(ID)))
  const trackedOf = (map: Record<string, string>) => Object.keys(map).filter(k => k.startsWith('xreserve-inbound:'))
  /** A "restart": same persisted map, new context, no in-memory intents. */
  const restart = (map: Record<string, string>) => { __resetTestnetIntents(); return setup({ map }) }
  async function prepared(ctx: TestnetContext, ops: FakeOps, amount = '20') {
    ops.allowance = 100_000_000n
    const p = await prep(ctx, amount)
    return () => depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, ctx)
  }

  describe('before broadcast', () => {
    it('if the recovery record cannot be saved, nothing is broadcast, and the same deposit can be retried', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.failSavesOf(k => k.startsWith('xreserve-send:'))
      expect(await code(go())).toBe('journal-save-failed')
      expect(s.ops.sent).toEqual([])
      s.failSavesOf(null)
      expect(await go()).toMatchObject({ tracking: 'started' })
      expect(s.ops.sent).toHaveLength(1)
    })

    it('a signing failure, or signed bytes that are not the approved call, send nothing and record nothing', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSign = new Error('key unavailable')
      expect(await code(go())).toBe('sign-failed')
      s.ops.failSign = null; s.ops.tamperSigned = true
      expect(await code(go())).toBe('sign-failed')
      expect(s.ops.sent).toEqual([])
      expect(journalsOf(s.map)).toEqual([])
    })

    it('the record holds the pre-send tip, nonce and hash — never calldata or signed bytes', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE   // keep the record around to inspect it
      await go().catch(() => null)
      const [key] = journalsOf(s.map)
      const entry = parseSendJournal(s.map[key]) as SendJournalEntry
      expect(entry).toMatchObject({
        sender: EVM, nonce: 7, chainId: 11155111, xReserve: XRESERVE.toLowerCase(), cardanoTipAtSubmission: { blockHeight: 4_100_000 },
        approved: { recipient: PREPROD_BASE, amountRaw: '20000000', maxFeeRaw: '10000000' }, confirmations: { ethereum: 12, cardano: 10 },
      })
      expect(key.endsWith(`:7:${entry.txHash}`)).toBe(true)
      expect(s.map[key]).not.toMatch(/faadb53b|095ea7b3|serialized|0x02f8/)
    })
  })

  describe('uncertain broadcast', () => {
    it('the deposit landed: recovery after a restart finds it by its pre-computed hash and tracks it, once', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE; s.ops.landsOnFailure = true
      const err = await go().catch(e => e)
      expect(err).toMatchObject({ code: 'broadcast-uncertain' })
      const [hash] = s.ops.sentHashes()
      expect(String(err.message)).toContain(hash)
      expect(trackedOf(s.map)).toEqual([])
      expect(journalsOf(s.map)).toHaveLength(1)

      // A new deposit is refused: the pending one used nonce 7 and the next would use 8.
      s.ops.failSendTo = null
      const again = await prepared(s.ctx, s.ops)
      expect(await code(again())).toBe('recovery-pending')
      expect(s.ops.sent).toHaveLength(1)

      // Restart: new context over the same persisted map; intents are gone.
      const r = restart(s.map); r.ops.chain = s.ops.chain
      const state = await getTestnetDepositState(r.ctx)
      expect(state.pendingSends).toMatchObject([{ corrupt: false, nonce: 7, txHash: hash, amountRaw: '20000000' }])
      expect(await recoverTestnetDeposits(r.ctx)).toEqual({ entries: [expect.objectContaining({ verdict: 'found', tracking: 'started', txHash: hash })] })
      expect(journalsOf(s.map)).toEqual([])
      expect(trackedOf(s.map)).toEqual([inboundTrackingKey(ID, hash)])
      expect(parseInboundTrackingRecord(s.map[inboundTrackingKey(ID, hash)])).toMatchObject({ cardanoTipAtSubmission: { blockHeight: 4_100_000 } })
      // Idempotent: nothing left to do, nothing duplicated, nothing sent.
      expect(await recoverTestnetDeposits(r.ctx)).toEqual({ entries: [] })
      expect(trackedOf(s.map)).toHaveLength(1)
      expect(r.ops.sent).toEqual([])
    })

    it('the deposit never reached a node: it stays unresolved, and a new deposit may take its SAME nonce (at most one can land)', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE; s.ops.landsOnFailure = false
      await go().catch(() => null)
      expect(s.ops.nonceValue).toBe(7)
      s.ops.usedNonceDeep = 7
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'unresolved', tracking: null }])
      expect(journalsOf(s.map)).toHaveLength(1)

      // A DIFFERENT deposit at nonce 7 (a replacement): allowed, and recorded under its own key.
      // (The same terms would sign to the identical transaction — the same hash.)
      s.ops.failSendTo = null
      const replacement = await (await prepared(s.ctx, s.ops, '25'))()
      expect(s.ops.sent.map(t => t.nonce)).toEqual([7])
      expect(journalsOf(s.map)).toHaveLength(1)   // the replacement's own journal was cleared once tracked
      // Once nonce 7 is used 12+ blocks deep, the lost one is provably unable to land: cleared, never tracked.
      s.ops.usedNonceDeep = 8
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'not-sent', tracking: null }])
      expect(journalsOf(s.map)).toEqual([])
      expect(trackedOf(s.map)).toEqual([inboundTrackingKey(ID, replacement.sourceTxHash)])
    })

    it('if Sepolia cannot be read, recovery keeps the record and sends nothing', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE; s.ops.landsOnFailure = true
      await go().catch(() => null)
      s.ops.failTxRead = true
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'unresolved' }])
      expect(journalsOf(s.map)).toHaveLength(1)
      expect(s.ops.sent).toHaveLength(1)
    })
  })

  describe('known hash, tracking not saved (crash or write failure after broadcast)', () => {
    it('the deposit result says so; recovery after a restart finishes tracking from the recorded tip', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.failSavesOf(k => k.startsWith('xreserve-inbound:'))
      const r = await go()
      expect(r).toMatchObject({ tracking: 'save-failed', record: null })
      expect(r.trackingReason).toMatch(/recovery record will finish tracking/)
      expect(journalsOf(s.map)).toHaveLength(1)
      expect(trackedOf(s.map)).toEqual([])

      const after = restart(s.map); after.ops.chain = s.ops.chain
      expect((await recoverTestnetDeposits(after.ctx)).entries).toMatchObject([{ verdict: 'found', tracking: 'started', txHash: r.sourceTxHash }])
      expect(trackedOf(s.map)).toEqual([inboundTrackingKey(ID, r.sourceTxHash)])
      expect(journalsOf(s.map)).toEqual([])
      expect(await recoverTestnetDeposits(after.ctx)).toEqual({ entries: [] })
    })

    it('tracking saved but the journal not cleared: recovery clears it without duplicating the record', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      const r = await go()
      // Simulate the crash between the two writes: put the journal back.
      s.ops.failSendTo = XRESERVE
      const key = `${sendJournalPrefix(ID)}7:${r.sourceTxHash}`
      s.map[key] = JSON.stringify({
        v: 1, kind: 'xreserve-send-journal', identity: ID, sender: EVM, chainId: 11155111, xReserve: XRESERVE.toLowerCase(), nonce: 7,
        txHash: r.sourceTxHash, approved: { recipient: PREPROD_BASE, amountRaw: '20000000', maxFeeRaw: '10000000' },
        confirmations: { ethereum: 12, cardano: 10 }, cardanoTipAtSubmission: { blockHeight: 4_100_000 }, createdAt: 1,
      })
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'found', tracking: 'already-tracking' }])
      expect(journalsOf(s.map)).toEqual([])
      expect(trackedOf(s.map)).toHaveLength(1)
    })
  })

  describe('trust in recovered evidence', () => {
    const entry = (): SendJournalEntry => ({
      v: 1, kind: 'xreserve-send-journal', identity: ID, sender: EVM, chainId: 11155111, xReserve: XRESERVE.toLowerCase(), nonce: 7,
      txHash: `0x${'ab'.repeat(32)}`, approved: { recipient: PREPROD_BASE, amountRaw: '20000000', maxFeeRaw: '10000000' },
      confirmations: { ethereum: 12, cardano: 10 }, cardanoTipAtSubmission: { blockHeight: 1 }, createdAt: 1,
    })
    async function matchingTx() {
      const s = setup(); s.ops.allowance = 100_000_000n
      const p = await prep(s.ctx)
      await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, s.ctx)
      const [hash] = s.ops.sentHashes()
      return { tx: { ...s.ops.chain.get(hash) }, hash }
    }

    it('a transaction is accepted only if sender, nonce, contract, chain, value and exact calldata all match', async () => {
      const { tx, hash } = await matchingTx()
      const e = { ...entry(), txHash: hash }
      expect(judgeJournal(e, tx, null)).toEqual({ kind: 'found', pending: false })
      expect(judgeJournal(e, { ...tx, blockNumber: null }, null)).toEqual({ kind: 'found', pending: true })
      const tampered: Array<[string, Record<string, unknown>]> = [
        ['hash', { hash: `0x${'cd'.repeat(32)}` }], ['sender', { from: `0x${'22'.repeat(20)}` }], ['nonce', { nonce: '0x8' }],
        ['destination', { to: USDC }], ['chain', { chainId: '0x1' }], ['value', { value: '0x1' }],
        ['calldata', { input: `${(tx.input as string).slice(0, -2)}${(tx.input as string).endsWith('ff') ? '01' : 'ff'}` }],
      ]
      for (const [field, change] of tampered) expect(judgeJournal(e, { ...tx, ...change }, null)).toEqual({ kind: 'mismatch', field })
    })

    it('"not sent" needs the nonce used deeper than NOT_SENT_DEPTH; anything else stays unresolved', () => {
      expect(NOT_SENT_DEPTH).toBe(12)
      expect(judgeJournal(entry(), null, 8)).toEqual({ kind: 'not-sent' })
      expect(judgeJournal(entry(), null, 7).kind).toBe('unresolved')
      expect(judgeJournal(entry(), null, null).kind).toBe('unresolved')
    })

    it('a mismatching transaction is kept for review and never tracked', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE; s.ops.landsOnFailure = true
      await go().catch(() => null)
      const [hash] = s.ops.sentHashes()
      s.ops.chain.set(hash, { ...s.ops.chain.get(hash), to: USDC })
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'mismatch', tracking: null }])
      expect(journalsOf(s.map)).toHaveLength(1)
      expect(trackedOf(s.map)).toEqual([])
    })

    it('an unreadable record is never dropped silently: it blocks new deposits until removed on purpose', async () => {
      const s = setup()
      s.map[`${sendJournalPrefix(ID)}7:0x${'ab'.repeat(32)}`] = '{"v":1,"kind":"xreserve-send-journal"'
      expect((await getTestnetDepositState(s.ctx)).pendingSends).toMatchObject([{ corrupt: true }])
      expect((await recoverTestnetDeposits(s.ctx)).entries).toMatchObject([{ verdict: 'corrupt' }])
      expect(await code((await prepared(s.ctx, s.ops))())).toBe('recovery-pending')
      const [key] = journalsOf(s.map)
      await dismissCorruptPendingSend(key, s.ctx)
      expect(journalsOf(s.map)).toEqual([])
      expect(await (await prepared(s.ctx, s.ops))()).toMatchObject({ tracking: 'started' })
    })

    it('a readable record cannot be dismissed — only resolved', async () => {
      const s = setup()
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE
      await go().catch(() => null)
      const [key] = journalsOf(s.map)
      expect(await code(dismissCorruptPendingSend(key, s.ctx))).toBe('recovery-pending')
      expect(journalsOf(s.map)).toHaveLength(1)
    })
  })

  describe('prepared intents after a restart', () => {
    it('an old intent is refused with guidance; re-preparing is allowed and reports the pending recovery', async () => {
      const s = setup()
      const p = await prep(s.ctx)
      const go = await prepared(s.ctx, s.ops)
      s.ops.failSendTo = XRESERVE; s.ops.landsOnFailure = true
      await go().catch(() => null)
      const r = restart(s.map); r.ops.chain = s.ops.chain; r.ops.allowance = 100_000_000n; r.ops.nonceValue = 8
      const err = await depositTestnet({ intentId: p.intentId, expected: expectedOf(p) }, r.ctx).catch(e => e)
      expect(err).toMatchObject({ code: 'intent-unknown' })
      expect(String(err.message)).toMatch(/wallet restarted.*pending recovery/)
      const fresh = await prep(r.ctx)
      expect(fresh.pendingRecovery).toBe(1)
      expect(await code(depositTestnet({ intentId: fresh.intentId, expected: expectedOf(fresh) }, r.ctx))).toBe('recovery-pending')
      expect(r.ops.sent).toEqual([])
    })
  })
})
