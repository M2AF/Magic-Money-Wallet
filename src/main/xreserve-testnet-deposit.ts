/**
 * xreserve-testnet-deposit.ts — the TESTNET-ONLY execution path for an
 * Ethereum Sepolia USDC → Cardano Preprod USDCx xReserve deposit, following
 * Circle's Cardano quickstart (developers.circle.com/xreserve/tutorials/
 * deposit-usdc-into-xreserve), then tracking it with the read-only modules.
 *
 * WHY IT EXISTS. To exercise the wallet's own signing, key derivation, IPC and
 * tracking on the documented testnet pair before any mainnet route exists.
 *
 * MAINNET IS DISABLED, in four independent places:
 *   1. every entry point refuses unless the wallet is in Testnet Mode;
 *   2. the xReserve profile is the frozen XRESERVE_SEPOLIA_PREPROD object —
 *      nothing selects or accepts the mainnet profile here;
 *   3. every transaction is built for chain id 11155111 and, before signing,
 *      re-validated by `validateCardanoDepositRequest` under that profile;
 *   4. the signer (`sendRawEvmTransaction`) resolves only Testnet Mode's EVM
 *      networks while Testnet Mode is on, so chain id 1 cannot be signed.
 *
 * WHAT THE USER CONTROLS: the amount and the fee cap. The sender is the
 * wallet's own EVM address and the recipient is the wallet's OWN Cardano
 * Preprod address (derived from its keys) — never a pasted address. Signing
 * requires a short-lived intent issued by `prepare` in this privileged layer;
 * the renderer only holds its id.
 *
 * ONE EXPLICIT USER ACTION PER TRANSACTION:
 *   • `approveTestnetDeposit` — only when the allowance is short: signs and
 *     submits ONLY the exact-amount USDC approval and returns its hash. It never
 *     sends the deposit. `checkTestnetApproval` (read-only) then reports its
 *     confirmation and, once confirmed, returns the deposit terms again.
 *   • `depositTestnet` — a separate click with the terms the user just saw:
 *     rechecks identity, network, recipient, amount, fee cap and calldata,
 *     requires the allowance to be in place already (it never approves), reads
 *     the Cardano Preprod tip (tracking starts there; unreadable → nothing sent),
 *     simulates, pins the nonce, sends, then starts tracking and reports whether
 *     that save succeeded.
 * Nothing in this module moves from an approval to a deposit on its own, so
 * closing the panel after approving can never send a deposit.
 *
 * NOT HERE: mainnet, fee or minimum quotes, routing, swap sessions, polling
 * timers, Cardano signing. Status checks are one-shot and user-initiated.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, keccak256, parseTransaction } from 'viem'
import { sepolia } from 'viem/chains'
import {
  sendRawEvmTransaction, simulateRawEvmTransaction, TESTNET_EVM_SENDERS, signRawEvmTransaction, broadcastSignedEvmTransaction,
  getEvmPendingNonce, readErc20Allowance, readEvmSellBalance, type RawEvmTx, type EvmSimulationOutcome,
} from './tx-sender'
import { getEvmPrivateKey } from './wallet-core'
import { isTestnet } from './chain-config'
import type { WalletConfig } from './secure-store'
import { XRESERVE_SEPOLIA_PREPROD } from './xreserve-network'
import {
  buildCardanoDepositRequest, validateCardanoDepositRequest, encodeCardanoRecipient, XReserveCardanoError,
  type CardanoDepositInput,
} from './xreserve-cardano-deposit'
import { blockfrostMintReads, createBlockfrostLocatorReader, createBlockfrostAuditReader, type HttpFetchFn } from './xreserve-cardano-provider'
import { koiosMintReads, createKoiosLocatorReader, createKoiosAuditReader } from './xreserve-koios-provider'
import { readXReserveEthereumEvidence } from './xreserve-ethereum-evidence-reader'
import { fetchXReserveAttestation } from './xreserve-cardano-provider'
import type { InboundReads, InboundStatus } from './xreserve-inbound-status'
import {
  startXReserveInboundTrackingRecord, checkAndPersistXReserveInbound, parseInboundTrackingRecord, inboundTrackingKey,
  type InboundTrackingStore, type TrackingIdentity, type XReserveInboundRecord,
} from './xreserve-inbound-tracking'
import {
  sendJournalKey, sendJournalPrefix, isSendJournalKey, parseSendJournal, judgeJournal, approvedOf, NOT_SENT_DEPTH,
  type SendJournalEntry,
} from './xreserve-testnet-send-journal'
import type {
  TestnetStatusSummary, TestnetRecordSummary, TestnetDepositState, TestnetDepositPreview, TestnetDepositResult, TestnetCheckResult,
  TestnetApprovalResult, TestnetCardanoSource, TestnetPendingSend, TestnetRecoveryResult,
} from '../shared/xreserve-testnet-wire'

export type {
  TestnetCardanoSource,
  TestnetStatusSummary, TestnetRecordSummary, TestnetDepositState, TestnetDepositPreview, TestnetDepositResult, TestnetCheckResult,
  TestnetApprovalResult, TestnetPendingSend, TestnetRecoveryResult,
}

const NET = XRESERVE_SEPOLIA_PREPROD
const CHAIN_ID = NET.ethereum.chainId
/** Depths used for testnet tracking. Sepolia blocks ~12 s, Preprod ~20 s. */
export const TESTNET_CONFIRMATIONS = Object.freeze({ ethereum: 12, cardano: 10 })
/** How long a prepared deposit may wait for the user's confirmation. */
export const TESTNET_INTENT_TTL_MS = 10 * 60_000
/** Longest a single approval-status read waits for the receipt. */
export const APPROVAL_WAIT_MS = 60_000
const MAX_INTENTS = 8

// ── Errors ────────────────────────────────────────────────────────────────────

export type TestnetDepositErrorCode =
  | 'not-testnet'            // the wallet is not in Testnet Mode
  | 'no-wallet'              // no EVM or Cardano Preprod address for this account
  | 'invalid-amount'         // amount / fee cap unusable
  | 'preprod-key-missing'    // Blockfrost is the selected Preprod source but no project id is set
  | 'invalid-source'         // not a known Cardano Preprod source
  | 'invalid-key'            // not a Blockfrost Preprod project id
  | 'insufficient-usdc'
  | 'no-gas'
  | 'intent-unknown'         // expired, used, or never issued
  | 'identity-changed'       // the wallet, account or environment changed since prepare
  | 'tip-unavailable'        // Cardano Preprod tip unreadable: nothing sent
  | 'simulation-failed'      // the deposit would revert, or could not be checked: not sent
  | 'broadcast-uncertain'    // the deposit may or may not have been accepted
  | 'send-failed'            // a transaction could not be sent
  | 'busy'                   // this intent is already being approved or deposited
  | 'approval-pending'       // an earlier approval may still land: not sent again
  | 'approval-uncertain'     // the approval may or may not have been accepted
  | 'approval-required'      // the allowance does not cover the deposit (approve is a separate step)
  | 'terms-changed'          // what the user confirmed differs from the prepared deposit
  | 'recovery-pending'       // an earlier deposit's outcome is not yet known: no new deposit until it is
  | 'sign-failed'            // the deposit could not be signed, or the signed bytes were not the approved call
  | 'journal-save-failed'    // the recovery record could not be saved, so nothing was broadcast

export class TestnetDepositError extends Error {
  constructor(
    readonly code: TestnetDepositErrorCode,
    message: string,
    /** Transactions that DID reach the network before the failure. */
    readonly submitted: string[] = [],
  ) { super(message) }
}
const fail = (code: TestnetDepositErrorCode, message: string, submitted: string[] = []): never => {
  throw new TestnetDepositError(code, message, submitted)
}

// ── Injected context ──────────────────────────────────────────────────────────

/** What the privileged layer knows about the unlocked wallet. */
export interface TestnetWallet {
  /** Public-address fingerprint (swap-intent's walletId). */
  walletId: string
  accountIndex: number
  /** The account's EVM address (the same on Sepolia). */
  evmAddress: string
  /** The account's Cardano Preprod (addr_test…) address in Testnet Mode. */
  cardanoAddress: string | undefined
}

/** Chain operations, injectable for tests. Defaults: the wallet's own tx-sender and Blockfrost Preprod. */
export interface TestnetOps {
  readUsdc(owner: string): Promise<bigint | null>
  readEth(owner: string): Promise<bigint | null>
  readAllowance(owner: string, spender: string): Promise<bigint | null>
  simulate(from: string, tx: RawEvmTx): Promise<EvmSimulationOutcome>
  nonce(owner: string): Promise<number | null>
  /** Sign AND broadcast (the approval only). */
  send(tx: RawEvmTx): Promise<{ txHash: string; explorerUrl: string }>
  /** Sign the deposit locally WITHOUT broadcasting; returns the signed bytes and their hash. */
  signDeposit(tx: RawEvmTx & { nonce: number }): Promise<{ serialized: `0x${string}`; txHash: string }>
  /** Broadcast bytes from `signDeposit`. */
  broadcast(serialized: `0x${string}`): Promise<{ txHash: string; explorerUrl: string }>
  /** eth_getTransactionByHash (null when the node does not know it). Throws when unreadable. */
  transaction(hash: string): Promise<unknown>
  /** The sender's transaction count at `depth` blocks under the tip, or null when unreadable. */
  usedNonceAt(owner: string, depth: number): Promise<number | null>
  /** A transaction's outcome, waiting at most `waitMs`; 'pending' when not mined (or not readable) yet. */
  receipt(hash: string, waitMs: number): Promise<'success' | 'reverted' | 'pending'>
  signerAddress(): Promise<string>
  cardanoTip(): Promise<{ blockHeight: number }>
}

/** The selected Cardano Preprod source: keyless Koios unless Blockfrost was chosen. */
export const cardanoSourceOf = (config: WalletConfig): TestnetCardanoSource =>
  config.xreservePreprodSource === 'blockfrost' ? 'blockfrost' : 'koios'

/** Whether the selected source can be used now. */
export const cardanoSourceReady = (config: WalletConfig): boolean =>
  cardanoSourceOf(config) === 'koios' || (config.blockfrostPreprodKey ?? '').trim().length > 0

/**
 * The status reads for one check: Ethereum Sepolia evidence and Circle's testnet
 * API as before, and Cardano Preprod from the selected source. `fetchFn` is the
 * platform's fetch (Electron main passes `net.fetch`).
 */
export function testnetInboundReads(config: WalletConfig, fetchFn?: HttpFetchFn): InboundReads {
  const koios = cardanoSourceOf(config) === 'koios'
  return {
    readEthereumEvidence: (hash) => readXReserveEthereumEvidence(hash, config, { fetchFn, network: NET }),
    fetchAttestation: (hash) => fetchXReserveAttestation(hash, { fetchFn, network: NET }),
    locatorReader: koios ? createKoiosLocatorReader({ network: NET, fetchFn }) : createBlockfrostLocatorReader({ config, network: NET }),
    auditReader: koios ? createKoiosAuditReader({ network: NET, fetchFn }) : createBlockfrostAuditReader({ config, network: NET }),
    network: NET,
  }
}

export function defaultTestnetOps(config: WalletConfig, mnemonic: string | null, accountIndex: number, fetchFn?: HttpFetchFn): TestnetOps {
  const needKey = () => (mnemonic ? mnemonic : fail('no-wallet', 'The wallet is locked.'))
  return {
    readUsdc: (owner) => readEvmSellBalance(NET.ethereum.usdc, owner, CHAIN_ID, config),
    readEth: (owner) => readEvmSellBalance(null, owner, CHAIN_ID, config),
    readAllowance: (owner, spender) => readErc20Allowance(NET.ethereum.usdc, owner, spender, CHAIN_ID, config),
    simulate: (from, tx) => simulateRawEvmTransaction(from, tx, config),
    nonce: (owner) => getEvmPendingNonce(owner, CHAIN_ID, config),
    send: (tx) => sendRawEvmTransaction(needKey(), tx, config, accountIndex),
    signDeposit: (tx) => signRawEvmTransaction(needKey(), tx, config, accountIndex),
    broadcast: (serialized) => broadcastSignedEvmTransaction(CHAIN_ID, serialized, config),
    transaction: async (hash) => {
      const client = createPublicClient({ chain: sepolia, transport: http(TESTNET_EVM_SENDERS.ethereum.rpcUrl(config)) })
      const r = await client.request({ method: 'eth_getTransactionByHash', params: [hash as `0x${string}`] })
      return r ?? null
    },
    usedNonceAt: async (owner, depth) => {
      try {
        const client = createPublicClient({ chain: sepolia, transport: http(TESTNET_EVM_SENDERS.ethereum.rpcUrl(config)) })
        const tip = await client.getBlockNumber()
        if (tip < BigInt(depth)) return null
        return await client.getTransactionCount({ address: owner as `0x${string}`, blockNumber: tip - BigInt(depth) })
      } catch {
        return null
      }
    },
    receipt: async (hash, waitMs) => {
      const client = createPublicClient({ chain: sepolia, transport: http(TESTNET_EVM_SENDERS.ethereum.rpcUrl(config)) })
      try {
        const r = waitMs > 0
          ? await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: waitMs })
          : await client.getTransactionReceipt({ hash: hash as `0x${string}` })
        return r.status === 'success' ? 'success' : 'reverted'
      } catch {
        return 'pending'   // not mined yet, timed out, or unreadable: never a verdict
      }
    },
    signerAddress: async () => privateKeyToAccount(await getEvmPrivateKey(needKey(), accountIndex)).address,
    cardanoTip: () => (cardanoSourceOf(config) === 'koios'
      ? koiosMintReads({ network: NET, fetchFn }).tip()
      : blockfrostMintReads({ config, network: NET }).tip()),
  }
}

export interface TestnetContext {
  config: WalletConfig
  wallet: TestnetWallet
  ops: TestnetOps
  store: InboundTrackingStore & { remove(key: string): Promise<void> }
  /** Every stored tracking record (for listing). */
  listStored(): Promise<Record<string, string>>
  now?: () => number
  /** The platform's fetch for status reads (Electron main passes `net.fetch`). */
  fetchFn?: HttpFetchFn
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const identityOf = (w: TestnetWallet): TrackingIdentity =>
  ({ walletId: w.walletId, accountId: `account-${w.accountIndex}`, environment: 'testnet' })

const preprodKeySet = (config: WalletConfig) => (config.blockfrostPreprodKey ?? '').trim().length > 0

/** Decimal USDC ("12.5") → base units. At most 6 decimals, no sign, no exponent. */
export function parseUsdc(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(v.trim())) {
    return fail('invalid-amount', `${what} must be a USDC amount with at most 6 decimals.`)
  }
  const [whole, frac = ''] = v.trim().split('.')
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))
}

export const formatUsdc = (raw: bigint): string => {
  const whole = raw / 1_000_000n
  const frac = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

function requireTestnet(config: WalletConfig): void {
  if (!isTestnet(config)) fail('not-testnet', 'The xReserve test deposit is only available in Testnet Mode.')
}

function requireWallet(w: TestnetWallet): { evm: string; cardano: string } {
  if (!w || typeof w.evmAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(w.evmAddress)) {
    return fail('no-wallet', 'This account has no EVM address.')
  }
  if (typeof w.cardanoAddress !== 'string') return fail('no-wallet', 'This account has no Cardano Preprod address yet — unlock the wallet in Testnet Mode.')
  try {
    encodeCardanoRecipient(w.cardanoAddress, NET)
  } catch (e) {
    return fail('no-wallet', `This account's Cardano Preprod address cannot receive USDCx: ${e instanceof XReserveCardanoError ? e.message : 'invalid'}`)
  }
  return { evm: w.evmAddress.toLowerCase(), cardano: w.cardanoAddress }
}

// ── Intents (memory only: they authorize signing, so they are never persisted) ─

type IntentStage =
  | 'prepared'        // nothing sent
  | 'approving'       // an approval send is in progress (other actions refused)
  | 'approval-sent'   // an approval is out; its confirmation is not yet known
  | 'approved'        // the allowance covers the amount
  | 'depositing'      // a deposit action is in progress (other actions refused)
  | 'deposit-sent'    // the deposit send was attempted: spent

interface StoredIntent {
  id: string
  createdAt: number
  walletId: string
  accountIndex: number
  sender: string
  recipient: string
  amountRaw: bigint
  maxFeeRaw: bigint
  /** The exact depositToRemote calldata prepared (lower-case). */
  depositData: string
  stage: IntentStage
  /** The approval sent for this intent; `hash` is '' when its broadcast was uncertain. */
  approval?: { hash: string; nonce: number }
}
const intents = new Map<string, StoredIntent>()

function newId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function sweep(now: number): void {
  for (const [id, i] of intents) if (now - i.createdAt > TESTNET_INTENT_TTL_MS) intents.delete(id)
  while (intents.size > MAX_INTENTS) intents.delete(intents.keys().next().value as string)
}

/** Test hook. */
export function __resetTestnetIntents(): void { intents.clear() }

// ── Status for the untrusted side (JSON-safe: no bigint, no calldata) ─────────


export function summarizeInboundStatus(s: InboundStatus): TestnetStatusSummary {
  return {
    state: s.state,
    retryable: s.retryable,
    reason: s.reason,
    sourceCode: s.sourceCode,
    sourceConfirmations: s.source?.confirmations != null ? s.source.confirmations.toString() : null,
    linkCode: s.linkCode,
    trackingError: s.trackingError,
    providerFailure: s.providerFailure ? { ...s.providerFailure } : null,
    conflict: s.conflict,
    mint: s.mint ? { ...s.mint } : null,
    creditedRaw: s.proof?.creditedRaw ?? null,
    locatorState: s.locator?.state ?? null,
    auditState: s.audit?.state ?? null,
  }
}


const summarizeRecord = (r: XReserveInboundRecord): TestnetRecordSummary => ({
  sourceTxHash: r.sourceTxHash,
  explorerUrl: `https://sepolia.etherscan.io/tx/${r.sourceTxHash}`,
  sender: r.approvedSender,
  recipient: r.approved.recipient,
  amountRaw: r.approved.amountRaw,
  maxFeeRaw: r.approved.maxFeeRaw,
  cardanoTipAtSubmission: r.cardanoTipAtSubmission.blockHeight,
})

// ── State ─────────────────────────────────────────────────────────────────────


/** What the panel shows. Reads nothing from the network. */
export async function getTestnetDepositState(ctx: Pick<TestnetContext, 'config' | 'wallet' | 'listStored'>): Promise<TestnetDepositState> {
  const testnet = isTestnet(ctx.config)
  const identity = identityOf(ctx.wallet)
  const prefix = inboundTrackingKey(identity, `0x${'0'.repeat(64)}`).slice(0, -66)
  const stored = testnet ? await ctx.listStored() : {}
  const deposits = Object.entries(stored)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, json]) => (typeof json === 'string' ? parseInboundTrackingRecord(json) : null))
    .filter((r): r is XReserveInboundRecord => r !== null
      && r.identity.walletId === identity.walletId && r.identity.accountId === identity.accountId && r.identity.environment === 'testnet')
    .map(summarizeRecord)
  return {
    testnet,
    preprodKeySet: preprodKeySet(ctx.config),
    cardanoSource: cardanoSourceOf(ctx.config),
    cardanoSourceReady: cardanoSourceReady(ctx.config),
    network: {
      source: NET.ethereum.name, destination: NET.cardano.name, xReserve: NET.ethereum.xReserve,
      usdc: NET.ethereum.usdc, usdcxUnit: NET.cardano.usdcxUnit, cardanoDomain: NET.cardanoDomain,
    },
    sender: testnet ? ctx.wallet.evmAddress ?? null : null,
    recipient: testnet ? ctx.wallet.cardanoAddress ?? null : null,
    deposits,
    pendingSends: testnet ? await pendingSendsOf(ctx) : [],
  }
}

/** A Cardano Preprod source choice. */
export function validateCardanoSource(v: unknown): TestnetCardanoSource {
  if (v === 'koios' || v === 'blockfrost') return v
  return fail('invalid-source', 'Choose Koios or Blockfrost for Cardano Preprod.')
}

/** A Blockfrost Preprod project id: "preprod" + alphanumerics. */
export function validatePreprodKey(key: unknown): string {
  if (typeof key !== 'string') return fail('invalid-key', 'The project id must be text.')
  const k = key.trim()
  if (k === '') return ''
  if (!/^preprod[0-9A-Za-z]{16,64}$/.test(k)) return fail('invalid-key', 'That is not a Blockfrost Preprod project id (it starts with "preprod").')
  return k
}

// ── Prepare ───────────────────────────────────────────────────────────────────


export async function prepareTestnetDeposit(
  input: { amount: unknown; maxFee: unknown }, ctx: TestnetContext,
): Promise<TestnetDepositPreview> {
  requireTestnet(ctx.config)
  const { evm, cardano } = requireWallet(ctx.wallet)
  if (!cardanoSourceReady(ctx.config)) {
    fail('preprod-key-missing', 'Blockfrost is selected for Cardano Preprod but no project id is set. Set one, or choose keyless Koios.')
  }
  const amountRaw = parseUsdc(input?.amount, 'The amount')
  const maxFeeRaw = parseUsdc(input?.maxFee, 'The fee cap')
  const approved: CardanoDepositInput = { recipient: cardano, amountRaw, maxFeeRaw }
  let deposit
  try { deposit = buildCardanoDepositRequest(approved, NET) } catch (e) {
    return fail('invalid-amount', e instanceof XReserveCardanoError ? e.message : 'The deposit terms are invalid.')
  }
  const [usdc, eth, allowance] = await Promise.all([
    ctx.ops.readUsdc(evm).catch(() => null),
    ctx.ops.readEth(evm).catch(() => null),
    ctx.ops.readAllowance(evm, NET.ethereum.xReserve).catch(() => null),
  ])
  if (usdc != null && usdc < amountRaw) {
    fail('insufficient-usdc', `This address holds ${formatUsdc(usdc)} Sepolia USDC; the deposit needs ${formatUsdc(amountRaw)}.`)
  }
  if (eth != null && eth === 0n) fail('no-gas', 'This address has no Sepolia ETH for gas.')

  const now = (ctx.now ?? Date.now)()
  sweep(now)
  const id = newId()
  intents.set(id, {
    id, createdAt: now, walletId: ctx.wallet.walletId, accountIndex: ctx.wallet.accountIndex,
    sender: evm, recipient: cardano, amountRaw, maxFeeRaw, depositData: deposit.data.toLowerCase(), stage: 'prepared',
  })
  return {
    intentId: id,
    expiresAt: now + TESTNET_INTENT_TTL_MS,
    sourceChain: NET.ethereum.name,
    destinationChain: NET.cardano.name,
    sender: evm,
    recipient: cardano,
    recipientKind: deposit.recipient.addressKind,
    xReserve: NET.ethereum.xReserve,
    usdc: NET.ethereum.usdc,
    amountRaw: amountRaw.toString(),
    maxFeeRaw: maxFeeRaw.toString(),
    amount: formatUsdc(amountRaw),
    maxFee: formatUsdc(maxFeeRaw),
    usdcBalanceRaw: usdc?.toString() ?? null,
    ethBalanceRaw: eth?.toString() ?? null,
    allowanceRaw: allowance?.toString() ?? null,
    needsApproval: allowance == null ? null : allowance < amountRaw,
    pendingRecovery: (await pendingSendsOf(ctx)).length,
  }
}

// ── Approve (action 1, only when the allowance is short) ─────────────────────

const erc20ApproveData = (spender: string, amount: bigint) =>
  `0x095ea7b3${spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`

const sentSuffix = (submitted: string[]) => (submitted.length ? ` Already sent: ${submitted.join(', ')}.` : ' Nothing was sent.')
const approvalUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`

/** The intent, still valid, for THIS wallet and account — or a typed refusal. */
function liveIntent(intentId: unknown, ctx: TestnetContext): { intent: StoredIntent; evm: string; cardano: string } {
  requireTestnet(ctx.config)
  sweep((ctx.now ?? Date.now)())
  const intent = typeof intentId === 'string' ? intents.get(intentId) : undefined
  if (!intent) {
    return fail('intent-unknown', 'This deposit is no longer prepared: it expired, was already used, or the wallet restarted. '
      + 'Prepare it again. If you already signed a deposit, check Pending and Tracked deposits first — a new deposit is '
      + 'blocked while an earlier one is pending recovery.')
  }
  const { evm, cardano } = requireWallet(ctx.wallet)
  if (intent.walletId !== ctx.wallet.walletId || intent.accountIndex !== ctx.wallet.accountIndex
      || intent.sender !== evm || intent.recipient !== cardano) {
    fail('identity-changed', 'The wallet or account changed since this deposit was prepared. Nothing was sent.')
  }
  return { intent, evm, cardano }
}

async function requireSigner(ctx: TestnetContext, evm: string): Promise<void> {
  const signer = (await ctx.ops.signerAddress()).toLowerCase()
  if (signer !== evm) fail('identity-changed', 'The signing key does not control this account\'s EVM address. Nothing was sent.')
}

/** The deposit terms as shown to the user again, with a fresh allowance read. */
function termsOf(intent: StoredIntent, allowance: bigint | null, usdc: bigint | null, eth: bigint | null): TestnetDepositPreview {
  const kind = encodeCardanoRecipient(intent.recipient, NET).addressKind
  return {
    intentId: intent.id,
    expiresAt: intent.createdAt + TESTNET_INTENT_TTL_MS,
    sourceChain: NET.ethereum.name,
    destinationChain: NET.cardano.name,
    sender: intent.sender,
    recipient: intent.recipient,
    recipientKind: kind,
    xReserve: NET.ethereum.xReserve,
    usdc: NET.ethereum.usdc,
    amountRaw: intent.amountRaw.toString(),
    maxFeeRaw: intent.maxFeeRaw.toString(),
    amount: formatUsdc(intent.amountRaw),
    maxFee: formatUsdc(intent.maxFeeRaw),
    usdcBalanceRaw: usdc?.toString() ?? null,
    ethBalanceRaw: eth?.toString() ?? null,
    allowanceRaw: allowance?.toString() ?? null,
    needsApproval: allowance == null ? null : allowance < intent.amountRaw,
  }
}

/**
 * ACTION 1 — sign and submit ONLY the exact-amount USDC approval.
 *
 * Never sends the deposit. Returns as soon as the approval is broadcast, with
 * its hash; `checkTestnetApproval` then reads its confirmation. Retries are
 * safe: while an earlier approval's nonce is still unresolved it is not sent
 * again, and a resend reuses the SAME nonce, so at most one approval can mine
 * (and approve() SETS the allowance, so even two would not add up).
 */
export async function approveTestnetDeposit(intentId: unknown, ctx: TestnetContext): Promise<TestnetApprovalResult> {
  const { intent, evm } = liveIntent(intentId, ctx)
  if (intent.stage === 'approving' || intent.stage === 'depositing') {
    fail('busy', 'This deposit is already being processed. Wait for it to finish.')
  }
  if (intent.stage === 'deposit-sent') fail('intent-unknown', 'This deposit was already sent.')
  const now = (ctx.now ?? Date.now)()
  const previous = intent.stage
  intent.stage = 'approving'   // synchronous: a second click is refused above
  try {
    await requireSigner(ctx, evm)
    const [allowance, usdc, eth] = await Promise.all([
      ctx.ops.readAllowance(evm, NET.ethereum.xReserve).catch(() => null),
      ctx.ops.readUsdc(evm).catch(() => null),
      ctx.ops.readEth(evm).catch(() => null),
    ])
    if (allowance != null && allowance >= intent.amountRaw) {
      intent.stage = 'approved'
      return { intentId: intent.id, state: 'already-sufficient', approvalTxHash: intent.approval?.hash ?? null,
        explorerUrl: intent.approval ? approvalUrl(intent.approval.hash) : null, terms: termsOf(intent, allowance, usdc, eth) }
    }
    if (usdc != null && usdc < intent.amountRaw) fail('insufficient-usdc', 'Not enough Sepolia USDC for this deposit. Nothing was sent.')
    if (eth != null && eth === 0n) fail('no-gas', 'This address has no Sepolia ETH for gas. Nothing was sent.')

    // An earlier approval that may still be in flight is never sent twice.
    let nonce: number | null
    if (intent.approval) {
      // An uncertain broadcast leaves no hash: treat it as possibly pending.
      const receipt = intent.approval.hash
        ? await ctx.ops.receipt(intent.approval.hash, 0).catch(() => 'pending' as const)
        : 'pending' as const
      if (receipt === 'success') {
        fail('approval-pending', 'The earlier approval confirmed but the allowance does not show it yet. Check the approval again. Nothing was sent.')
      }
      if (receipt === 'pending') {
        const pending = await ctx.ops.nonce(evm)
        if (pending == null || pending > intent.approval.nonce) {
          fail('approval-pending', `The earlier approval (nonce ${intent.approval.nonce}) may still be pending. Check it before approving again. Nothing was sent.`)
        }
        nonce = intent.approval.nonce    // never accepted: resend with the same nonce
      } else {
        nonce = await ctx.ops.nonce(evm)   // reverted: a fresh attempt
      }
    } else {
      nonce = await ctx.ops.nonce(evm)
    }
    if (nonce == null) fail('send-failed', 'Could not read the Sepolia nonce, so the approval was not sent. Nothing was sent.')

    const tx: RawEvmTx = {
      to: NET.ethereum.usdc, data: erc20ApproveData(NET.ethereum.xReserve, intent.amountRaw), value: '0x0', chainId: CHAIN_ID, nonce: nonce as number,
    }
    try {
      const sent = await ctx.ops.send(tx)
      intent.approval = { hash: sent.txHash.toLowerCase(), nonce: nonce as number }
    } catch (e) {
      // The node may or may not have taken it. The nonce is kept, so the next
      // attempt either finds it pending (and refuses) or reuses the nonce.
      intent.approval = intent.approval ?? { hash: '', nonce: nonce as number }
      intent.approval.nonce = nonce as number
      fail('approval-uncertain',
        `The approval was submitted with nonce ${nonce} but Sepolia did not confirm receipt. Check Sepolia Etherscan; `
        + `approving again reuses nonce ${nonce}, so at most one approval can land. (${e instanceof Error ? e.message : 'send failed'})`)
    }
    intent.stage = 'approval-sent'
    intent.createdAt = now   // the confirmation window restarts once the approval is out
    const hash = (intent.approval as { hash: string }).hash
    return { intentId: intent.id, state: 'submitted', approvalTxHash: hash, explorerUrl: approvalUrl(hash), terms: null }
  } catch (e) {
    if (intent.stage === 'approving') intent.stage = intent.approval?.hash ? 'approval-sent' : previous === 'approved' ? 'approved' : 'prepared'
    throw e
  }
}

/**
 * Read-only: has the approval confirmed? Waits at most `waitMs` for its receipt.
 * Once it has confirmed and the allowance covers the deposit, returns the
 * deposit terms AGAIN for a fresh confirmation. It never signs or sends.
 */
export async function checkTestnetApproval(intentId: unknown, ctx: TestnetContext, waitMs = APPROVAL_WAIT_MS): Promise<TestnetApprovalResult> {
  const { intent, evm } = liveIntent(intentId, ctx)
  const hash = intent.approval?.hash || null
  const receipt = hash ? await ctx.ops.receipt(hash, Math.max(0, Math.min(waitMs, APPROVAL_WAIT_MS))).catch(() => 'pending' as const) : null
  const [allowance, usdc, eth] = await Promise.all([
    ctx.ops.readAllowance(evm, NET.ethereum.xReserve).catch(() => null),
    ctx.ops.readUsdc(evm).catch(() => null),
    ctx.ops.readEth(evm).catch(() => null),
  ])
  const base = { intentId: intent.id, approvalTxHash: hash, explorerUrl: hash ? approvalUrl(hash) : null }
  if (receipt === 'reverted') {
    if (intent.stage === 'approval-sent') intent.stage = 'prepared'
    return { ...base, state: 'failed', terms: null }
  }
  if (allowance != null && allowance >= intent.amountRaw && (receipt === 'success' || receipt === null)) {
    if (intent.stage === 'approval-sent' || intent.stage === 'prepared') intent.stage = 'approved'
    return { ...base, state: receipt === 'success' ? 'confirmed' : 'already-sufficient', terms: termsOf(intent, allowance, usdc, eth) }
  }
  return { ...base, state: 'pending', terms: null }
}

// ── Deposit (action 2, always its own click) ─────────────────────────────────

/**
 * ACTION 2 — sign and submit `depositToRemote`, only when:
 *   • the intent is live and bound to this wallet, account and recipient;
 *   • the terms the user just confirmed (`expected`) equal the intent's;
 *   • the call rebuilt now is byte-identical to the one prepared, and
 *     validates under the Sepolia profile;
 *   • the allowance, read NOW, already covers the amount — this never approves;
 *   • the Cardano Preprod tip is readable (tracking starts from it);
 *   • the deposit simulates.
 * Anything failing before the send leaves the intent usable; once the send is
 * attempted the intent is spent, so it can never be sent twice.
 */
export async function depositTestnet(
  input: { intentId: unknown; expected: unknown }, ctx: TestnetContext,
): Promise<TestnetDepositResult> {
  const { intent, evm, cardano } = liveIntent(input?.intentId, ctx)
  if (intent.stage === 'approving' || intent.stage === 'depositing') fail('busy', 'This deposit is already being processed. Wait for it to finish.')
  if (intent.stage === 'deposit-sent') fail('intent-unknown', 'This deposit was already sent.')
  const e = (input?.expected ?? {}) as { amountRaw?: unknown; maxFeeRaw?: unknown; recipient?: unknown; sender?: unknown }
  if (e.amountRaw !== intent.amountRaw.toString() || e.maxFeeRaw !== intent.maxFeeRaw.toString()
      || e.recipient !== intent.recipient || typeof e.sender !== 'string' || e.sender.toLowerCase() !== intent.sender) {
    fail('terms-changed', 'The deposit terms on screen differ from the prepared deposit. Nothing was sent.')
  }
  const previous = intent.stage
  intent.stage = 'depositing'
  let attempted = false
  try {
    await requireSigner(ctx, evm)

    // ── Rebuild and re-validate the exact call that was prepared ─────────────
    const approved: CardanoDepositInput = { recipient: cardano, amountRaw: intent.amountRaw, maxFeeRaw: intent.maxFeeRaw }
    const deposit = buildCardanoDepositRequest(approved, NET)
    validateCardanoDepositRequest({ chainId: deposit.chainId, to: deposit.to, value: 0n, data: deposit.data }, approved, NET)
    if (deposit.chainId !== 11155111 || deposit.to !== NET.ethereum.xReserve || deposit.data.toLowerCase() !== intent.depositData) {
      fail('terms-changed', 'The deposit transaction differs from the one prepared. Nothing was sent.')
    }

    // ── The allowance must already be in place ─────────────────────────────
    const allowance = await ctx.ops.readAllowance(evm, NET.ethereum.xReserve).catch(() => null)
    if (allowance == null) fail('approval-required', 'Could not read the USDC allowance, so the deposit was not sent. Nothing was sent.')
    if ((allowance as bigint) < intent.amountRaw) {
      fail('approval-required', 'The USDC allowance does not cover this deposit. Approve first (a separate step). Nothing was sent.')
    }
    const usdc = await ctx.ops.readUsdc(evm).catch(() => null)
    if (usdc != null && usdc < intent.amountRaw) fail('insufficient-usdc', 'Not enough Sepolia USDC for this deposit. Nothing was sent.')

    // ── The Cardano tip at submission (required for tracking) ──────────────
    let tip: { blockHeight: number }
    try {
      tip = await ctx.ops.cardanoTip()
      if (!Number.isSafeInteger(tip?.blockHeight) || tip.blockHeight < 0) throw new Error('bad tip')
    } catch {
      return fail('tip-unavailable', 'Could not read the Cardano Preprod tip, which tracking must start from. Nothing was sent.')
    }

    // ── Simulate, pin the nonce, send ──────────────────────────────────────
    const tx: RawEvmTx = { to: deposit.to, data: deposit.data, value: '0x0', chainId: CHAIN_ID }
    const sim = await ctx.ops.simulate(evm, tx)
    if (sim.status !== 'pass') {
      fail('simulation-failed', sim.status === 'revert'
        ? `The deposit would fail on-chain (${sim.reason}). Nothing was sent.`
        : `The deposit could not be checked before signing (${sim.reason}). Nothing was sent.`)
    }
    const nonce = await ctx.ops.nonce(evm)
    if (nonce == null) fail('send-failed', 'Could not read the Sepolia nonce, so the deposit was not sent. Nothing was sent.')

    // ── An earlier deposit that could still land at another nonce blocks this one ─
    // (same nonce = a replacement: at most one of the two can land; see the journal module).
    const blocking = (await pendingSendsOf(ctx)).filter(p => p.corrupt || p.nonce !== nonce)
    if (blocking.length) {
      fail('recovery-pending', 'An earlier deposit from this account is pending recovery and could still land. Use "Check pending deposit" first; '
        + 'no new deposit is sent until it is resolved. Nothing was sent.')
    }

    // ── Sign locally; the hash is known before anything reaches the network ─
    let signed: { serialized: `0x${string}`; txHash: string }
    try {
      signed = await ctx.ops.signDeposit({ ...tx, nonce: nonce as number })
    } catch (err) {
      return fail('sign-failed', `The deposit could not be signed (${err instanceof Error ? err.message : 'sign failed'}). Nothing was sent.`)
    }
    // Belt and braces: the signed bytes are exactly the approved Sepolia call.
    let parsed: ReturnType<typeof parseTransaction>
    try { parsed = parseTransaction(signed.serialized) } catch { return fail('sign-failed', 'The signed deposit could not be read back. Nothing was sent.') }
    if (parsed.chainId !== CHAIN_ID || parsed.nonce !== nonce || (parsed.to ?? '').toLowerCase() !== deposit.to.toLowerCase()
        || (parsed.value ?? 0n) !== 0n || (parsed.data ?? '').toLowerCase() !== intent.depositData
        || keccak256(signed.serialized) !== signed.txHash.toLowerCase()) {
      return fail('sign-failed', 'The signed deposit does not match the approved call. Nothing was sent.')
    }
    const txHash = signed.txHash.toLowerCase()

    // ── The durable record, BEFORE broadcasting ──────────────────────────────
    const identity = identityOf(ctx.wallet)
    const journal: SendJournalEntry = {
      v: 1, kind: 'xreserve-send-journal', identity, sender: evm, chainId: CHAIN_ID, xReserve: NET.ethereum.xReserve.toLowerCase(),
      nonce: nonce as number, txHash,
      approved: { recipient: cardano, amountRaw: intent.amountRaw.toString(), maxFeeRaw: intent.maxFeeRaw.toString() },
      confirmations: { ...TESTNET_CONFIRMATIONS }, cardanoTipAtSubmission: { blockHeight: tip.blockHeight },
      createdAt: (ctx.now ?? Date.now)(),
    }
    const journalKey = sendJournalKey(identity, nonce as number, txHash)
    try {
      await ctx.store.save(journalKey, JSON.stringify(journal))
    } catch {
      return fail('journal-save-failed', 'The wallet could not save its recovery record, so the deposit was not broadcast. Nothing was sent.')
    }

    attempted = true
    intent.stage = 'deposit-sent'   // spent from here: never sent twice
    const explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`
    try {
      const sent = await ctx.ops.broadcast(signed.serialized)
      if (sent.txHash.toLowerCase() !== txHash) {
        console.warn('[xreserve-testnet] the node reported a different hash than the signed deposit; keeping the signed hash')
      }
    } catch (err) {
      intents.delete(intent.id)
      return fail('broadcast-uncertain',
        `The deposit was broadcast with nonce ${nonce} but Sepolia did not confirm receipt. If it landed, its hash is ${txHash}. `
        + 'The wallet kept a recovery record and will find it with "Check pending deposit"; do not send it again. '
        + `(${err instanceof Error ? err.message : 'broadcast failed'})`)
    }
    intents.delete(intent.id)

    // ── Track from the tip read before sending; then clear the journal ──────
    const approvalTxHash = intent.approval?.hash || null
    const started = await startXReserveInboundTrackingRecord({
      identity, approvedSender: evm, sourceTxHash: txHash, approved,
      confirmations: { ...TESTNET_CONFIRMATIONS }, cardanoTipAtSubmission: tip,
    }, ctx.store)
    if (started.kind === 'tracking-error') {
      // The journal stays: "Check pending deposit" (or the next app start) finishes tracking.
      return {
        sourceTxHash: txHash, explorerUrl, approvalTxHash,
        tracking: 'save-failed', trackingReason: `${started.code}: ${started.reason} — the recovery record will finish tracking`, record: null,
      }
    }
    await ctx.store.remove(journalKey).catch(() => { /* recovery clears it later: the deposit is already tracked */ })
    return {
      sourceTxHash: txHash, explorerUrl, approvalTxHash,
      tracking: started.kind, trackingReason: null, record: summarizeRecord(started.record),
    }
  } finally {
    if (!attempted && intent.stage === 'depositing') intent.stage = previous
  }
}

// ── Pending sends and recovery ────────────────────────────────────────────────

/** This account's journal entries, parsed; an unreadable entry is kept as `corrupt`, never dropped. */
async function journalEntriesOf(ctx: Pick<TestnetContext, 'wallet' | 'listStored'>): Promise<Array<{ key: string; entry: SendJournalEntry | null }>> {
  const prefix = sendJournalPrefix(identityOf(ctx.wallet))
  const stored = await ctx.listStored()
  return Object.entries(stored)
    .filter(([k]) => isSendJournalKey(k) && k.startsWith(prefix))
    .map(([key, json]) => {
      const entry = parseSendJournal(json)
      const bound = entry && entry.identity.walletId === ctx.wallet.walletId && entry.identity.accountId === `account-${ctx.wallet.accountIndex}`
      return { key, entry: bound ? entry : null }
    })
}

async function pendingSendsOf(ctx: Pick<TestnetContext, 'wallet' | 'listStored'>): Promise<TestnetPendingSend[]> {
  return (await journalEntriesOf(ctx)).map(({ key, entry }) => entry
    ? {
      key, corrupt: false, nonce: entry.nonce, txHash: entry.txHash, explorerUrl: `https://sepolia.etherscan.io/tx/${entry.txHash}`,
      amountRaw: entry.approved.amountRaw, maxFeeRaw: entry.approved.maxFeeRaw, createdAt: entry.createdAt,
    }
    : { key, corrupt: true, nonce: null, txHash: null, explorerUrl: null, amountRaw: null, maxFeeRaw: null, createdAt: null })
}

/**
 * Resolve this account's pending deposits from trusted Sepolia reads. Never
 * sends anything. Idempotent: an entry is cleared only once its deposit is
 * tracked, or proven unable to land.
 */
export async function recoverTestnetDeposits(ctx: TestnetContext): Promise<TestnetRecoveryResult> {
  requireTestnet(ctx.config)
  const { evm } = requireWallet(ctx.wallet)
  const results: TestnetRecoveryResult['entries'] = []
  for (const { key, entry } of await journalEntriesOf(ctx)) {
    if (!entry) {
      results.push({ nonce: null, txHash: null, verdict: 'corrupt', tracking: null,
        reason: 'The recovery record is unreadable. It is kept; check the account on Sepolia Etherscan before any new deposit.' })
      continue
    }
    if (entry.sender !== evm) {
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'unresolved', tracking: null, reason: 'The record belongs to another sender address.' })
      continue
    }
    let tx: unknown
    try { tx = await ctx.ops.transaction(entry.txHash) } catch {
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'unresolved', tracking: null, reason: 'Sepolia could not be read; check again.' })
      continue
    }
    const used = tx == null ? await ctx.ops.usedNonceAt(evm, NOT_SENT_DEPTH).catch(() => null) : null
    const verdict = judgeJournal(entry, tx, used)
    if (verdict.kind === 'found') {
      const started = await startXReserveInboundTrackingRecord({
        identity: entry.identity, approvedSender: entry.sender, sourceTxHash: entry.txHash, approved: approvedOf(entry),
        confirmations: { ...entry.confirmations }, cardanoTipAtSubmission: { ...entry.cardanoTipAtSubmission },
      }, ctx.store)
      if (started.kind === 'tracking-error') {
        results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'found', tracking: 'save-failed', reason: `${started.code}: ${started.reason}` })
        continue
      }
      await ctx.store.remove(key).catch(() => { /* cleared on the next recovery */ })
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'found', tracking: started.kind,
        reason: verdict.pending ? 'Found on Sepolia (not mined yet); tracking started.' : 'Found on Sepolia; tracking started.' })
    } else if (verdict.kind === 'not-sent') {
      await ctx.store.remove(key).catch(() => { /* cleared on the next recovery */ })
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'not-sent', tracking: null,
        reason: `Nonce ${entry.nonce} was used by a different transaction at least ${NOT_SENT_DEPTH} blocks ago, so this deposit never landed and never can.` })
    } else if (verdict.kind === 'mismatch') {
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'mismatch', tracking: null,
        reason: `A transaction with this hash exists but its ${verdict.field} is not the approved deposit's. It is not tracked; review it on Sepolia Etherscan.` })
    } else {
      results.push({ nonce: entry.nonce, txHash: entry.txHash, verdict: 'unresolved', tracking: null, reason: `${verdict.reason[0].toUpperCase()}${verdict.reason.slice(1)}. Check again later; do not send it again.` })
    }
  }
  return { entries: results }
}

/**
 * Manual path for an UNREADABLE recovery record, which recovery cannot judge
 * and which blocks new deposits. Removes only this account's journal key, and
 * only if it really is unreadable; readable entries are resolved by recovery.
 */
export async function dismissCorruptPendingSend(key: unknown, ctx: TestnetContext): Promise<true> {
  requireTestnet(ctx.config)
  requireWallet(ctx.wallet)
  const entries = await journalEntriesOf(ctx)
  const hit = entries.find(e => e.key === key)
  if (!hit) return fail('intent-unknown', 'No such pending record for this account.')
  if (hit.entry) return fail('recovery-pending', 'This record is readable; use "Check pending deposit" to resolve it.')
  await ctx.store.remove(hit.key)
  return true
}

// ── Check ─────────────────────────────────────────────────────────────────────


/**
 * One status check for a deposit this wallet tracks. The expected sender and
 * recipient are THIS wallet's own addresses, so a record for another wallet or
 * account is refused rather than checked.
 */
export async function checkTestnetDeposit(
  input: { sourceTxHash: unknown; auditDue: unknown }, ctx: TestnetContext, reads?: InboundReads,
): Promise<TestnetCheckResult> {
  requireTestnet(ctx.config)
  const { evm, cardano } = requireWallet(ctx.wallet)
  if (typeof input?.sourceTxHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(input.sourceTxHash)) {
    return { kind: 'tracking-error', code: 'invalid-input', reason: 'The source transaction hash is malformed.' }
  }
  const hash = input.sourceTxHash.toLowerCase()
  if (!cardanoSourceReady(ctx.config)) {
    return { kind: 'tracking-error', code: 'preprod-key-missing', reason: 'Blockfrost is selected but no Preprod project id is set. Set one, or choose keyless Koios.' }
  }
  // The stored terms supply only the amount and fee cap; identity, sender and
  // recipient are this wallet's own, and must match the record.
  const identity = identityOf(ctx.wallet)
  let json: string | null
  try { json = await ctx.store.load(inboundTrackingKey(identity, hash)) } catch {
    return { kind: 'tracking-error', code: 'load-failed', reason: 'the tracking store could not be read' }
  }
  if (json == null) return { kind: 'tracking-error', code: 'record-missing', reason: 'This deposit is not tracked by this account.' }
  const stored = typeof json === 'string' ? parseInboundTrackingRecord(json) : null
  if (!stored) return { kind: 'tracking-error', code: 'record-corrupt', reason: 'The stored tracking record is corrupt; it needs recovery, not a fresh start.' }
  const result = await checkAndPersistXReserveInbound({
    identity, approvedSender: evm, sourceTxHash: hash,
    approved: { recipient: cardano, amountRaw: stored.approved.amountRaw, maxFeeRaw: stored.approved.maxFeeRaw },
    auditDue: input.auditDue === true,
  }, reads ?? testnetInboundReads(ctx.config, ctx.fetchFn), ctx.store)
  if (result.kind === 'tracking-error') return { kind: 'tracking-error', code: result.code, reason: result.reason }
  if (result.kind === 'save-failed') return { kind: 'save-failed', reason: result.reason, status: summarizeInboundStatus(result.status) }
  return { kind: 'checked', persisted: result.persisted, status: summarizeInboundStatus(result.status) }
}

// ── Store adapter ─────────────────────────────────────────────────────────────

/** A write queue: every read-modify-write of one persisted map runs through it, one at a time. */
export interface TrackingWriteQueue { tail: Promise<unknown> }
export const createTrackingWriteQueue = (): TrackingWriteQueue => ({ tail: Promise.resolve() })

/**
 * An `InboundTrackingStore` over one persisted map (the platform stores keep
 * all records under one key). Each save is a load-modify-save of the WHOLE map,
 * so every store over the same persisted map must share one `queue` — a queue
 * per store instance would let two calls each load the old map and the later
 * save drop the earlier record. A failed write rejects.
 */
export function mapTrackingStore(
  load: () => Promise<Record<string, string>>, save: (map: Record<string, string>) => Promise<void>,
  queue: TrackingWriteQueue = createTrackingWriteQueue(),
): InboundTrackingStore & { list(): Promise<Record<string, string>>; remove(key: string): Promise<void> } {
  return {
    async load(key) {
      const map = await load()
      const v = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
      return typeof v === 'string' ? v : null
    },
    save(key, json) {
      const run = queue.tail.then(async () => {
        const map = { ...(await load()) }
        map[key] = json
        await save(map)
      })
      queue.tail = run.catch(() => { /* the caller sees this failure; later writes still run */ })
      return run
    },
    remove(key) {
      const run = queue.tail.then(async () => {
        const map = { ...(await load()) }
        if (!Object.prototype.hasOwnProperty.call(map, key)) return
        delete map[key]
        await save(map)
      })
      queue.tail = run.catch(() => { /* the caller sees this failure; later writes still run */ })
      return run
    },
    list: () => load(),
  }
}
