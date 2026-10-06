/**
 * cbada-ccip-send.ts — Base -> Solana cbADA over Chainlink CCIP: BUILD,
 * VALIDATE and SIMULATE only (privileged layer). There is no signing or
 * broadcasting code here; CBADA_CCIP_EXECUTION_ENABLED is false and nothing
 * reads a key.
 *
 * What a future execution unit will reuse, in order:
 *   1. buildCbAdaBaseToSolana      exact-amount approval (only if needed) + ccipSend
 *   2. validateCbAdaSendTxs         every byte of both transactions re-derived and pinned
 *   3. simulateCbAdaSend            balances, allowance, lane and an eth_call of each tx
 *   4. recordSignedBridgeSend       the signed tx hash persisted to the journey BEFORE broadcast
 *   5. messageIdFromReceipt /       the CCIP message id read from the CONFIRMED
 *      recoverBridgeReference       transaction's OnRamp event, and recovered by tx
 *                                   hash after an interruption — never required up front
 *   6. verifySolanaCbAdaDelivery    the Solana execution checked independently: the
 *                                   OffRamp's own event for this message id in state
 *                                   Success, and the recipient's exact cbADA credit
 *
 * Sources: CCIP EVM OnRamp v1.6+ `CCIPMessageSent` (its topic matched live Base
 * logs, 2026-10-05); Solana OffRamp IDL v1.6.4 (chainlink-ccip
 * chains/solana/contracts/target/idl/ccip_offramp.json): ExecutionStateChanged
 * {sourceChainSelector u64, sequenceNumber u64, messageId [32], messageHash [32],
 * state: Untouched|InProgress|Success|Failure}, SkippedAlreadyExecutedMessage
 * {sourceChainSelector u64, sequenceNumber u64}; Anchor event discriminator =
 * sha256("event:<Name>")[0..8], confirmed against a live Skipped event.
 */

import { sha256 } from '@noble/hashes/sha256'
import {
  decodeEventLog, decodeFunctionData, encodeFunctionData, parseAbi, parseAbiItem, getAddress,
  type Hex, type PublicClient,
} from 'viem'
import { base58, base64 } from '@scure/base'
import { CBADA, svmTokenTransferExtraArgs } from './cbada-ccip'
import { recordLegSubmitted, recordLegProviderRef, type StablecoinJourney } from '../shared/stablecoin-journey'
import type { JourneyStore } from './journey-store'

/** No path in this module signs or sends. A future unit flips this only with its own validation. */
export const CBADA_CCIP_EXECUTION_ENABLED = false

/** Observed Base OnRamp for the Solana lane (router.getOnRamp, 2026-10-05). Re-read before use. */
export const BASE_SOLANA_ONRAMP = '0xee85aEfb15b9489563A6a29891ebe0750AA1A7Ae'
/** Solana CCIP OffRamp program, observed executing Base messages (2026-10-05). */
export const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'

export class CcipSendError extends Error {}
const fail = (why: string): never => { throw new CcipSendError(why) }

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
const ROUTER = parseAbi([
  'function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)',
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)',
  'function isChainSupported(uint64) view returns (bool)',
  'function getOnRamp(uint64) view returns (address)',
])
const POOL = parseAbi([
  'function isSupportedChain(uint64) view returns (bool)',
  'function getToken() view returns (address)',
  'function getCurrentRateLimiterState(uint64 remoteChainSelector, bool fastFinality) view returns ((uint128 tokens, uint32 lastUpdated, bool isEnabled, uint128 capacity, uint128 rate) outboundRateLimiterState, (uint128 tokens, uint32 lastUpdated, bool isEnabled, uint128 capacity, uint128 rate) inboundRateLimiterState)',
])
export const CCIP_MESSAGE_SENT = parseAbiItem('event CCIPMessageSent(uint64 indexed destChainSelector, uint64 indexed sequenceNumber, ((bytes32 messageId, uint64 sourceChainSelector, uint64 destChainSelector, uint64 sequenceNumber, uint64 nonce) header, address sender, bytes data, bytes receiver, bytes extraArgs, address feeToken, uint256 feeTokenAmount, uint256 feeValueJuels, (address sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint256 amount, bytes destExecData)[] tokenAmounts) message)')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO32 = ('0x' + '00'.repeat(32)) as Hex
const toHexStr = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const MINT_BYTES = ('0x' + toHexStr(base58.decode(CBADA.solana.token))) as Hex
const lower = (s: string) => s.toLowerCase()

export interface EvmTx { to: string; data: string; value: string }
export interface CbAdaSendTerms {
  /** This wallet's Base address (the CCIP sender and approval owner). */
  sender: string
  solanaRecipient: string
  amountRaw: string
  /** The router's quoted fee in wei, paid as msg.value (CCIP does not refund overpayment). */
  feeWei: string
}

function uint(v: string, what: string): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v)) return fail(`${what} is not an integer`)
  return BigInt(v)
}

function message(terms: CbAdaSendTerms) {
  return {
    receiver: ZERO32, data: '0x' as Hex,
    tokenAmounts: [{ token: getAddress(CBADA.base.token), amount: uint(terms.amountRaw, 'amount') }],
    feeToken: ZERO_ADDRESS as Hex, extraArgs: svmTokenTransferExtraArgs(terms.solanaRecipient),
  }
}

/** Build the transactions. The approval is for the EXACT amount and only when the allowance is short. */
export function buildCbAdaBaseToSolana(terms: CbAdaSendTerms, currentAllowance: bigint): { approve: EvmTx | null; send: EvmTx } {
  const amount = uint(terms.amountRaw, 'amount')
  if (amount <= 0n) fail('Nothing to send.')
  return {
    approve: currentAllowance >= amount ? null : {
      to: getAddress(CBADA.base.token),
      data: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [getAddress(CBADA.base.router), amount] }),
      value: '0',
    },
    send: {
      to: getAddress(CBADA.base.router),
      data: encodeFunctionData({ abi: ROUTER, functionName: 'ccipSend', args: [CBADA.solana.selector, message(terms)] }),
      value: uint(terms.feeWei, 'fee').toString(),
    },
  }
}

export interface ValidatedCbAdaSend { amountRaw: string; feeWei: string; recipient: string; approves: boolean }

/**
 * Re-derive and pin every field of both transactions. Anything else — another
 * token, spender, router, lane, recipient, amount, fee token, payload, an
 * unlimited approval, or a fee above `maxFeeWei` — is refused.
 */
export function validateCbAdaSendTxs(txs: { approve: EvmTx | null; send: EvmTx }, terms: CbAdaSendTerms, maxFeeWei: bigint): ValidatedCbAdaSend {
  const amount = uint(terms.amountRaw, 'amount')
  const fee = uint(terms.feeWei, 'fee')
  if (amount <= 0n || amount > CBADA.laneCapacityRaw) fail('The amount is outside the lane\'s limits.')
  if (fee <= 0n || fee > maxFeeWei) fail('The CCIP fee exceeds the approved ceiling.')
  if (txs.approve) {
    const a = txs.approve
    if (lower(a.to) !== lower(CBADA.base.token) || a.value !== '0') fail('The approval is not for cbADA.')
    let call
    try { call = decodeFunctionData({ abi: ERC20, data: a.data as Hex }) } catch { return fail('The approval is not an ERC-20 approve.') }
    if (call.functionName !== 'approve') fail('The approval is not an ERC-20 approve.')
    const [spender, value] = call.args as [string, bigint]
    if (lower(spender) !== lower(CBADA.base.router)) fail('The approval names a spender other than the CCIP router.')
    if (value !== amount) fail('The approval is not for exactly the amount being sent.')
    if (encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [spender as Hex, value] }) !== lower(a.data)) fail('The approval carries extra bytes.')
  }
  const s = txs.send
  if (lower(s.to) !== lower(CBADA.base.router)) fail('The send is not to the pinned CCIP router.')
  if (uint(s.value, 'value') !== fee) fail('The send pays a different fee than quoted.')
  let call
  try { call = decodeFunctionData({ abi: ROUTER, data: s.data as Hex }) } catch { return fail('The send is not a ccipSend.') }
  if (call.functionName !== 'ccipSend') fail('The send is not a ccipSend.')
  const [selector, msg] = call.args as [bigint, ReturnType<typeof message>]
  if (selector !== CBADA.solana.selector) fail('The send targets a lane other than Base -> Solana.')
  const want = message(terms)
  if (lower(msg.receiver) !== ZERO32 || lower(msg.data) !== '0x') fail('The send carries a receiver program or payload.')
  if (lower(msg.feeToken) !== ZERO_ADDRESS) fail('The send pays its fee in a token, not ETH.')
  if (msg.tokenAmounts.length !== 1 || lower(msg.tokenAmounts[0].token) !== lower(CBADA.base.token) || msg.tokenAmounts[0].amount !== amount) {
    fail('The send moves a different token or amount.')
  }
  if (lower(msg.extraArgs) !== lower(want.extraArgs)) fail('The send delivers to a different Solana recipient or with different arguments.')
  if (encodeFunctionData({ abi: ROUTER, functionName: 'ccipSend', args: [selector, msg] }) !== lower(s.data)) fail('The send carries extra bytes.')
  return { amountRaw: amount.toString(), feeWei: fee.toString(), recipient: terms.solanaRecipient, approves: !!txs.approve }
}

export interface SimulationReport {
  lane: { routerSupports: boolean; poolSupports: boolean; onRamp: string | null; onRampPinned: boolean }
  /** Live Base -> Solana default outbound bucket, in cbADA base units. */
  outboundRateLimit: { enabled: boolean; availableRaw: string; capacityRaw: string } | null
  cbAdaBalance: string
  ethBalance: string
  allowance: string
  approveSimulated: 'ok' | 'reverted' | 'not-needed'
  /** 'needs-approval': the send can only be simulated once the approval exists. */
  sendSimulated: 'ok' | 'reverted' | 'needs-approval'
  /** From eth_call. Indicative only: the real id comes from the confirmed transaction. */
  simulatedMessageId: string | null
  problems: string[]
}

/**
 * Read-only checks and eth_call simulation against current Base state.
 * `gasReserveWei` is the ETH the caller must keep for network gas on top of the
 * CCIP fee (the approved maximum gas cost of every transaction still to send).
 * Anything that cannot be read is a problem: this check fails closed.
 */
export async function simulateCbAdaSend(
  client: PublicClient, txs: { approve: EvmTx | null; send: EvmTx }, terms: CbAdaSendTerms, gasReserveWei: bigint,
): Promise<SimulationReport> {
  const sender = getAddress(terms.sender)
  const read = <T>(p: Promise<T>) => p.catch(() => null)
  const [routerSupports, onRamp, poolSupports, poolToken, rateState, cb, eth, allowance] = await Promise.all([
    read(client.readContract({ address: getAddress(CBADA.base.router), abi: ROUTER, functionName: 'isChainSupported', args: [CBADA.solana.selector] })),
    read(client.readContract({ address: getAddress(CBADA.base.router), abi: ROUTER, functionName: 'getOnRamp', args: [CBADA.solana.selector] })),
    read(client.readContract({ address: getAddress(CBADA.base.pool), abi: POOL, functionName: 'isSupportedChain', args: [CBADA.solana.selector] })),
    read(client.readContract({ address: getAddress(CBADA.base.pool), abi: POOL, functionName: 'getToken' })),
    read(client.readContract({ address: getAddress(CBADA.base.pool), abi: POOL, functionName: 'getCurrentRateLimiterState', args: [CBADA.solana.selector, false] })),
    read(client.readContract({ address: getAddress(CBADA.base.token), abi: ERC20, functionName: 'balanceOf', args: [sender] })),
    read(client.getBalance({ address: sender })),
    read(client.readContract({ address: getAddress(CBADA.base.token), abi: ERC20, functionName: 'allowance', args: [sender, getAddress(CBADA.base.router)] })),
  ])
  const problems: string[] = []
  const amount = BigInt(terms.amountRaw)
  if (routerSupports !== true) problems.push('The router does not report the Solana lane as supported.')
  if (poolSupports !== true) problems.push('The cbADA pool does not report the Solana lane.')
  if (poolToken === null || lower(poolToken) !== lower(CBADA.base.token)) problems.push('The token of the cbADA pool could not be confirmed as cbADA.')
  const bucket = rateState?.[0]
  const rateValid = !!bucket && typeof bucket.tokens === 'bigint' && typeof bucket.capacity === 'bigint'
    && typeof bucket.isEnabled === 'boolean' && bucket.tokens >= 0n && bucket.capacity >= 0n
    && bucket.tokens <= bucket.capacity
  if (!rateValid) problems.push('The live Base to Solana outbound rate limit could not be read.')
  else if (bucket.isEnabled && (bucket.capacity < amount || bucket.tokens < amount)) {
    problems.push('The live Base to Solana outbound rate limit has insufficient capacity for this transfer.')
  }
  const onRampPinned = !!onRamp && lower(onRamp) === lower(BASE_SOLANA_ONRAMP)
  if (!onRampPinned) problems.push('The router names a different OnRamp than the one this wallet reads message ids from.')
  if (cb === null || cb < amount) problems.push('The wallet does not hold enough cbADA on Base.')
  if (gasReserveWei < 0n) problems.push('No network-gas reserve was given.')
  if (eth === null || eth < BigInt(terms.feeWei) + gasReserveWei) problems.push('The wallet does not hold enough ETH on Base for the CCIP fee plus the approved maximum network gas.')

  let approveSimulated: SimulationReport['approveSimulated'] = 'not-needed'
  if (txs.approve) {
    approveSimulated = await client.call({ account: sender, to: txs.approve.to as Hex, data: txs.approve.data as Hex }).then(() => 'ok' as const, () => 'reverted' as const)
    if (approveSimulated === 'reverted') problems.push('The approval would revert.')
  }
  let sendSimulated: SimulationReport['sendSimulated'] = 'needs-approval'
  let simulatedMessageId: string | null = null
  if ((allowance ?? 0n) >= amount) {
    const r = await client.call({ account: sender, to: txs.send.to as Hex, data: txs.send.data as Hex, value: BigInt(txs.send.value) })
      .then(res => ({ ok: true as const, data: res.data }), () => ({ ok: false as const, data: undefined }))
    sendSimulated = r.ok ? 'ok' : 'reverted'
    if (r.ok && r.data && r.data.length === 66) simulatedMessageId = r.data
    if (!r.ok) problems.push('The CCIP send would revert.')
  }
  return {
    lane: { routerSupports: routerSupports === true, poolSupports: poolSupports === true, onRamp: onRamp ?? null, onRampPinned },
    outboundRateLimit: rateValid ? { enabled: bucket.isEnabled, availableRaw: bucket.tokens.toString(), capacityRaw: bucket.capacity.toString() } : null,
    cbAdaBalance: (cb ?? 0n).toString(), ethBalance: (eth ?? 0n).toString(), allowance: (allowance ?? 0n).toString(),
    approveSimulated, sendSimulated, simulatedMessageId, problems,
  }
}

// ── Message id from the confirmed transaction ────────────────────────────────

export interface ReceiptLike {
  status: string
  transactionHash: string
  logs: Array<{ address: string; topics: string[]; data: string; removed?: boolean }>
}

export interface SentMessage { messageId: string; sequenceNumber: string }

/**
 * Read the CCIP message id from the confirmed send's OnRamp event, holding the
 * event to the approved terms: Solana lane, this sender, exactly one cbADA
 * transfer of the approved amount from the pinned pool to the Solana mint, and
 * the approved recipient in the SVM arguments.
 */
export function messageIdFromReceipt(receipt: ReceiptLike, terms: CbAdaSendTerms, onRamp: string = BASE_SOLANA_ONRAMP): SentMessage {
  if (receipt.status !== '0x1') fail('The send transaction did not succeed.')
  const events = receipt.logs.filter(l => !l.removed && lower(l.address) === lower(onRamp))
  const decoded = events.flatMap(l => {
    try { return [decodeEventLog({ abi: [CCIP_MESSAGE_SENT], data: l.data as Hex, topics: l.topics as [Hex, ...Hex[]] })] } catch { return [] }
  })
  if (decoded.length !== 1) fail(decoded.length ? 'The transaction sent more than one CCIP message.' : 'The transaction has no CCIP message from the pinned OnRamp.')
  const ev = decoded[0].args
  const m = ev.message
  if (ev.destChainSelector !== CBADA.solana.selector || m.header.destChainSelector !== CBADA.solana.selector) fail('The message is for another lane.')
  if (m.header.sourceChainSelector !== CBADA.base.selector) fail('The message is not from Base.')
  if (lower(m.sender) !== lower(terms.sender)) fail('The message was sent by another address.')
  if (m.tokenAmounts.length !== 1) fail('The message moves other tokens.')
  const t = m.tokenAmounts[0]
  if (lower(t.sourcePoolAddress) !== lower(CBADA.base.pool) || lower(t.destTokenAddress) !== lower(MINT_BYTES)) fail('The message moves a token other than cbADA.')
  if (t.amount !== BigInt(terms.amountRaw)) fail('The message moves a different amount than approved.')
  if (lower(m.extraArgs) !== lower(svmTokenTransferExtraArgs(terms.solanaRecipient))) fail('The message delivers to a different Solana recipient.')
  return { messageId: lower(m.header.messageId), sequenceNumber: ev.sequenceNumber.toString() }
}

// ── Journey persistence around a (future) broadcast ─────────────────────────

/** Persist the signed send's hash BEFORE broadcasting it. The journey store refuses any later replacement. */
export async function recordSignedBridgeSend(store: JourneyStore, journey: StablecoinJourney, txHash: string, now: number): Promise<StablecoinJourney> {
  const next = recordLegSubmitted(journey, 'bridge', txHash, now)
  await store.put(next)
  return next
}

/**
 * After an interruption: recover the message id by the recorded tx hash.
 * Not mined yet -> unchanged (poll again). Never re-sends.
 */
export async function recoverBridgeReference(
  store: JourneyStore, journey: StablecoinJourney, terms: CbAdaSendTerms,
  getReceipt: (txHash: string) => Promise<ReceiptLike | null>, now: number,
): Promise<{ journey: StablecoinJourney; messageId: string | null }> {
  const leg = journey.legs[1]
  const txHash = leg.txHash
  if (!txHash) throw new CcipSendError('No bridge transaction is recorded.')
  if (leg.providerRef) return { journey, messageId: leg.providerRef }
  const receipt = await getReceipt(txHash)
  if (!receipt) return { journey, messageId: null }
  if (lower(receipt.transactionHash) !== lower(txHash)) fail('The receipt hash does not match the recorded send transaction.')
  const { messageId } = messageIdFromReceipt(receipt, terms)
  const next = recordLegProviderRef(journey, 'bridge', messageId, now)
  await store.put(next)
  return { journey: next, messageId }
}

// ── Independent Solana delivery check ───────────────────────────────────────

const discriminator = (name: string) => sha256(new TextEncoder().encode(`event:${name}`)).slice(0, 8)
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const u64le = (b: Uint8Array, at: number) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[at + i]); return v }
const EXECUTION_STATE_CHANGED = discriminator('ExecutionStateChanged')
const SKIPPED_ALREADY_EXECUTED = discriminator('SkippedAlreadyExecutedMessage')
const EXECUTION_SUCCESS = 2 // MessageExecutionState: Untouched, InProgress, Success, Failure

export interface SolanaParsedTx {
  meta: {
    err: unknown
    logMessages?: string[] | null
    preTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount: { amount: string } }> | null
    postTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount: { amount: string } }> | null
  } | null
}

export type SolanaDeliveryVerdict =
  | { state: 'delivered'; sequenceNumber: string }
  /** This transaction is not the execution of that message (or only skipped it). Keep looking. */
  | { state: 'not-this-message'; reason: string }
  /** The OffRamp executed the message and it FAILED. Needs review; not a refund. */
  | { state: 'execution-failed'; sequenceNumber: string }
  /** Executed, but the recipient's cbADA credit differs. Needs review. */
  | { state: 'credit-mismatch'; creditedRaw: string }

/**
 * Hold a Solana transaction to the message: it must succeed, be the pinned
 * OffRamp's execution, emit ExecutionStateChanged for exactly this message id
 * from Base in state Success, and credit the recipient exactly the amount.
 * A provider status or explorer label is never enough on its own.
 */
export function verifySolanaCbAdaDelivery(tx: SolanaParsedTx, expect: { messageId: string; recipient: string; amountRaw: string }): SolanaDeliveryVerdict {
  const meta = tx?.meta
  if (!meta) return { state: 'not-this-message', reason: 'no transaction metadata' }
  const logs = meta.logMessages ?? []
  const want = expect.messageId.replace(/^0x/, '').toLowerCase()
  let event: { seq: bigint; state: number } | null = null
  let skipped = false
  let offRampInvoked = false
  const programStack: string[] = []
  for (const l of logs) {
    const invoke = /^Program (\S+) invoke \[([1-9][0-9]*)\]$/.exec(l)
    if (invoke) {
      const depth = Number(invoke[2])
      // Solana logs include events from every invoked program. An event only
      // proves OffRamp execution while OffRamp itself is at the top of the
      // invocation stack; a sibling or nested program can emit the same bytes.
      if (depth > programStack.length + 1) { programStack.length = 0; continue }
      programStack.length = depth - 1
      programStack.push(invoke[1])
      if (invoke[1] === SOLANA_OFFRAMP) offRampInvoked = true
      continue
    }
    const finish = /^Program (\S+) (?:success|failed:.*)$/.exec(l)
    if (finish) {
      if (programStack[programStack.length - 1] === finish[1]) programStack.pop()
      else programStack.length = 0
      continue
    }
    if (programStack[programStack.length - 1] !== SOLANA_OFFRAMP) continue
    if (!l.startsWith('Program data: ')) continue
    let b: Uint8Array
    try { b = base64.decode(l.slice('Program data: '.length)) } catch { continue }
    if (b.length >= 8 && sameBytes(b.slice(0, 8), SKIPPED_ALREADY_EXECUTED)) skipped = true
    if (b.length === 8 + 8 + 8 + 32 + 32 + 1 && sameBytes(b.slice(0, 8), EXECUTION_STATE_CHANGED)) {
      const source = u64le(b, 8)
      const id = toHexStr(b.slice(24, 56))
      if (source === CBADA.base.selector && id === want) event = { seq: u64le(b, 16), state: b[88] }
    }
  }
  if (!offRampInvoked) return { state: 'not-this-message', reason: 'not a CCIP OffRamp execution' }
  if (!event) return { state: 'not-this-message', reason: skipped ? 'the OffRamp skipped an already-executed message' : 'no execution event for this message id' }
  if (meta.err !== null && meta.err !== undefined) return { state: 'not-this-message', reason: 'the transaction failed' }
  if (event.state !== EXECUTION_SUCCESS) return { state: 'execution-failed', sequenceNumber: event.seq.toString() }
  const bal = (arr: NonNullable<NonNullable<SolanaParsedTx['meta']>['preTokenBalances']>) =>
    (arr ?? []).filter(x => x.mint === CBADA.solana.token && x.owner === expect.recipient).reduce((s, x) => s + BigInt(x.uiTokenAmount.amount), 0n)
  const credited = bal(meta.postTokenBalances ?? []) - bal(meta.preTokenBalances ?? [])
  if (credited !== BigInt(expect.amountRaw)) return { state: 'credit-mismatch', creditedRaw: credited.toString() }
  return { state: 'delivered', sequenceNumber: event.seq.toString() }
}
