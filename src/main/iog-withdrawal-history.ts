/**
 * iog-withdrawal-history.ts — read-only tracking of a Cardano USDCx withdrawal
 * through the IOG Portal's history endpoint, held to independent Ethereum
 * evidence (privileged layer).
 *
 * SOURCE AND STANDING. `GET {backend}/withdrawal-history/{cardanoAddress}` is
 * what the IOG Portal (usdcx.iog.io/bridge) calls; its shape was read from the
 * Portal's deployed frontend and one public response (2026-10-05,
 * docs/USDCX-STABLECOIN-ROUTING-PLAN.md). It is an OBSERVED frontend contract,
 * not a published, versioned integration, so parsing is strict and anything
 * unexpected is an error or "unrecognized" — never success.
 *
 * WHAT IT CAN AND CANNOT SAY. A row is the operator's account of a burn. Its
 * `finalized` status and `ethereumTxHash` are claims: completion requires
 * verifyEthereumUsdcCredit to find the exact USDC credit to the approved
 * recipient in that transaction, on the canonical chain, at depth. Rows are
 * selected by the EXACT burn hash — never the latest row or a matching amount.
 * `expired`/`failed` are reported for review, never as a refund. The response
 * carries no Circle withdrawal id.
 *
 * Nothing here builds, signs, submits or records a burn; the Portal's
 * /tx/burn-usdcx, /tx/submit-burn-tx and /tx/record-burn-tx are deliberately
 * not wrapped.
 */

import { decodeCardanoAddress } from './cardano-pure'
import { ProviderFault, type HttpFetchFn } from './xreserve-cardano-provider'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'
import { verifyEthereumUsdcCredit, type WithdrawalCreditResult } from './xreserve-ethereum-withdrawal-credit'
import type { XReserveNetwork } from './xreserve-network'

export const IOG_USDCX_BACKEND = 'https://production-docker.usdcx.aws.iohkdev.io'

/** Response bounds: far above the 9 rows measured for an active public address. */
export const IOG_HISTORY_LIMITS = { maxBytes: 1_000_000, maxRows: 1000, maxErrorChars: 200 } as const

export type IogWithdrawalState =
  | 'awaiting-finality' | 'collecting-signatures' | 'submitting-to-circle' | 'circle-processing'
  | 'finalized' | 'expired' | 'failed'
  /** A status this wallet has not seen. Treated as pending, never as success. */
  | 'unrecognized'

const STATES: Record<string, IogWithdrawalState> = {
  awaiting_finality: 'awaiting-finality',
  collecting_signatures: 'collecting-signatures',
  submitting_to_circle: 'submitting-to-circle',
  circle_processing: 'circle-processing',
  finalized: 'finalized',
  expired: 'expired',
  failed: 'failed',
  FAIL: 'failed',
}

export interface IogWithdrawalRow {
  burnTxHash: string
  /** The operator's named Ethereum release; a claim until independently verified. */
  ethereumTxHash: string | null
  /** USDCx burned, base units (release value + fee cap, measured on the public sample). */
  amountRaw: string
  confirmations: number | null
  createdAt: string
  /** The provider's own status word, kept verbatim for display and review. */
  providerStatus: string
  state: IogWithdrawalState
  lastError: string | null
  /** The Portal discards the Ethereum hash of a failure marked "administratively blocked". */
  administrativelyBlocked: boolean
}

const CARDANO_HASH = /^[0-9a-f]{64}$/
const ETH_HASH = /^0x[0-9a-f]{64}$/
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const bad = (why: string): never => { throw new ProviderFault('malformed', `IOG withdrawal history: ${why}`) }
const ROW_KEYS = new Set(['amount', 'cardanoBurnTxHash', 'confirmations', 'createdAt', 'ethereumTxHash', 'lastError', 'status'])

function parseRow(v: unknown, i: number): IogWithdrawalRow {
  if (!obj(v)) return bad(`row ${i} is not an object`)
  for (const k of Object.keys(v)) if (!ROW_KEYS.has(k)) bad(`row ${i} has an unexpected field`)
  const burn = typeof v.cardanoBurnTxHash === 'string' ? v.cardanoBurnTxHash.toLowerCase() : ''
  if (!CARDANO_HASH.test(burn)) bad(`row ${i} has no valid burn hash`)
  let eth: string | null = null
  if (v.ethereumTxHash != null) {
    eth = typeof v.ethereumTxHash === 'string' ? v.ethereumTxHash.toLowerCase() : ''
    if (!ETH_HASH.test(eth)) bad(`row ${i} has a malformed Ethereum hash`)
  }
  if (typeof v.amount !== 'string' || !DECIMAL.test(v.amount) || v.amount === '0') bad(`row ${i} has a malformed amount`)
  let confirmations: number | null = null
  if (v.confirmations != null) {
    if (typeof v.confirmations !== 'number' || !Number.isSafeInteger(v.confirmations) || v.confirmations < 0) bad(`row ${i} has malformed confirmations`)
    confirmations = v.confirmations as number
  }
  if (typeof v.createdAt !== 'string' || !ISO.test(v.createdAt)) bad(`row ${i} has a malformed timestamp`)
  if (typeof v.status !== 'string' || v.status.length === 0 || v.status.length > 64) bad(`row ${i} has a malformed status`)
  let lastError: string | null = null
  if (v.lastError != null) {
    if (typeof v.lastError !== 'string') bad(`row ${i} has a malformed error`)
    lastError = (v.lastError as string).slice(0, IOG_HISTORY_LIMITS.maxErrorChars)
  }
  const state = STATES[v.status as string] ?? 'unrecognized'
  const administrativelyBlocked = state === 'failed' && !!lastError?.startsWith('administratively blocked')
  return {
    burnTxHash: burn, ethereumTxHash: administrativelyBlocked ? null : eth, amountRaw: v.amount as string,
    confirmations, createdAt: v.createdAt as string, providerStatus: v.status as string, state, lastError,
    administrativelyBlocked,
  }
}

/** Parse a whole history response. One malformed row rejects the response. */
export function parseIogWithdrawalHistory(body: unknown): IogWithdrawalRow[] {
  if (!Array.isArray(body)) return bad('response is not a list')
  if (body.length > IOG_HISTORY_LIMITS.maxRows) bad('response has too many rows')
  return body.map(parseRow)
}

export type IogRowSelection =
  | { kind: 'found'; row: IogWithdrawalRow }
  | { kind: 'absent' }
  /** More than one row claims this burn: the provider's account is ambiguous. */
  | { kind: 'duplicate'; rows: IogWithdrawalRow[] }

/** Select by the EXACT burn hash. Never the latest row, never by amount. */
export function selectIogWithdrawal(rows: IogWithdrawalRow[], burnTxHash: string): IogRowSelection {
  const want = typeof burnTxHash === 'string' ? burnTxHash.replace(/^0x/i, '').toLowerCase() : ''
  if (!CARDANO_HASH.test(want)) return bad('invalid burn hash requested')
  const hits = rows.filter(r => r.burnTxHash === want)
  if (hits.length === 0) return { kind: 'absent' }
  if (hits.length > 1) return { kind: 'duplicate', rows: hits }
  return { kind: 'found', row: hits[0] }
}

export async function fetchIogWithdrawalHistory(
  cardanoAddress: string, opts: { fetchFn?: HttpFetchFn; backend?: string } = {},
): Promise<IogWithdrawalRow[]> {
  let bytes: Uint8Array
  try { bytes = decodeCardanoAddress(cardanoAddress) } catch { return bad('invalid Cardano address') }
  // Mainnet only: the IOG backend serves mainnet USDCx.
  if ((bytes[0] & 0x0f) !== 1) bad('not a mainnet Cardano address')
  let response: Response
  try {
    response = await (opts.fetchFn ?? fetch)(
      `${opts.backend ?? IOG_USDCX_BACKEND}/withdrawal-history/${encodeURIComponent(cardanoAddress)}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' },
    )
  } catch { throw new ProviderFault('unavailable', 'IOG withdrawal history: request failed or timed out') }
  if (response.status !== 200) {
    throw new ProviderFault(response.status === 429 ? 'rate-limited' : 'unavailable', `IOG withdrawal history: HTTP ${response.status}`)
  }
  const text = await response.text().catch(() => bad('response could not be read'))
  if (text.length > IOG_HISTORY_LIMITS.maxBytes) bad('response is too large')
  let body: unknown
  try { body = JSON.parse(text) } catch { return bad('response is not JSON') }
  return parseIogWithdrawalHistory(body)
}

// ── Provider state + independent credit ──────────────────────────────────────

export type IogWithdrawalTracking =
  /** The provider has no row for this burn (yet). Not a failure by itself. */
  | { kind: 'not-listed' }
  | { kind: 'ambiguous'; rows: IogWithdrawalRow[] }
  /** The provider says it is still in progress (including unrecognized statuses). */
  | { kind: 'pending'; row: IogWithdrawalRow }
  /** Provider failure/expiry: for review. Never a refund claim. */
  | { kind: 'provider-stopped'; row: IogWithdrawalRow }
  /** The row disagrees with the approved burn (amount), or names no release. */
  | { kind: 'needs-review'; row: IogWithdrawalRow; reason: string }
  /** Provider says finalized; the ledger check says how far that holds. */
  | { kind: 'finalized'; row: IogWithdrawalRow; credit: WithdrawalCreditResult }

export interface IogWithdrawalExpectation {
  burnTxHash: string
  /** The approved Ethereum recipient and exact USDC release value (base units). */
  recipient: string
  releaseAmountRaw: string
  /** USDCx the approved burn consumed (value + fee cap); checked against the row when given. */
  burnAmountRaw?: string
}

/**
 * Combine the provider's row with independent Ethereum evidence. `readEvidence`
 * is called only for a finalized row that names a release, and only for that
 * exact hash (use readXReserveEthereumEvidence: one trusted endpoint per snapshot).
 */
export async function trackIogWithdrawal(
  rows: IogWithdrawalRow[],
  expect: IogWithdrawalExpectation,
  readEvidence: (txHash: string) => Promise<EthereumDepositEvidence>,
  opts: { minConfirmations: number; network?: XReserveNetwork },
): Promise<IogWithdrawalTracking> {
  const selected = selectIogWithdrawal(rows, expect.burnTxHash)
  if (selected.kind === 'absent') return { kind: 'not-listed' }
  if (selected.kind === 'duplicate') return { kind: 'ambiguous', rows: selected.rows }
  const row = selected.row
  if (expect.burnAmountRaw !== undefined && row.amountRaw !== expect.burnAmountRaw) {
    return { kind: 'needs-review', row, reason: 'the provider records a different burn amount than the approved one' }
  }
  if (row.state === 'failed' || row.state === 'expired') return { kind: 'provider-stopped', row }
  if (row.state !== 'finalized') return { kind: 'pending', row }
  if (!row.ethereumTxHash) return { kind: 'needs-review', row, reason: 'finalized without a named Ethereum release' }
  const evidence = await readEvidence(row.ethereumTxHash)
  const credit = verifyEthereumUsdcCredit({
    transactionHash: row.ethereumTxHash, recipient: expect.recipient, amountRaw: expect.releaseAmountRaw,
    evidence, minConfirmations: opts.minConfirmations, network: opts.network,
  })
  return { kind: 'finalized', row, credit }
}
