/**
 * swap-executor.ts — MagicMoney Wallet
 *
 * Layer 4 of the Phantom-style DEX swap: take a NormalizedSwapQuote (fetched via
 * the proxy) and sign+broadcast it locally. The wallet is a dumb signer — it
 * never holds liquidity; it only signs the calldata/transaction the aggregator
 * compiled.
 *
 *   EVM     — ERC-20 approval (if needed) → swap calldata, via tx-sender.
 *   Solana  — deserialize Jupiter VersionedTransaction, sign, send.
 *   Cardano — stub (CBOR witness signing not yet wired).
 *
 * Private keys are derived inside this process and never leave it.
 */

import { VersionedTransaction, Connection } from '@solana/web3.js'
import { privateKeyToAccount } from 'viem/accounts'
import {
  sendRawEvmTransaction, waitForEvmReceipt, simulateRawEvmTransaction,
  getEvmPendingNonce, readErc20Allowance, readEvmSellBalance, type EvmSimulationOutcome,
} from './tx-sender'
import { getSolanaKeypair, getEvmPrivateKey } from './wallet-core'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { WalletConfig } from './secure-store'
import { heliusRpcUrl } from './api-proxy'
import { decideSwapPolicy, checkMinReceived, type SwapPolicyDecision } from './swap-policy'
import {
  consumeSwapIntent, releaseSwapIntent, diffSubmittedQuote, buildSwapIdentity,
  markSwapIntentBroadcast, wasSwapIntentBroadcast,
  type SwapIdentityAddresses, type SwapSigningIdentity,
} from './swap-intent'
import {
  openSession, noteApprovalTx, noteSwapBroadcast, noteUncertainBroadcast, noteSourceReceipt, noteSwapNotSent,
} from './swap-sessions'
import { customChainDefs } from './chain-config'
import { estimateSolanaSwapCost, solanaShortfallMessage } from './solana-swap-cost'
import { isNativeSwapAddress } from '../shared/swap-token-identity'
import {
  validateSwapQuoteForExecution as validateSharedQuote,
  isSameEvmAddress, isNativeEvmAddress, approvalSpender,
} from '../shared/swap-execution-checks'

// Wallet chain id → numeric EVM chainId (matches tx-sender's supported set).
// These double as the source chains the executor can locally sign for a swap —
// for cross-chain routes (LI.FI/Rango) the source tx is still EVM calldata here.
// Exported for chain-parity tests (M-8).
//
// Until 2026-09-21 this listed only 8 chains, though tx-sender.ts (and the swap
// coverage matrix in swap-networks.ts) already supported 19 — a quote on
// Robinhood, Arc, Abstract, HyperEVM, Zora, Soneium, Ronin, Gnosis, Blast or
// ApeChain would pass `decideSwapPolicy` (which checks the matrix) and then
// throw here at the signing step with "Could not resolve EVM network". This is
// the BSC-regression class of bug chain-parity.test.ts exists to catch — this
// list must be a subset of tx-sender's EVM_CHAINS, with matching ids, and now is.
export const EVM_CHAIN_ID: Record<string, number> = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  blast: 81457, gnosis: 100, abstract: 2741, apechain: 33139,
  robinhood: 4663, arc: 5042, ronin: 2020, soneium: 1868,
  worldchain: 480, zora: 7777777, hyperevm: 999,
}

/**
 * Resolve a wallet chain id to its numeric EVM chainId, INCLUDING an imported
 * (custom) network. The static map above covers every built-in; an id that
 * misses it is checked against the wallet's registry of imports, matched by the
 * same string id `chain-config.ts` already uses everywhere else — never by
 * re-deriving or guessing a numeric id here.
 *
 * `config` is optional so every existing call site (unit tests included) that
 * has no config in hand keeps resolving the built-in set exactly as before.
 */
function resolveEvmChainId(chain: string, config?: WalletConfig): number | null {
  const known = EVM_CHAIN_ID[chain]
  if (known != null) return known
  if (!config) return null
  const custom = customChainDefs(config).find(c => c.id === chain)
  return custom?.chainId ?? null
}

const SOLSCAN = (sig: string) => `https://solscan.io/tx/${sig}`

export interface SwapExecuteResult {
  txHash: string
  explorerUrl: string
  approvalTxHash: string | null
}

/**
 * Raised only while NOTHING has been broadcast.
 *
 * The distinction matters for exactly one reason: an intent may be safely handed
 * back for a retry after a preflight failure, but never after a transaction is
 * in flight — releasing it then is precisely the duplicate spend the intent
 * registry exists to stop.
 */
export class SwapPreflightError extends Error {}

/**
 * THE entry point for executing a swap requested by the renderer.
 *
 * `submitted` is whatever the untrusted side sent. It is used only to read an
 * `intentId` and to diff against what the wallet stored — the quote that gets
 * SIGNED is the one the privileged layer issued and kept. See swap-intent.ts.
 */
export async function executeBoundSwap(
  submitted: unknown,
  mnemonic: string,
  config: WalletConfig,
  addresses: SwapIdentityAddresses,
  testnet: boolean,
): Promise<SwapExecuteResult> {
  const submittedQuote = submitted as { intentId?: unknown; fromChain?: string; toChain?: string } | null
  // Re-derive the identity from the wallet's own state at THIS moment. If the
  // wallet was replaced, the account switched, or the environment flipped since
  // the quote, the ids will not match and the intent is refused.
  const identity = buildSwapIdentity(
    addresses,
    String(submittedQuote?.fromChain ?? ''),
    String(submittedQuote?.toChain ?? ''),
    testnet,
  )
  const intent = consumeSwapIntent(submittedQuote?.intentId, identity)

  // Never fatal: the stored quote is what executes either way. Logged because a
  // difference means either tampering or a genuine client/main drift, and both
  // are worth seeing.
  const mismatches = diffSubmittedQuote(intent.quote, submitted)
  if (mismatches.length) {
    console.warn('[swap] submitted quote differs from the stored intent; signing the STORED quote. Fields:',
      mismatches.map(m => m.field).join(', '))
  }

  try {
    return await executeSwap(intent.quote, mnemonic, config, identity.accountIndex, intent.intentId, identity)
  } catch (e) {
    // Release ONLY when nothing reached the network. `markSwapIntentBroadcast`
    // is set the instant any transaction is sent, and `releaseSwapIntent`
    // refuses to act once it is — so an approval that was broadcast can never be
    // re-authorized by a mis-classified error.
    if (e instanceof SwapPreflightError && !wasSwapIntentBroadcast(intent.intentId)) {
      releaseSwapIntent(intent.intentId)
    }
    // Stopped before the swap itself went out, but AFTER something else did (an
    // approval): record the swap as not sent, so the session does not sit at
    // 'source-submitted' with no swap transaction. A SwapPreflightError is only
    // ever raised before the swap broadcast; a failure after it is a plain Error.
    if (e instanceof SwapPreflightError && wasSwapIntentBroadcast(intent.intentId)) {
      noteSwapNotSent(intent.intentId, e.message).catch(() => { /* evidence store; never masks the error */ })
    }
    throw e
  }
}

export async function executeSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex = 0,
  intentId?: string,
  identity?: SwapSigningIdentity,
): Promise<SwapExecuteResult> {
  validateSwapQuoteForExecution(quote, Date.now(), config)

  // ── The execution gate (see swap-policy.ts) ───────────────────────────────
  // Discovery made every token selectable; this decides what is signable. It
  // runs here, in the privileged layer, because the renderer is the untrusted
  // side — a UI-only restriction restricts nothing.
  const policy = decideSwapPolicy(quote)
  if (!policy.allowed) throw new SwapPreflightError(policy.reason ?? 'This swap is not enabled.')

  if (policy.requireMinReceived) {
    const check = checkMinReceived(quote)
    if (!check.ok) {
      throw new SwapPreflightError(
        `${check.reason} This token is outside the wallet's verified list, so a confirmed ` +
        'minimum received is required before it can be signed.')
    }
  }

  const chain = quote.fromChain
  if (isSupportedEvmChain(chain, config)) return executeEvmSwap(quote, mnemonic, config, accountIndex, policy, intentId, identity)
  if (chain === 'solana') return executeSolanaSwap(quote, mnemonic, config, accountIndex, policy, intentId, identity)
  if (chain === 'cardano') {
    throw new SwapPreflightError('Cardano DEX execution is not enabled yet — use Cross-Chain mode for ADA.')
  }
  throw new SwapPreflightError(`Unsupported swap source chain: ${chain}`)
}

/**
 * Apply a simulation outcome according to the tier.
 *
 * BROAD swaps fail closed: "we could not check" is not "it is fine" for a token
 * this wallet has never executed. CURATED pairs keep their pre-discovery
 * behaviour and proceed when the check merely could not RUN — a dead RPC must
 * not break a swap that has always worked — but a definite revert still stops
 * them, because that is evidence, not absence of it.
 */
function applySimulation(
  outcome: EvmSimulationOutcome, policy: SwapPolicyDecision, label: string,
): void {
  if (outcome.status === 'pass') return
  if (outcome.status === 'revert') {
    throw new SwapPreflightError(
      `${label} would fail on-chain (${outcome.reason}). Nothing was sent — refresh the quote and try again.`)
  }
  if (policy.requireSimulation) {
    throw new SwapPreflightError(
      `${label} could not be verified before signing (${outcome.reason}). This token is outside the ` +
      'wallet\'s verified list, so it is not signed without a successful check. Nothing was sent.')
  }
  console.warn(`[swap] ${label}: simulation unavailable (${outcome.reason}); proceeding — curated pair.`)
}

/** The shared structural checks, with this wallet's own EVM network registry. */
export function validateSwapQuoteForExecution(
  quote: NormalizedSwapQuote, now = Date.now(), config?: WalletConfig,
): void {
  validateSharedQuote(quote, now, chain => isSupportedEvmChain(chain, config))
}

function isSupportedEvmChain(chain: string, config?: WalletConfig): boolean {
  return resolveEvmChainId(chain, config) != null
}

async function executeEvmSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex: number,
  policy: SwapPolicyDecision,
  intentId?: string,
  identity?: SwapSigningIdentity,
): Promise<SwapExecuteResult> {
  const chainId = resolveEvmChainId(quote.fromChain, config)
  if (!chainId) throw new SwapPreflightError(`Could not resolve EVM network for ${quote.fromChain}.`)
  if (!quote.txData.to || !quote.txData.data) {
    throw new SwapPreflightError('Quote did not include signable EVM calldata.')
  }

  const signer = privateKeyToAddress(await getEvmPrivateKey(mnemonic, accountIndex))

  // The quote was built for the intent's source address (the provider encodes
  // it as the payer). Signing it with any other key would spend from, and
  // approve for, an account the route was never priced for.
  if (identity && !isSameEvmAddress(signer, identity.sourceAddress)) {
    throw new SwapPreflightError(
      'This swap was quoted for a different address than the one this wallet would sign with. '
      + 'Nothing was sent — refresh the quote and try again.')
  }

  // Can the SIGNER actually pay? A route quoted for an address that does not
  // hold the sell amount reverts in simulation with no reason at all, which is
  // what users saw on Abstract: the balance on screen was the Abstract Global
  // Wallet's (a separate smart account), not this address's. An unreadable
  // balance is not a zero one, so only a successful read can refuse here.
  const sellsNative = isNativeEvmAddress(quote.fromTokenAddress)
  const held = await readEvmSellBalance(
    sellsNative ? null : quote.fromTokenAddress, signer, chainId, config)
  if (held != null && held < BigInt(quote.sellAmountRaw)) {
    const agwHint = quote.fromChain === 'abstract'
      ? ' If your balance is in your Abstract Global Wallet, that smart account is separate from this '
        + 'address and cannot be spent by a swap here — move the tokens to your Abstract address first.'
      : ''
    throw new SwapPreflightError(
      `Your ${quote.fromChain} address ${signer.slice(0, 6)}…${signer.slice(-4)} does not hold enough `
      + `${quote.fromTokenSymbol || 'of the token being sold'} for this swap.${agwHint} Nothing was sent.`)
  }

  /** Anything sent from here on means the intent can never be re-authorized. */
  const noteBroadcast = () => { if (intentId) markSwapIntentBroadcast(intentId) }

  // The settlement session is opened on the FIRST network action, keyed by the
  // intent. One user swap = one session = at most one app fee, whatever happens
  // afterwards: an approval, a zero-reset, an uncertain broadcast and a resumed
  // cross-chain poll all attach here rather than opening another record.
  const track = intentId && identity
    ? (fn: () => Promise<void>) => fn().catch(() => { /* evidence store must never break a swap */ })
    : () => { /* not tracked: no intent (direct executeSwap in tests) */ }
  const openIfNeeded = () => track(() => openSession(
    intentId as string, quote, identity as SwapSigningIdentity,
    { from: 18, to: 18 },
  ))
  /** Steps that actually reached the network, for honest error reporting. */
  const submitted: string[] = []

  // ── Step A — ERC-20 approval (native assets skip this) ────────────────────
  let approvalTxHash: string | null = null
  if (quote.approvalTx?.to) {
    const spender = approvalSpender(quote.approvalTx.data)
    const needed = BigInt(quote.sellAmountRaw)
    const current = await readErc20Allowance(quote.fromTokenAddress, signer, spender, chainId, config)

    if (current == null || current < needed) {
      // Zero-reset. Some ERC-20s (USDT is the canonical one) revert on a
      // non-zero → non-zero approve, so raising an existing partial allowance
      // has to go through zero first. Reading the allowance is what makes this
      // case visible; it is not by itself the fix for it.
      if (current != null && current > 0n) {
        const reset = await sendRawEvmTransaction(mnemonic, {
          to: quote.approvalTx.to, data: erc20ApproveData(spender, 0n), value: '0x0', chainId,
        }, config, accountIndex)
        noteBroadcast(); submitted.push(`allowance reset ${reset.txHash}`)
        openIfNeeded(); track(() => noteApprovalTx(intentId as string, reset.txHash))
        await waitForEvmReceipt(chainId, reset.txHash, config)
      }

      const appr = await sendRawEvmTransaction(mnemonic, {
        to: quote.approvalTx.to,
        data: quote.approvalTx.data,
        value: quote.approvalTx.value || '0x0',
        chainId,
      }, config, accountIndex)
      // Recorded before the wait: if the wait times out, the hash is the only
      // handle on an approval that may well have landed.
      approvalTxHash = appr.txHash
      noteBroadcast(); submitted.push(`approval ${appr.txHash}`)
      openIfNeeded(); track(() => noteApprovalTx(intentId as string, appr.txHash))
      await waitForEvmReceipt(chainId, appr.txHash, config)   // throws if it REVERTED
    }
  }

  // Step A2 — Uniswap Permit2.approve (after the token→Permit2 allowance, before the
  // swap). Only present for Uniswap's generatePermitAsTransaction path.
  if (quote.permitTx?.to) {
    const permit = await sendRawEvmTransaction(mnemonic, {
      to: quote.permitTx.to,
      data: quote.permitTx.data,
      value: quote.permitTx.value || '0x0',
      chainId,
    }, config, accountIndex)
    noteBroadcast(); submitted.push(`permit ${permit.txHash}`)
    openIfNeeded(); track(() => noteApprovalTx(intentId as string, permit.txHash))
    await waitForEvmReceipt(chainId, permit.txHash, config)
  }

  // ── Step B — simulate, then fire the compiled swap calldata ───────────────
  // Simulation happens here and not earlier because a swap that needs an
  // allowance necessarily reverts until the approval is mined; checking before
  // that would reject every first-time token.
  const swapTx = {
    to: quote.txData.to,
    data: quote.txData.data,
    value: quote.txData.value || '0x0',
    gas: quote.estimatedGasRaw && quote.estimatedGasRaw !== '0' ? quote.estimatedGasRaw : undefined,
    chainId,
  }
  applySimulation(await simulateRawEvmTransaction(signer, swapTx, config), policy, 'Swap transaction')

  // Pin the nonce so an ambiguous broadcast can be reconciled rather than
  // retried into a second, different transaction. A nonce we could not READ is
  // not a reason to send without one: an unpinned send is precisely the case
  // that cannot be reconciled afterwards.
  const nonce = await getEvmPendingNonce(signer, chainId, config)
  if (nonce == null) {
    throw new SwapPreflightError(
      `Could not read the account nonce on ${quote.fromChain}, so the swap cannot be submitted in a way ` +
      `that stays recoverable if the network connection drops.${sentSuffix(submitted)}`)
  }

  // LAST-MOMENT freshness. Allowance reads, a mined approval, simulation and
  // the nonce read can each take a while; this is the final point before the
  // transaction is irreversible, so the expiry is checked here rather than only
  // after an approval.
  assertQuoteStillFresh(quote, approvalTxHash, submitted)

  try {
    const main = await sendRawEvmTransaction(mnemonic, { ...swapTx, nonce }, config, accountIndex)
    noteBroadcast()
    openIfNeeded()
    track(() => noteSwapBroadcast(intentId as string, main.txHash, main.explorerUrl, nonce))
    // Confirmation, not broadcast, is what makes an in-swap fee real: the fee
    // transfer is inside this transaction, so a revert means nobody was paid.
    // Awaited separately from the return so a slow receipt never turns a landed
    // swap into an error the user reads as failure.
    void waitForEvmReceipt(chainId, main.txHash, config)
      .then(() => { track(() => noteSourceReceipt(intentId as string, main.txHash, true)) })
      .catch(() => { track(() => noteSourceReceipt(intentId as string, main.txHash, false)) })
    return { txHash: main.txHash, explorerUrl: main.explorerUrl, approvalTxHash }
  } catch (e) {
    // "Failed" can mean the node never got it, or that it got it and we lost the
    // answer. Treat this as UNCERTAIN, never as "not sent": the nonce was pinned,
    // so a retry would either duplicate the spend or be rejected, and neither is
    // something to do automatically.
    noteBroadcast()
    openIfNeeded()
    track(() => noteUncertainBroadcast(intentId as string, nonce))
    const after = await getEvmPendingNonce(signer, chainId, config)
    const advanced = after != null && after > nonce
    throw new Error(
      (advanced
        ? `A transaction using nonce ${nonce} was accepted by the network, so this swap may already be in flight. `
        : `The swap was submitted with nonce ${nonce} but the network did not confirm receipt. It may or may not ` +
          'have been accepted — a node that has not caught up looks the same as one that never saw it. ') +
      `Check your activity for nonce ${nonce} on ${quote.fromChain} before retrying; do not send it again.` +
      `${sentSuffix(submitted)} (${e instanceof Error ? e.message : 'send failed'})`)
  }
}

/** Honest tail for an error message: what, if anything, actually went out. */
function sentSuffix(submitted: string[]): string {
  return submitted.length ? ` Already submitted: ${submitted.join(', ')}.` : ' Nothing was sent.'
}

/**
 * Refuse to sign an expired quote, and never claim nothing was sent when an
 * approval already went out.
 */
function assertQuoteStillFresh(
  quote: NormalizedSwapQuote, approvalTxHash: string | null, submitted: string[],
): void {
  if (quote.expiresAt > Date.now()) return
  const err = new SwapPreflightError(
    'The quote expired before the swap could be submitted, so it was not sent — prices move and executing a ' +
    `stale route would fill at a rate you did not approve.${sentSuffix(submitted)}` +
    (approvalTxHash ? ' That approval remains valid, so re-quoting will not need another one.' : ''))
  ;(err as SwapPreflightError & { approvalTxHash?: string | null }).approvalTxHash = approvalTxHash
  throw err
}

/** ERC-20 approve(spender, amount) calldata. */
function erc20ApproveData(spender: string, amount: bigint): string {
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  return `0x095ea7b3${addr}${amount.toString(16).padStart(64, '0')}`
}

/** The signing address for this account — needed to simulate AS the signer. */
function privateKeyToAddress(pk: string): string {
  return privateKeyToAccount(pk as `0x${string}`).address
}

/**
 * A simulation failure, in words, when we can name the cause.
 *
 * SystemError::ResultWithNegativeLamports (System Program custom error 0x1) means
 * an instruction tried to spend more SOL than the account holds. In swap routes
 * it comes from the Associated Token Program creating a token account (the
 * output token's, or a temporary wrapped-SOL one) and funding its rent.
 * Measured 2026-09-22 on a failing wallet: 0.00147 SOL held, 0.00149 SOL rent
 * for one token account. The WHOLE log is searched, not only the tail shown to
 * the user: a route that logs anything after the failing instruction would push
 * the System Program line out of a short window.
 */
export function describeSolanaSimulationFailure(err: unknown, logs: string[]): string {
  const all = logs.join(' | ')
  if (
    /Program 11111111111111111111111111111111 failed: custom program error: 0x1\b/i.test(all)
    && /ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL/.test(all)
  ) {
    return 'This route needs more SOL to create a required token account and cover Solana network fees. '
      + 'Add SOL, then refresh the quote.'
  }
  const tail = logs.slice(-3).join(' | ')
  return `${JSON.stringify(err)}${tail ? ` — ${tail}` : ''}`
}

/**
 * Dry-run a signed Solana transaction, mapped onto the same three outcomes as
 * the EVM path so one policy decides both.
 *
 * An RPC failure is `unavailable`, not `revert` — the difference is the whole
 * point (see applySimulation).
 */
async function simulateSolana(
  connection: Connection, tx: VersionedTransaction,
): Promise<EvmSimulationOutcome> {
  try {
    const sim = await connection.simulateTransaction(tx, {
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
    })
    if (sim.value.err) {
      return { status: 'revert', reason: describeSolanaSimulationFailure(sim.value.err, sim.value.logs ?? []) }
    }
    return { status: 'pass' }
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'simulation failed' }
  }
}

async function executeSolanaSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex: number,
  policy: SwapPolicyDecision,
  intentId?: string,
  identity?: SwapSigningIdentity,
): Promise<SwapExecuteResult> {
  if (!quote.txData.swapTransaction) {
    throw new SwapPreflightError('Quote did not include a Solana transaction to sign.')
  }
  const keypair = await getSolanaKeypair(mnemonic, accountIndex)
  const connection = new Connection(heliusRpcUrl(config), 'confirmed')

  const tx = VersionedTransaction.deserialize(Buffer.from(quote.txData.swapTransaction, 'base64'))

  // ── Who is being asked to sign, and for what? ─────────────────────────────
  // The aggregator hands back an opaque blob. Before this account's key touches
  // it, confirm it is OUR transaction: we must be the fee payer (account 0), and
  // we must be the ONLY required signer. A transaction expecting a second
  // signature cannot be completed by this path anyway, and one whose fee payer
  // is someone else is not the swap that was quoted.
  const required = tx.message.header.numRequiredSignatures
  const feePayer = tx.message.staticAccountKeys[0]?.toBase58()
  if (feePayer !== keypair.publicKey.toBase58()) {
    throw new SwapPreflightError(
      'Solana swap transaction is payable by a different account than the one signing it.')
  }
  if (required !== 1) {
    throw new SwapPreflightError(
      `Solana swap transaction expects ${required} signers; this wallet can only complete a single-signer swap.`)
  }

  // ── Enough SOL for THIS transaction? ──────────────────────────────────────
  // Re-read now, not trusted from the quote: the balance, account existence and
  // rent can all have moved. Same shared rule and wording as the quote screen.
  // An unreadable cost is not a verdict — simulation below still decides.
  const cost = await estimateSolanaSwapCost(
    quote.txData.swapTransaction, feePayer, connection,
    { paysOutSolToPayer: quote.toChain === 'solana' && isNativeSwapAddress('solana', quote.toTokenAddress) },
  ).catch(() => null)
  const shortfall = cost ? solanaShortfallMessage(cost) : null
  if (shortfall) throw new SwapPreflightError(`${shortfall} Nothing was sent.`)

  tx.sign([keypair])

  // ── Simulate before it reaches the network ────────────────────────────────
  // Signing costs nothing on-chain; broadcasting does. The send loop below runs
  // with skipPreflight (for a good reason documented there), which means this is
  // the ONLY point where a doomed transaction can still be caught.
  applySimulation(await simulateSolana(connection, tx), policy, 'Swap transaction')

  // LAST-MOMENT freshness: simulation and the RPC round trips above can take a
  // while, and this is the final point before the transaction is irreversible.
  assertQuoteStillFresh(quote, null, [])

  const raw = tx.serialize()
  const blockhash = tx.message.recentBlockhash

  // Send + KEEP re-broadcasting while polling status. Solana RPCs routinely drop
  // a tx from the mempool before it lands, which is what surfaces as
  // "TransactionExpiredBlockheightExceeded". Re-sending every couple of seconds
  // until the tx's OWN blockhash is no longer valid is the reliable pattern
  // (skipPreflight so a stale-state simulation doesn't reject a valid aggregator tx).
  const send = () => connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })
  // Past this point a signature exists on the network; the intent can never be
  // re-authorized even if confirmation later fails or times out.
  if (intentId) markSwapIntentBroadcast(intentId)
  const track = (fn: () => Promise<void>) => {
    if (!intentId || !identity) return
    fn().catch(() => { /* evidence store must never break a swap */ })
  }
  track(() => openSession(intentId as string, quote, identity as SwapSigningIdentity, { from: 9, to: 9 }))
  const sig = await send()
  track(() => noteSwapBroadcast(intentId as string, sig, SOLSCAN(sig), null))

  const confirmed = (s?: { err: unknown; confirmationStatus?: string } | null) =>
    !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const st = (await connection.getSignatureStatuses([sig])).value[0]
    if (st?.err) {
      // The fee rides inside this transaction, so a failed swap collected nothing.
      track(() => noteSourceReceipt(intentId as string, sig, false))
      throw new Error('Swap transaction failed on-chain.')
    }
    if (confirmed(st)) {
      track(() => noteSourceReceipt(intentId as string, sig, true))
      return { txHash: sig, explorerUrl: SOLSCAN(sig), approvalTxHash: null }
    }

    const stillValid = await connection.isBlockhashValid(blockhash, { commitment: 'confirmed' })
      .then(r => r.value).catch(() => true)
    if (!stillValid) break
    await send().catch(() => { /* keep polling; a re-broadcast may transiently fail */ })
    await new Promise(r => setTimeout(r, 2_000))
  }

  // One last check - it may have landed right at the edge of expiry.
  const final = (await connection.getSignatureStatuses([sig])).value[0]
  if (confirmed(final)) {
    track(() => noteSourceReceipt(intentId as string, sig, true))
    return { txHash: sig, explorerUrl: SOLSCAN(sig), approvalTxHash: null }
  }
  // Expired without landing is UNKNOWN, not failed: a signature exists and a
  // validator may still have it. Recording it as not-collected would be a guess.
  track(() => noteUncertainBroadcast(intentId as string, null))
  throw new Error('Solana transaction expired before it could land (network congestion) - please try again.')
}
