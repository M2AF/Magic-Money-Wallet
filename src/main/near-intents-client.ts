/**
 * near-intents-client.ts — NEAR Intents 1Click Swap API, for swaps OUT of
 * Cardano (ADA) to another chain (privileged layer).
 *
 * HOW THE ROUTE WORKS (docs.near-intents.org, "Making a Request", read
 * 2026-10-28): the wallet asks 1Click for a quote; a non-dry quote carries a
 * fresh DEPOSIT ADDRESS on Cardano. The wallet pays exactly the quoted ADA to it
 * in an ordinary payment it builds and signs itself. A solver then pays the
 * destination token to the user's own address on the other chain from its own
 * inventory. If no solver fills before the quote's deadline, the ADA is refunded
 * to `refundTo` (this wallet's Cardano address) minus the quoted refund fee.
 * Nothing is minted or burned by the wallet.
 *
 * CUSTODY: between the payment and the fill, the ADA sits at the deposit
 * address, controlled by NEAR Intents' Proof-of-Authority bridge — not by the
 * user. The UI states this before signing.
 *
 * WHAT IS TRUSTED, AND WHAT IS CHECKED
 *   - The quote's origin is checked: 1Click signs every quote with its manager
 *     key (pinned below, from @defuse-protocol/one-click-sdk-typescript 0.1.26);
 *     the signature covers the request terms, amounts, minimum, deposit address
 *     and deadline. A quote that does not verify is never paid.
 *   - The terms are checked against what the wallet asked for and what the
 *     user approved, field by field (`checkExecutableQuote`).
 *   - Delivery is never taken from 1Click's status alone: the destination
 *     transaction is measured on the destination chain (swap-delivery.ts).
 *   - `appFees` is NOT covered by the signature; the approved minimum output is
 *     what binds the user's price.
 */

import { sha256 } from '@noble/hashes/sha256'
import { ed25519 } from '@noble/curves/ed25519'
import { base58 } from '@scure/base'
import { decodeCardanoAddress } from './cardano-pure'

export const ONE_CLICK_BASE = 'https://1click.chaindefuser.com'
/** 1Click quote-signing key (ONE_CLICK_MANAGER_PUB_KEY in the official SDK 0.1.26). */
export const ONE_CLICK_MANAGER_PUBKEY = 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc'
/** Native ADA on Cardano, as 1Click names it (GET /v0/tokens, 2026-10-28). */
export const ONE_CLICK_CARDANO_ADA = 'nep141:cardano.omft.near'

/** Wallet chain id -> 1Click `blockchain`. Only chains with a destination-credit reader. */
export const ONE_CLICK_CHAINS: Readonly<Record<string, string>> = Object.freeze({
  solana: 'sol', ethereum: 'eth', base: 'base', arbitrum: 'arb', optimism: 'op', polygon: 'pol', bsc: 'bsc', avalanche: 'avax',
  monad: 'monad', robinhood: 'hood',
})

/** The deposit must be final well before the deposit address's deadline. */
export const DEADLINE_MS = 30 * 60_000
export const MIN_DEADLINE_HEADROOM_MS = 20 * 60_000

export class NearIntentsError extends Error {}
const fail = (why: string): never => { throw new NearIntentsError(why) }

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface OneClickToken {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  price: number | null
  contractAddress: string | null
}

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null
const TOKEN_TTL_MS = 10 * 60_000
export const __clearOneClickTokenCache = () => { tokenCache = null }

export async function fetchOneClickTokens(fetchFn: FetchFn = fetch, now = Date.now()): Promise<OneClickToken[]> {
  if (tokenCache && now - tokenCache.at < TOKEN_TTL_MS) return tokenCache.tokens
  const res = await fetchFn(`${ONE_CLICK_BASE}/v0/tokens`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) return fail(`NEAR Intents token list: HTTP ${res.status}`)
  const body = await res.json().catch(() => null) as unknown
  if (!Array.isArray(body)) return fail('NEAR Intents token list is not a list')
  const tokens: OneClickToken[] = []
  for (const t of body as Array<Record<string, unknown>>) {
    if (typeof t?.assetId !== 'string' || typeof t.blockchain !== 'string' || typeof t.symbol !== 'string'
        || !Number.isInteger(t.decimals)) continue
    tokens.push({
      assetId: t.assetId, decimals: t.decimals as number, blockchain: t.blockchain, symbol: t.symbol,
      price: typeof t.price === 'number' ? t.price : null,
      contractAddress: typeof t.contractAddress === 'string' && t.contractAddress ? t.contractAddress : null,
    })
  }
  tokenCache = { at: now, tokens }
  return tokens
}

/**
 * The 1Click asset for a wallet token, matched by chain AND exact contract (or
 * native) AND decimals. A symbol is never an identity.
 */
export function findOneClickAsset(
  tokens: readonly OneClickToken[], walletChain: string, tokenAddress: string, decimals: number | null | undefined, native: boolean,
): OneClickToken | null {
  const chain = ONE_CLICK_CHAINS[walletChain]
  if (!chain) return null
  const evm = walletChain !== 'solana'
  const hits = tokens.filter(t => t.blockchain === chain && (native
    ? t.contractAddress === null
    : t.contractAddress !== null && (evm ? t.contractAddress.toLowerCase() === tokenAddress.toLowerCase() : t.contractAddress === tokenAddress)))
  if (hits.length !== 1) return null
  if (decimals != null && hits[0].decimals !== decimals) return null
  return hits[0]
}

export interface OneClickQuoteParams {
  dry: boolean
  /** What is deposited; Cardano ADA when omitted (swaps out of Cardano). */
  originAsset?: string
  destinationAsset: string
  /** The deposit amount in the ORIGIN asset's base units (lovelace when it is ADA). */
  amountLovelace: string
  slippageBps: number
  refundTo: string
  recipient: string
  deadline: string
}

export function oneClickQuoteRequest(p: OneClickQuoteParams) {
  return {
    dry: p.dry, swapType: 'EXACT_INPUT', slippageTolerance: p.slippageBps,
    originAsset: p.originAsset ?? ONE_CLICK_CARDANO_ADA, depositType: 'ORIGIN_CHAIN',
    destinationAsset: p.destinationAsset, amount: p.amountLovelace,
    refundTo: p.refundTo, refundType: 'ORIGIN_CHAIN',
    recipient: p.recipient, recipientType: 'DESTINATION_CHAIN',
    deadline: p.deadline,
  }
}

export interface OneClickQuote {
  amountIn: string
  amountInUsd: string | null
  minAmountIn: string | null
  amountOut: string
  amountOutUsd: string | null
  minAmountOut: string
  timeEstimate: number | null
  refundFee: string | null
  withdrawFee: string | null
  depositAddress: string | null
  depositMemo: string | null
  deadline: string | null
  timeWhenInactive: string | null
  /** Kept verbatim for signature verification. */
  raw: Record<string, unknown>
}

export interface OneClickQuoteResponse {
  quote: OneClickQuote
  quoteRequest: Record<string, unknown>
  signature: string
  timestamp: string
  correlationId: string | null
}

const UINT = /^[0-9]{1,78}$/
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export function parseOneClickQuoteResponse(body: unknown): OneClickQuoteResponse {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return fail('NEAR Intents quote is malformed')
  const q = b.quote as Record<string, unknown> | undefined
  const r = b.quoteRequest as Record<string, unknown> | undefined
  if (!q || typeof q !== 'object' || !r || typeof r !== 'object') return fail('NEAR Intents quote is incomplete')
  if (typeof b.signature !== 'string' || typeof b.timestamp !== 'string') return fail('NEAR Intents quote is not signed')
  const amountIn = str(q.amountIn), amountOut = str(q.amountOut), minAmountOut = str(q.minAmountOut)
  if (!amountIn || !UINT.test(amountIn) || !amountOut || !UINT.test(amountOut) || !minAmountOut || !UINT.test(minAmountOut)) {
    return fail('NEAR Intents quote amounts are malformed')
  }
  const uintOrNull = (v: unknown) => { const s = str(v); return s && UINT.test(s) ? s : null }
  return {
    quote: {
      amountIn, amountInUsd: str(q.amountInUsd), minAmountIn: uintOrNull(q.minAmountIn),
      amountOut, amountOutUsd: str(q.amountOutUsd), minAmountOut,
      timeEstimate: typeof q.timeEstimate === 'number' ? q.timeEstimate : null,
      refundFee: uintOrNull(q.refundFee), withdrawFee: uintOrNull(q.withdrawFee),
      depositAddress: str(q.depositAddress), depositMemo: str(q.depositMemo),
      deadline: str(q.deadline), timeWhenInactive: str(q.timeWhenInactive), raw: q,
    },
    quoteRequest: r, signature: b.signature, timestamp: b.timestamp,
    correlationId: str(b.correlationId),
  }
}

/** Magic Money's Worker route that adds the 1Click partner key (cloudflare-worker/near-intents.js). */
export interface OneClickProxy { url: string; headers: Record<string, string> }

/**
 * Request a quote. With `proxy`, it goes through Magic Money's Worker (partner
 * key); if that route is unreachable, not deployed, or failing, the request is
 * repeated directly and keyless. A 4xx from 1Click itself is an answer, not an
 * outage, and is not retried. The signature is verified by the caller either way.
 */
export async function requestOneClickQuote(
  params: OneClickQuoteParams, opts: { fetchFn?: FetchFn; apiKey?: string | null; proxy?: OneClickProxy | null } = {},
): Promise<OneClickQuoteResponse> {
  const fetchFn = opts.fetchFn ?? fetch
  const body = JSON.stringify(oneClickQuoteRequest(params))
  const read = async (res: Response) => {
    const data = await res.json().catch(() => null) as Record<string, unknown> | null
    if (!res.ok) return fail(typeof data?.message === 'string' ? `NEAR Intents: ${data.message}` : `NEAR Intents quote: HTTP ${res.status}`)
    return parseOneClickQuoteResponse(data)
  }
  if (opts.proxy) {
    let res: Response | null = null
    try {
      res = await fetchFn(opts.proxy.url, {
        method: 'POST', headers: { ...opts.proxy.headers, 'content-type': 'application/json', accept: 'application/json' },
        body, signal: AbortSignal.timeout(30_000),
      })
    } catch { res = null }
    // 404/403 = the Worker predates this route or rejects the client; 5xx/429/none = unavailable.
    if (res && res.status !== 404 && res.status !== 403 && res.status !== 429 && res.status < 500) return read(res)
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  if (opts.apiKey) headers['x-api-key'] = opts.apiKey
  return read(await fetchFn(`${ONE_CLICK_BASE}/v0/quote`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) }))
}

// ── Quote signature (mirrors verifyQuoteSignature in the official SDK) ─────────

/** json-stable-stringify: keys sorted, undefined members dropped. */
function stable(v: unknown): string | undefined {
  if (v === undefined) return undefined
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(x => stable(x) ?? 'null').join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',') + '}'
}

const orUndef = (v: unknown) => (v ? v : undefined)

export function oneClickQuoteHash(resp: OneClickQuoteResponse): string {
  const r = resp.quoteRequest, q = resp.quote.raw
  const request = {
    dry: r.dry, swapType: r.swapType, slippageTolerance: r.slippageTolerance, originAsset: r.originAsset,
    depositType: r.depositType, destinationAsset: r.destinationAsset, amount: r.amount, refundTo: r.refundTo,
    refundType: r.refundType, recipient: r.recipient, recipientType: r.recipientType, deadline: r.deadline,
    quoteWaitingTimeMs: orUndef(r.quoteWaitingTimeMs), referral: orUndef(r.referral),
    virtualChainRecipient: orUndef(r.virtualChainRecipient), virtualChainRefundRecipient: orUndef(r.virtualChainRefundRecipient),
    customRecipientMsg: orUndef(r.customRecipientMsg),
  }
  const amounts = {
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd, minAmountIn: q.minAmountIn,
    amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd, minAmountOut: q.minAmountOut,
  }
  const quote = r.dry ? amounts : {
    ...amounts, depositAddress: orUndef(q.depositAddress), depositMemo: orUndef(q.depositMemo), deadline: orUndef(q.deadline),
    timeWhenInactive: orUndef(q.timeWhenInactive), timeEstimate: orUndef(q.timeEstimate),
    refundFee: orUndef(q.refundFee), withdrawFee: orUndef(q.withdrawFee),
  }
  const data = stable({ ...request, ...quote, timestamp: resp.timestamp }) as string
  return base58.encode(sha256(new TextEncoder().encode(data)))
}

export function verifyOneClickQuoteSignature(resp: OneClickQuoteResponse, managerKey = ONE_CLICK_MANAGER_PUBKEY): boolean {
  try {
    const strip = (s: string) => (s.startsWith('ed25519:') ? s.slice(8) : s)
    return ed25519.verify(base58.decode(strip(resp.signature)), new TextEncoder().encode(oneClickQuoteHash(resp)), base58.decode(strip(managerKey)))
  } catch { return false }
}

// ── The checks before a deposit may be paid ───────────────────────────────────

/** A Cardano MAINNET key-hash address (base or enterprise). Scripts, pointers and Byron are refused. */
export function checkCardanoDepositAddress(address: string, own: string): string | null {
  if (address === own) return 'The deposit address is this wallet\'s own address.'
  let b: Uint8Array
  try { b = decodeCardanoAddress(address) } catch { return 'The deposit address is not a Cardano address.' }
  if ((b[0] & 0x0f) !== 1) return 'The deposit address is not on Cardano mainnet.'
  const type = b[0] >> 4
  if (!((type === 0 || type === 2) && b.length === 57) && !(type === 6 && b.length === 29)) {
    return 'The deposit address is not a plain key address (base or enterprise).'
  }
  return null
}

/**
 * A deposit address on the chain the deposit is paid on: a plain account the
 * wallet can pay with an ordinary transfer, and never this wallet's own.
 */
export function checkDepositAddress(chain: string, address: string, own: string): string | null {
  if (chain === 'cardano') return checkCardanoDepositAddress(address, own)
  if (chain === 'solana') {
    let b: Uint8Array
    try { b = base58.decode(address) } catch { return 'The deposit address is not a Solana address.' }
    if (b.length !== 32 || address === '11111111111111111111111111111111') return 'The deposit address is not a Solana account.'
    return address === own ? "The deposit address is this wallet's own address." : null
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return 'The deposit address is not an EVM account address.'
  return address.toLowerCase() === own.toLowerCase() ? "The deposit address is this wallet's own address." : null
}

export interface ExecutableQuoteExpectation {
  /** Defaults: Cardano ADA, paid on Cardano. */
  originAsset?: string
  originChain?: string
  destinationAsset: string
  amountLovelace: string
  slippageBps: number
  refundTo: string
  recipient: string
  /** The minimum output the user approved (raw destination units). */
  approvedMinOutRaw: string
  now: number
}

/**
 * Everything a live, non-dry quote must satisfy before the wallet pays its
 * deposit address. Returns the deposit address, or throws with the reason.
 */
export function checkExecutableQuote(
  resp: OneClickQuoteResponse, want: ExecutableQuoteExpectation, managerKey = ONE_CLICK_MANAGER_PUBKEY,
): { depositAddress: string; deadlineMs: number } {
  if (!verifyOneClickQuoteSignature(resp, managerKey)) fail('The NEAR Intents quote signature does not verify.')
  const r = resp.quoteRequest, q = resp.quote
  const same = r.dry === false && r.swapType === 'EXACT_INPUT' && r.originAsset === (want.originAsset ?? ONE_CLICK_CARDANO_ADA)
    && r.depositType === 'ORIGIN_CHAIN' && r.destinationAsset === want.destinationAsset && r.amount === want.amountLovelace
    && r.refundTo === want.refundTo && r.refundType === 'ORIGIN_CHAIN' && r.recipient === want.recipient
    && r.recipientType === 'DESTINATION_CHAIN' && r.slippageTolerance === want.slippageBps
  if (!same) fail('The NEAR Intents quote does not match the requested swap.')
  if (q.amountIn !== want.amountLovelace) fail('The NEAR Intents quote takes a different deposit amount.')
  if (BigInt(q.minAmountOut) < BigInt(want.approvedMinOutRaw)) {
    fail('The price moved: the guaranteed minimum is now below what you approved. Refresh the quote.')
  }
  if (!q.depositAddress) return fail('The NEAR Intents quote has no deposit address.')
  if (q.depositMemo) fail('The NEAR Intents quote needs a deposit memo, which this wallet does not send.')
  const bad = checkDepositAddress(want.originChain ?? 'cardano', q.depositAddress, want.refundTo)
  if (bad) fail(bad)
  const deadlineMs = q.deadline ? Date.parse(q.deadline) : NaN
  if (!Number.isFinite(deadlineMs) || deadlineMs - want.now < MIN_DEADLINE_HEADROOM_MS) {
    fail('The NEAR Intents deposit address expires too soon to be paid safely.')
  }
  return { depositAddress: q.depositAddress, deadlineMs }
}

// ── Status ────────────────────────────────────────────────────────────────────

export type OneClickStatus = 'PENDING_DEPOSIT' | 'KNOWN_DEPOSIT_TX' | 'PROCESSING' | 'SUCCESS' | 'INCOMPLETE_DEPOSIT' | 'REFUNDED' | 'FAILED'
const STATUSES = new Set<OneClickStatus>(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED'])

export interface OneClickStatusReport {
  status: OneClickStatus | 'UNRECOGNIZED'
  rawStatus: string
  destinationTxHashes: string[]
  originTxHashes: string[]
  amountOut: string | null
  refundedAmount: string | null
  refundReason: string | null
}

export async function fetchOneClickStatus(depositAddress: string, fetchFn: FetchFn = fetch): Promise<OneClickStatusReport | null> {
  const res = await fetchFn(`${ONE_CLICK_BASE}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null
  if (!res.ok) return fail(`NEAR Intents status: HTTP ${res.status}`)
  const b = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!b || typeof b.status !== 'string') return fail('NEAR Intents status is malformed')
  const d = (b.swapDetails ?? {}) as Record<string, unknown>
  const hashes = (v: unknown) => Array.isArray(v) ? v.map(x => (x as { hash?: unknown })?.hash).filter((h): h is string => typeof h === 'string' && h.length > 0) : []
  const uintOrNull = (v: unknown) => { const s = str(v); return s && UINT.test(s) ? s : null }
  return {
    status: STATUSES.has(b.status as OneClickStatus) ? b.status as OneClickStatus : 'UNRECOGNIZED',
    rawStatus: b.status,
    destinationTxHashes: hashes(d.destinationChainTxHashes),
    originTxHashes: hashes(d.originChainTxHashes),
    amountOut: uintOrNull(d.amountOut),
    refundedAmount: uintOrNull(d.refundedAmount),
    refundReason: str(d.refundReason),
  }
}

/** Optional speed-up: tell 1Click the deposit's transaction hash. Best-effort. */
export async function submitOneClickDeposit(depositAddress: string, txHash: string, fetchFn: FetchFn = fetch): Promise<void> {
  try {
    await fetchFn(`${ONE_CLICK_BASE}/v0/deposit/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ depositAddress, txHash }), signal: AbortSignal.timeout(15_000),
    })
  } catch { /* the deposit is detected on chain anyway */ }
}
