/**
 * stablecoin-journey.ts — the durable parent record of one stablecoin journey
 * (source swap -> bridge -> destination swap). Pure data and transitions; the
 * platform stores persist the JSON this module produces and parses.
 *
 * Rules the transitions enforce (docs/USDCX-STABLECOIN-ROUTING-PLAN.md):
 *   - Legs run in order, each only after the user approves it. Approving a leg
 *     requires the previous leg's MEASURED output, and the approved input may
 *     not exceed it: estimates never authorize a later spend.
 *   - A transaction hash is recorded BEFORE broadcast and is never replaced or
 *     cleared. An uncertain broadcast stays uncertain until chain evidence says
 *     otherwise; nothing here rebuilds, resends or burns again.
 *   - An active journey has no expiry: a pending bridge leg must survive
 *     restarts and the ordinary swap-session lifetime.
 *   - The record holds identities, amounts, hashes and states only — never
 *     keys, witnesses, CBOR or calldata (the parser refuses unknown fields).
 */

import type { ExactAsset, StablecoinBridgeId, StablecoinChain } from './stablecoin-route'

export type JourneyLegRole = 'source-swap' | 'bridge' | 'destination-swap'
export type JourneyLegState =
  | 'skipped' | 'planned' | 'approved'
  /** Hash recorded; broadcast attempted. */
  | 'submitted'
  /** Broadcast outcome unknown: poll the recorded hash, never resend. */
  | 'uncertain'
  | 'confirmed' | 'failed' | 'needs-review'

export interface JourneyLeg {
  role: JourneyLegRole
  state: JourneyLegState
  chain: StablecoinChain
  input: ExactAsset
  output: ExactAsset
  /** Set at approval: never more than the previous leg's measured output. */
  approvedInputRaw: string | null
  /** Recorded before broadcast; immutable once set. */
  txHash: string | null
  /** The bridge's own reference once known (CCIP message id); immutable once set. */
  providerRef: string | null
  /** A token approval this step needed, recorded before its broadcast; immutable once set. */
  approvalTxHash: string | null
  /** Measured on chain after confirmation (never a quote). */
  measuredOutputRaw: string | null
  updatedAt: number
}

export type JourneyBridgeId = StablecoinBridgeId | 'ccip-cbada'

export interface StablecoinJourney {
  version: 1
  id: string
  walletId: string
  createdAt: number
  bridge: JourneyBridgeId
  recipient: string
  legs: [JourneyLeg, JourneyLeg, JourneyLeg]
  status: 'active' | 'completed' | 'stopped'
  /**
   * What the user approved for a CCIP bridge step, stored at approval time and
   * never changed: any different term needs a NEW approval (a new journey).
   * Executors read their terms from here, never from a caller.
   */
  authorization: CcipAuthorization | null
}

export interface CcipAuthorization {
  /** The Base address that signs (this wallet's, at this account index). */
  sender: string
  accountIndex: number
  /** Ceiling for the CCIP router fee (paid as msg.value). A ceiling, not the expected fee. */
  maxCcipFeeWei: string
  /** Ceiling for the approval transaction's total network gas (gas x max fee per gas). */
  maxApprovalGasWei: string
  /** Ceiling for the bridge transaction's total network gas. */
  maxSendGasWei: string
  approvedAt: number
}

export class JourneyError extends Error {}
const fail = (why: string): never => { throw new JourneyError(why) }
const UINT = /^(0|[1-9][0-9]{0,77})$/
const ORDER: JourneyLegRole[] = ['source-swap', 'bridge', 'destination-swap']
const DONE: JourneyLegState[] = ['confirmed', 'skipped']

function leg(role: JourneyLegRole, chain: StablecoinChain, input: ExactAsset, output: ExactAsset, now: number, skip: boolean): JourneyLeg {
  return { role, state: skip ? 'skipped' : 'planned', chain, input, output, approvedInputRaw: null, txHash: null, providerRef: null, approvalTxHash: null, measuredOutputRaw: null, updatedAt: now }
}

export function createJourney(args: {
  id: string; walletId: string; now: number; bridge: JourneyBridgeId; recipient: string
  /** usdcx/usdc: the intermediate on the source and destination chains (USDCx/USDC, or cbADA/cbADA). */
  source: ExactAsset; usdcx: ExactAsset; usdc: ExactAsset; destination: ExactAsset
}): StablecoinJourney {
  const { now } = args
  return {
    version: 1, id: args.id, walletId: args.walletId, createdAt: now, bridge: args.bridge, recipient: args.recipient,
    legs: [
      leg('source-swap', args.source.chain, args.source, args.usdcx, now, same(args.source, args.usdcx)),
      leg('bridge', args.usdcx.chain, args.usdcx, args.usdc, now, false),
      leg('destination-swap', args.usdc.chain, args.usdc, args.destination, now, same(args.destination, args.usdc)),
    ],
    status: 'active',
    authorization: null,
  }
}

/** The source/destination token already IS the intermediate on that chain. */
const same = (a: ExactAsset, b: ExactAsset) =>
  a.chain === b.chain && (a.chain === 'solana' || a.chain === 'cardano' ? a.address === b.address : a.address.toLowerCase() === b.address.toLowerCase())

const indexOf = (role: JourneyLegRole) => ORDER.indexOf(role)
const replace = (j: StablecoinJourney, i: number, next: JourneyLeg, status = j.status): StablecoinJourney => {
  const legs = [...j.legs] as StablecoinJourney['legs']
  legs[i] = next
  return { ...j, legs, status }
}

/** The output the leg before `role` actually delivered (or the source amount for the first leg). */
function measuredBefore(j: StablecoinJourney, i: number, sourceAmountRaw: string | null): string | null {
  for (let k = i - 1; k >= 0; k--) {
    const prev = j.legs[k]
    if (prev.state === 'skipped') continue
    return prev.state === 'confirmed' ? prev.measuredOutputRaw : null
  }
  return sourceAmountRaw
}

/**
 * Approve a leg. The previous leg must be confirmed with a measured output, and
 * the approved input may not exceed it. `sourceAmountRaw` is the amount the user
 * holds for the first non-skipped leg.
 */
export function approveLeg(j: StablecoinJourney, role: JourneyLegRole, inputRaw: string, now: number, sourceAmountRaw: string | null = null): StablecoinJourney {
  if (j.status !== 'active') fail('This journey is no longer active.')
  const i = indexOf(role)
  const current = j.legs[i]
  if (current.state !== 'planned') fail('This step cannot be approved now.')
  for (let k = 0; k < i; k++) if (!DONE.includes(j.legs[k].state)) fail('An earlier step has not completed.')
  if (!UINT.test(inputRaw) || inputRaw === '0') fail('Invalid amount.')
  const available = measuredBefore(j, i, sourceAmountRaw)
  if (available === null) fail('The earlier step\'s received amount has not been measured yet.')
  if (BigInt(inputRaw) > BigInt(available as string)) fail('The amount exceeds what the earlier step actually delivered.')
  return replace(j, i, { ...current, state: 'approved', approvedInputRaw: inputRaw, updatedAt: now })
}

/** Record the hash BEFORE broadcasting. A leg's hash is set once and never replaced. */
export function recordLegSubmitted(j: StablecoinJourney, role: JourneyLegRole, txHash: string, now: number): StablecoinJourney {
  const i = indexOf(role)
  const current = j.legs[i]
  if (current.txHash) fail('This step already has a transaction; it is never replaced.')
  if (current.state !== 'approved') fail('This step was not approved.')
  if (typeof txHash !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$|^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(txHash)) fail('Invalid transaction hash.')
  return replace(j, i, { ...current, state: 'submitted', txHash, updatedAt: now })
}

export type LegOutcome =
  | { state: 'confirmed'; measuredOutputRaw: string }
  | { state: 'uncertain' | 'failed' | 'needs-review' }

/**
 * Record the hash of the token approval an approved step needs, BEFORE its
 * broadcast. Set once and never replaced: an approval whose outcome is unknown
 * is checked by reading the allowance, never sent again.
 */
export function recordLegApprovalSent(j: StablecoinJourney, role: JourneyLegRole, txHash: string, now: number): StablecoinJourney {
  const i = indexOf(role)
  const current = j.legs[i]
  if (current.state !== 'approved' || current.txHash) fail('Only an approved, unsent step can record an approval.')
  if (current.approvalTxHash) fail('This step already has an approval transaction; it is never replaced.')
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) fail('Invalid approval hash.')
  return replace(j, i, { ...current, approvalTxHash: txHash, updatedAt: now })
}

/**
 * Store the user's approval of a CCIP bridge step's exact terms. Allowed once,
 * only for an approved step with nothing sent yet; immutable afterwards.
 */
export function authorizeCcipBridge(j: StablecoinJourney, auth: Omit<CcipAuthorization, 'approvedAt'>, now: number): StablecoinJourney {
  const leg = j.legs[1]
  if (j.bridge !== 'ccip-cbada' || j.status !== 'active') fail('Only an active cbADA transfer can be authorized.')
  if (leg.state !== 'approved' || leg.txHash || leg.approvalTxHash) fail('Only an approved step with nothing sent can be authorized.')
  if (j.authorization) fail('This transfer is already authorized; changed terms need a new approval.')
  const a = { ...auth, sender: typeof auth.sender === 'string' ? auth.sender.toLowerCase() : '', approvedAt: now }
  checkAuthorization(a)
  return { ...j, authorization: a }
}

function checkAuthorization(a: unknown): asserts a is CcipAuthorization {
  if (!obj(a)) fail('authorization is malformed')
  const r = a as Record<string, unknown>
  keysExactly(r, ['sender', 'accountIndex', 'maxCcipFeeWei', 'maxApprovalGasWei', 'maxSendGasWei', 'approvedAt'], 'authorization')
  if (typeof r.sender !== 'string' || !/^0x[0-9a-f]{40}$/.test(r.sender)) fail('authorization sender is malformed')
  if (!Number.isSafeInteger(r.accountIndex) || (r.accountIndex as number) < 0) fail('authorization account is malformed')
  for (const k of ['maxCcipFeeWei', 'maxApprovalGasWei', 'maxSendGasWei']) {
    if (typeof r[k] !== 'string' || !/^[1-9][0-9]{0,77}$/.test(r[k] as string)) fail(`authorization ${k} is malformed`)
  }
  if (!Number.isSafeInteger(r.approvedAt)) fail('authorization time is malformed')
}

/**
 * Stop an active journey that has sent nothing: no step has a transaction or an
 * approval transaction. Anything sent is followed by its hash, never cancelled.
 */
export function cancelUnsentJourney(j: StablecoinJourney): StablecoinJourney {
  if (j.status !== 'active') fail('This journey is no longer active.')
  if (j.legs.some(l => l.txHash || l.approvalTxHash)) fail('A step of this journey was sent; it is followed on chain, not cancelled.')
  return { ...j, status: 'stopped' }
}

/** Record the bridge's own reference (e.g. the CCIP message id). Set once, never replaced. */
export function recordLegProviderRef(j: StablecoinJourney, role: JourneyLegRole, ref: string, now: number): StablecoinJourney {
  const i = indexOf(role)
  const current = j.legs[i]
  if (!current.txHash) fail('This step has no transaction yet.')
  if (current.providerRef) {
    if (current.providerRef === ref) return j
    fail('This step already has a different bridge reference; it is never replaced.')
  }
  if (typeof ref !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(ref)) fail('Invalid bridge reference.')
  return replace(j, i, { ...current, providerRef: ref, updatedAt: now })
}

/** Apply chain evidence to a submitted leg. Completion of the last leg completes the journey. */
export function recordLegOutcome(j: StablecoinJourney, role: JourneyLegRole, outcome: LegOutcome, now: number): StablecoinJourney {
  const i = indexOf(role)
  const current = j.legs[i]
  if (!current.txHash || !['submitted', 'uncertain', 'needs-review'].includes(current.state)) fail('This step has no transaction to update.')
  if (outcome.state === 'confirmed') {
    if (!UINT.test(outcome.measuredOutputRaw)) fail('Invalid measured amount.')
    const next = { ...current, state: 'confirmed' as const, measuredOutputRaw: outcome.measuredOutputRaw, updatedAt: now }
    const after = replace(j, i, next)
    const finished = after.legs.every(l => DONE.includes(l.state))
    return finished ? { ...after, status: 'completed' } : after
  }
  // A failed step stops the journey; what has been delivered so far stays where it is.
  return replace(j, i, { ...current, state: outcome.state, updatedAt: now }, outcome.state === 'failed' ? 'stopped' : j.status)
}

/** Where the user's value sits now: the last confirmed output, or the source if nothing ran. */
export function journeyHolding(j: StablecoinJourney): { asset: ExactAsset; amountRaw: string | null; settled: boolean } {
  for (let k = j.legs.length - 1; k >= 0; k--) {
    const l = j.legs[k]
    if (l.state === 'confirmed') return { asset: l.output, amountRaw: l.measuredOutputRaw, settled: true }
    if (l.txHash) return { asset: l.output, amountRaw: null, settled: false }
  }
  return { asset: j.legs[0].input, amountRaw: null, settled: true }
}

/** Active journeys are exempt from generic session expiry. */
export const journeyKeepsAlive = (j: StablecoinJourney): boolean => j.status === 'active'

// ── Closed-schema parsing (anything else is refused, never coerced) ─────────

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keysExactly = (v: Record<string, unknown>, keys: string[], what: string) => {
  const got = Object.keys(v).sort().join()
  if (got !== [...keys].sort().join()) fail(`${what} has unexpected fields`)
}
const nullableUint = (v: unknown, what: string) => { if (v !== null && (typeof v !== 'string' || !UINT.test(v))) fail(`${what} is malformed`) }

function parseAsset(v: unknown, what: string): ExactAsset {
  if (!obj(v)) return fail(`${what} is malformed`)
  keysExactly(v, ['chain', 'address', 'symbol', 'decimals'], what)
  if (!CHAINS.includes(v.chain as string) || typeof v.address !== 'string' || v.address.length > 140
      || typeof v.symbol !== 'string' || v.symbol.length > 32 || !Number.isInteger(v.decimals) || (v.decimals as number) < 0 || (v.decimals as number) > 30) {
    fail(`${what} is malformed`)
  }
  return v as unknown as ExactAsset
}

const LEG_KEYS = ['role', 'state', 'chain', 'input', 'output', 'approvedInputRaw', 'txHash', 'providerRef', 'approvalTxHash', 'measuredOutputRaw', 'updatedAt']
const CHAINS = ['cardano', 'ethereum', 'solana', 'base']
const STATES: JourneyLegState[] = ['skipped', 'planned', 'approved', 'submitted', 'uncertain', 'confirmed', 'failed', 'needs-review']

export function parseJourney(json: string): StablecoinJourney {
  let v: unknown
  try { v = JSON.parse(json) } catch { return fail('Stored journey is unreadable.') }
  if (!obj(v)) return fail('Stored journey is malformed.')
  keysExactly(v, ['version', 'id', 'walletId', 'createdAt', 'bridge', 'recipient', 'legs', 'status', 'authorization'], 'journey')
  if (v.authorization !== null) {
    checkAuthorization(v.authorization)
    if (v.bridge !== 'ccip-cbada') fail('Stored journey is malformed.')
  }
  if (v.version !== 1 || typeof v.id !== 'string' || typeof v.walletId !== 'string' || typeof v.recipient !== 'string'
      || !Number.isSafeInteger(v.createdAt) || !['xreserve-cardano-ethereum', 'xreserve-cardano-solana-forwarded', 'ccip-cbada'].includes(v.bridge as string)
      || !['active', 'completed', 'stopped'].includes(v.status as string) || !Array.isArray(v.legs) || v.legs.length !== 3) {
    fail('Stored journey is malformed.')
  }
  ;(v.legs as unknown[]).forEach((l, i) => {
    if (!obj(l)) fail('journey leg is malformed')
    const lr = l as Record<string, unknown>
    keysExactly(lr, LEG_KEYS, 'journey leg')
    if (lr.role !== ORDER[i] || !STATES.includes(lr.state as JourneyLegState) || !CHAINS.includes(lr.chain as string)
        || !Number.isSafeInteger(lr.updatedAt) || (lr.txHash !== null && (typeof lr.txHash !== 'string' || lr.txHash.length > 100))
        || (lr.providerRef !== null && (typeof lr.providerRef !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(lr.providerRef)))
        || (lr.approvalTxHash !== null && (typeof lr.approvalTxHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(lr.approvalTxHash)))) {
      fail('journey leg is malformed')
    }
    parseAsset(lr.input, 'leg input'); parseAsset(lr.output, 'leg output')
    nullableUint(lr.approvedInputRaw, 'approved amount'); nullableUint(lr.measuredOutputRaw, 'measured amount')
    if (['submitted', 'uncertain', 'confirmed', 'failed', 'needs-review'].includes(lr.state as string) && !lr.txHash) fail('a sent step lost its transaction hash')
  })
  return v as unknown as StablecoinJourney
}
