/**
 * swap-intent.ts — binds an approved swap to the exact quote the wallet issued,
 * for the exact wallet, account and environment it was issued to.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The flow was: renderer asks for a quote, privileged layer returns a
 * `NormalizedSwapQuote`, renderer later hands *an object* back to
 * `swap:execute`, and the executor signed whatever arrived. Every material term
 * — calldata, router, recipient, approval spender, minimum received — was
 * round-tripped through the untrusted side and taken on faith. Structural
 * validation cannot close that: `0xdead…beef` is a valid address and a
 * substituted router is valid calldata.
 *
 * THE CAPACITOR SEAM — why copying is not optional
 *
 * Electron IPC and Chrome message passing serialize, so the renderer there gets
 * a structural clone for free. `src/capacitor/wallet-local.ts` calls `handle()`
 * **in the same JavaScript realm**: no serialization, no clone. Returning the
 * stored object there handed the untrusted caller a live reference to the
 * wallet's own record, and `issued.txData.to = attacker` rewrote what the intent
 * map held. Comparing the submission against the store could not catch it,
 * because both sides were the same object.
 *
 * So every value crossing this boundary is deep-copied, in both directions, and
 * the stored copy is deep-frozen. Note what that does and does not buy:
 * copying stops reference sharing, it does NOT create process isolation. On
 * Android and iOS the renderer and this code share one realm and one heap; the
 * boundary there is a discipline this module enforces, not something the
 * platform enforces for us. On desktop and the extension the process boundary
 * is real.
 *
 * IDENTITY, NOT JUST AN ACCOUNT INDEX
 *
 * Index 0 means a different wallet after an import or replacement, so an index
 * alone is not an identity. An intent is bound to a fingerprint of the active
 * wallet's public addresses, the account index, the environment (mainnet vs
 * testnet) and the canonical source/destination addresses the wallet itself
 * derived — never the ones the renderer asked for. All of that is re-derived at
 * execute time and must match. No secret material is stored to do it.
 *
 * Intents are short-lived, single-use and in-memory. Persisting them would
 * create a replayable on-disk record of signable transactions; losing them on a
 * service-worker suspension fails CLOSED, which is the correct direction.
 */

import { APP_FEE_BPS, SWAP_FEE_POLICY_VERSION } from '../shared/swap-fee-policy'
import { feeTermsFingerprint } from './swap-fee'
import type { NormalizedSwapQuote, SwapQuoteRequest } from './swap-proxy'

/**
 * Everything that must be the same at execute time as it was at quote time.
 *
 * `walletId` is a fingerprint of PUBLIC addresses — it identifies which wallet
 * is active so a replacement invalidates pending authorizations. It is not a
 * secret and never derives from key material.
 */
export interface SwapSigningIdentity {
  walletId: string
  accountIndex: number
  environment: 'mainnet' | 'testnet'
  /** Canonical signing address on the source chain, derived by the wallet. */
  sourceAddress: string
  /** Canonical receiving address on the destination chain, derived by the wallet. */
  destinationAddress: string
}

export interface BoundSwapIntent {
  intentId: string
  createdAt: number
  identity: SwapSigningIdentity
  /** The canonical request, as the wallet resolved it. Deep-frozen. */
  request: Readonly<SwapQuoteRequest>
  /** The quote the wallet issued. Deep-frozen; execution uses a fresh copy. */
  quote: Readonly<NormalizedSwapQuote>
  consumedAt: number | null
  /**
   * Set once ANY transaction for this intent has been broadcast. An intent that
   * reached the network can never be released for retry — that is exactly the
   * duplicate spend this module exists to prevent.
   */
  broadcast: boolean
}

/** Quotes live 20–30s; this only has to outlast the user pressing the button. */
const INTENT_TTL_MS = 5 * 60_000
/** Bounded so a renderer that spams quotes cannot grow this without limit. */
const MAX_INTENTS = 50

const intents = new Map<string, BoundSwapIntent>()

/**
 * Structured deep copy.
 *
 * Quotes are plain JSON-shaped data, so `structuredClone` and a JSON round-trip
 * agree; the fallback exists for runtimes without the global. A shallow spread
 * is NOT sufficient — the nested `txData`/`approvalTx`/`permitTx` objects are
 * exactly the ones an attacker wants to reach.
 */
function deepCopy<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone
  if (typeof sc === 'function') {
    try { return sc(value) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

/** Freeze an object graph so an accidental internal write fails loudly. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

function sweep(now: number): void {
  for (const [id, intent] of intents) {
    if (now - intent.createdAt > INTENT_TTL_MS) intents.delete(id)
  }
  while (intents.size > MAX_INTENTS) {
    const oldest = intents.keys().next()
    if (oldest.done) break
    intents.delete(oldest.value)
  }
}

function newIntentId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

export class SwapIntentError extends Error {}

/** Public addresses the wallet derived, as both quote handlers already hold them. */
export interface SwapIdentityAddresses {
  evm: string
  solana: string
  /** Base address for the account; optional because older stores may lack it. */
  cardano?: string
  accountIndex: number
}

/**
 * Build the signing identity from the wallet's OWN derived addresses.
 *
 * `sourceAddress`/`destinationAddress` come from here, not from the renderer's
 * request, so a forged `taker` cannot describe an account that is not the one
 * this wallet will actually sign with.
 *
 * `walletId` is a fingerprint of public addresses. Two different wallets both
 * sitting at account index 0 produce different ids, which is the case an index
 * alone cannot distinguish after an import or replacement.
 */
export function buildSwapIdentity(
  addresses: SwapIdentityAddresses,
  fromChain: string,
  toChain: string,
  testnet: boolean,
): SwapSigningIdentity {
  const addrFor = (chain: string) => {
    const c = (chain ?? '').toLowerCase()
    if (c === 'solana') return addresses.solana ?? ''
    if (c === 'cardano') return addresses.cardano ?? ''
    return addresses.evm ?? ''
  }
  return {
    // Public addresses only — no key material, and nothing derived from it.
    // Deliberately unchanged by Cardano support: sessions are keyed by it, and
    // the EVM + Solana pair already distinguishes one wallet from another.
    walletId: `${(addresses.evm ?? '').toLowerCase()}|${addresses.solana ?? ''}`,
    accountIndex: addresses.accountIndex ?? 0,
    environment: testnet ? 'testnet' : 'mainnet',
    sourceAddress: addrFor(fromChain),
    destinationAddress: addrFor(toChain),
  }
}

/** Two identities match only if every component does. */
export function sameSigningIdentity(a: SwapSigningIdentity, b: SwapSigningIdentity): boolean {
  return a.walletId === b.walletId
    && a.accountIndex === b.accountIndex
    && a.environment === b.environment
    && a.sourceAddress.toLowerCase() === b.sourceAddress.toLowerCase()
    && a.destinationAddress.toLowerCase() === b.destinationAddress.toLowerCase()
}

/**
 * Record a freshly issued quote and stamp it with an id.
 *
 * Returns a SEPARATE deep copy for the caller. The caller may do whatever it
 * likes to that copy; it shares no reference with what this module stored.
 *
 * Throws when the provider's response contradicts the canonical request — a
 * response is data, not authority, and a quote that sells a different token or
 * a different amount than was asked for must never become a signable intent.
 */
export function bindSwapIntent(
  request: SwapQuoteRequest,
  quote: NormalizedSwapQuote,
  identity: SwapSigningIdentity,
): NormalizedSwapQuote {
  assertQuoteMatchesRequest(request, quote, identity)

  const now = Date.now()
  sweep(now)
  const intentId = newIntentId()

  const storedQuote = deepFreeze(deepCopy({ ...quote, intentId }))
  const storedRequest = deepFreeze(deepCopy(request))

  intents.set(intentId, {
    intentId,
    createdAt: now,
    identity: deepFreeze(deepCopy(identity)),
    request: storedRequest,
    quote: storedQuote,
    consumedAt: null,
    broadcast: false,
  })

  // A distinct copy for the untrusted side.
  return deepCopy(storedQuote)
}

/**
 * Validate the provider's answer against what the wallet actually asked for.
 *
 * The quote comes back through the same untrusted transport as everything else,
 * and a provider is not an authority on which account is spending. Chains,
 * tokens, the sell amount and the recipient must all be the ones the wallet
 * resolved, not the ones the response asserts.
 */
function assertQuoteMatchesRequest(
  request: SwapQuoteRequest,
  quote: NormalizedSwapQuote,
  identity: SwapSigningIdentity,
): void {
  const eq = (a: string, b: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
  const fail = (what: string): never => {
    throw new SwapIntentError(`Quote does not match the request (${what}) — refusing to prepare it for signing.`)
  }

  if (!eq(quote.fromChain, request.fromChain)) fail('source network')
  if (!eq(quote.toChain, request.toChain)) fail('destination network')
  if (!eq(quote.fromTokenAddress, request.fromToken)) fail('sell token')
  if (!eq(quote.toTokenAddress, request.toToken)) fail('buy token')
  if (quote.sellAmountRaw !== request.sellAmountRaw) fail('sell amount')

  // The recipient must be the wallet's own canonical destination address. A
  // quote is the one place a redirected recipient would look routine.
  const recipient = quote.toAddress ?? identity.destinationAddress
  if (!eq(recipient, identity.destinationAddress)) fail('recipient')

  // The request itself must have been built for this identity.
  if (!eq(request.taker, identity.sourceAddress)) fail('source account')

  // ---- Fee terms are part of what is being approved ------------------------
  // The fee record is bound into the frozen intent along with everything else,
  // so the terms shown to the user are the terms that execute. A quote priced
  // under a superseded policy version cannot become a signable intent: the user
  // approved a specific rate, recipient and fee token, and a policy change makes
  // those stale rather than merely different.
  //
  // A fee-FREE record (tier 2) is bound just as firmly. "No Magic Money fee" is
  // a term the user was shown, so a rewrite of it between quote and execute is
  // exactly the tampering this function exists to catch -- the rate must be
  // either the policy rate or zero, and nothing in between.
  const fee = quote.appFee
  if (!fee) fail('app fee terms')
  if (fee!.policyVersion !== SWAP_FEE_POLICY_VERSION) fail('fee policy version')
  if (fee!.requestedBps !== APP_FEE_BPS && fee!.requestedBps !== 0) fail('app fee rate')
  if (fee!.provider !== quote.provider) fail('fee provider')
}

/**
 * Look up the quote the wallet issued, verify the identity still matches, and
 * mark it spent.
 *
 * Returns a FRESH deep copy: nothing the caller does to it during asynchronous
 * execution can change the validated terms held here.
 */
export function consumeSwapIntent(
  intentId: unknown,
  identity: SwapSigningIdentity,
): { intentId: string; quote: NormalizedSwapQuote; request: SwapQuoteRequest } {
  if (typeof intentId !== 'string' || !intentId) {
    throw new SwapIntentError(
      'This swap was not requested through the wallet — refresh the quote and try again.')
  }
  const intent = intents.get(intentId)
  if (!intent) {
    throw new SwapIntentError('Swap quote is no longer available — refresh the quote and try again.')
  }
  if (Date.now() - intent.createdAt > INTENT_TTL_MS) {
    intents.delete(intentId)
    throw new SwapIntentError('Swap quote has expired — refresh the quote and try again.')
  }
  if (intent.consumedAt != null) {
    throw new SwapIntentError('This swap has already been submitted — check your activity before retrying.')
  }
  if (!sameSigningIdentity(intent.identity, identity)) {
    // Covers a switched account, a replaced/imported wallet that reuses the same
    // index, an environment flip, and a changed receiving address.
    throw new SwapIntentError(
      'This quote was prepared for a different wallet or account — refresh the quote and try again.')
  }
  intent.consumedAt = Date.now()
  return {
    intentId: intent.intentId,
    quote: deepCopy(intent.quote) as NormalizedSwapQuote,
    request: deepCopy(intent.request) as SwapQuoteRequest,
  }
}

/**
 * Mark that a transaction for this intent has reached the network.
 *
 * After this the intent can never be released for retry, whatever error follows
 * — an approval that was broadcast is a real, on-chain event even if the swap
 * behind it never happened.
 */
export function markSwapIntentBroadcast(intentId: string): void {
  const intent = intents.get(intentId)
  if (intent) intent.broadcast = true
}

export function wasSwapIntentBroadcast(intentId: string): boolean {
  return intents.get(intentId)?.broadcast ?? false
}

/**
 * Release an intent whose execution never reached the network.
 *
 * Refuses to release once anything has been broadcast, so a caller that
 * mis-classifies an error cannot turn it into a double spend.
 */
export function releaseSwapIntent(intentId: string): void {
  const intent = intents.get(intentId)
  if (intent && !intent.broadcast) intent.consumedAt = null
}

/**
 * Drop every pending authorization.
 *
 * Called when the wallet locks or the active wallet/account changes: a pending
 * authorization must not survive the identity it was granted under.
 */
export function invalidateSwapIntents(): void {
  intents.clear()
}

/** Material terms that must match between the stored quote and the submitted one. */
const BOUND_FIELDS = [
  'provider', 'fromChain', 'toChain', 'fromTokenAddress', 'toTokenAddress',
  'sellAmountRaw', 'buyAmountRaw', 'minBuyAmountRaw', 'slippageBps', 'toAddress', 'feeBps',
] as const

export interface IntentMismatch {
  field: string
  expected: unknown
  received: unknown
}

/**
 * Diff the renderer's copy against the stored quote.
 *
 * Execution does not depend on this — the stored quote is what gets signed
 * either way. It exists so tampering or a genuine client/main drift surfaces as
 * a specific, reportable difference instead of being silently discarded.
 */
export function diffSubmittedQuote(
  stored: NormalizedSwapQuote,
  submitted: unknown,
): IntentMismatch[] {
  if (!submitted || typeof submitted !== 'object') return []
  const s = submitted as Record<string, unknown>
  const out: IntentMismatch[] = []
  for (const field of BOUND_FIELDS) {
    const expected = (stored as unknown as Record<string, unknown>)[field]
    const received = s[field]
    if (received === undefined) continue
    if (String(expected ?? '') !== String(received ?? '')) {
      out.push({ field, expected, received })
    }
  }
  // Fee terms are compared as one fingerprint rather than field by field: a
  // rewritten recipient and a rewritten amount are the same class of tampering,
  // and reporting them separately would bury the point.
  if (s.appFee !== undefined) {
    const expected = feeTermsFingerprint(stored.appFee)
    const received = feeTermsFingerprint(s.appFee as NormalizedSwapQuote['appFee'])
    if (expected !== received) {
      out.push({ field: 'appFee', expected, received })
    }
  }
  const cmp = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
  if (s.txData !== undefined && cmp(stored.txData, s.txData)) {
    out.push({ field: 'txData', expected: '(stored payload)', received: '(different payload)' })
  }
  if (s.approvalTx !== undefined && cmp(stored.approvalTx, s.approvalTx)) {
    out.push({ field: 'approvalTx', expected: '(stored approval)', received: '(different approval)' })
  }
  if (s.permitTx !== undefined && cmp(stored.permitTx, s.permitTx)) {
    out.push({ field: 'permitTx', expected: '(stored permit)', received: '(different permit)' })
  }
  // The failure mode is part of what the user approved: a submission claiming a
  // different guarantee or fallback asset is a different plan.
  if (s.destination !== undefined && cmp(stored.destination, s.destination)) {
    out.push({ field: 'destination', expected: '(stored destination terms)', received: '(different terms)' })
  }
  return out
}

/** Test seam — drops every stored intent. */
export function __clearSwapIntents(): void {
  intents.clear()
}
