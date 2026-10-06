/**
 * usdcx-burn-tracking.ts — follow ONE saved Cardano USDCx burn of a journey to
 * its destination credit, read-only (privileged layer).
 *
 *   1. the Cardano transaction at the saved hash is this journey's burn
 *      (verifyXReserveCardanoBurn against the journey's stored, approved terms),
 *      and how deep it is;
 *   2. the IOG Portal history row for EXACTLY that burn hash (trackIogWithdrawal);
 *   3. the Ethereum release that row names, held to the exact USDC credit to the
 *      approved recipient at depth (verifyEthereumUsdcCredit).
 *
 * Nothing here builds, signs, submits or repeats a burn. The only result is a
 * leg outcome for the caller to record:
 *   - confirmed, with the MEASURED credit, only when the burn is verified AND
 *     the release credit is verified at depth;
 *   - failed, only when the saved transaction carries the intent but failed
 *     script validation (a phase-2 failure burns nothing);
 *   - needs-review for any conflict: the saved hash is not this burn, the
 *     provider stopped or disagrees, or the release credits something else.
 * Absence, a pending provider and unreadable sources change nothing: a missing
 * row or credit is never a failure or a refund.
 *
 * Mainnet Ethereum only. A Solana-forwarded withdrawal is tracked through the
 * burn and the provider row; its Solana credit check does not exist yet, so it
 * is never confirmed here.
 */

import type { StablecoinJourney } from '../shared/stablecoin-journey'
import { verifyXReserveCardanoBurn } from './xreserve-cardano-burn-proof'
import { trackIogWithdrawal, fetchIogWithdrawalHistory, type IogWithdrawalRow, type IogWithdrawalTracking } from './iog-withdrawal-history'
import type { HttpFetchFn } from './xreserve-cardano-provider'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'
import type { WithdrawalCreditState } from './xreserve-ethereum-withdrawal-credit'

/**
 * Depths this wallet requires. Cardano: IOG's operators sign after ~400 blocks
 * (docs/XRESERVE-BURN-INTERFACE-RESEARCH.md). Ethereum: 64 blocks, about two
 * finalized epochs.
 */
export const USDCX_BURN_DEPTH = Object.freeze({ cardanoBlocks: 400, ethereumBlocks: 64 })

export interface UsdcxBurnReads {
  /** The saved Cardano transaction: CBOR and depth, or not on chain / unreadable. */
  cardanoBurn(txHash: string): Promise<{ cbor: string; depth: number | null } | 'not-found' | 'unreadable'>
  iogHistory(cardanoAddress: string): Promise<IogWithdrawalRow[] | 'unreadable'>
  /** One-endpoint Ethereum snapshot for a release hash. */
  ethereumEvidence(txHash: string): Promise<EthereumDepositEvidence | 'unreadable'>
}

export interface BurnLegEvidence {
  burn: 'verified' | 'not-found' | 'unreadable' | 'failed-attempt' | 'conflict' | 'unrelated'
  burnDepth: number | null
  /** At least USDCX_BURN_DEPTH.cardanoBlocks deep. */
  burnFinal: boolean
  provider: IogWithdrawalTracking['kind'] | 'unreadable' | 'not-checked'
  providerStatus: string | null
  releaseTxHash: string | null
  credit: WithdrawalCreditState | null
  creditedRaw: string | null
  reason: string | null
}

export type BurnLegOutcome =
  | { state: 'confirmed'; measuredOutputRaw: string }
  | { state: 'failed' | 'needs-review' }
  | null

export async function checkUsdcxBurnLeg(
  journey: StablecoinJourney, cardanoAddress: string | null, reads: UsdcxBurnReads,
): Promise<{ evidence: BurnLegEvidence; outcome: BurnLegOutcome }> {
  const ev: BurnLegEvidence = {
    burn: 'unreadable', burnDepth: null, burnFinal: false, provider: 'not-checked', providerStatus: null,
    releaseTxHash: null, credit: null, creditedRaw: null, reason: null,
  }
  const done = (outcome: BurnLegOutcome, reason: string | null = ev.reason) => ({ evidence: { ...ev, reason }, outcome })
  const leg = journey.legs[1]
  const terms = journey.burnTerms
  if (!leg.txHash) return done(null, 'No burn was sent for this journey.')
  if (!terms) return done(null, 'The approved burn terms are missing, so the burn cannot be checked.')

  // ── 1. The burn itself ────────────────────────────────────────────────────
  const tx = await reads.cardanoBurn(leg.txHash).catch(() => 'unreadable' as const)
  if (tx === 'unreadable') return done(null, 'Cardano could not be read; try again.')
  if (tx === 'not-found') {
    ev.burn = 'not-found'
    return done(null, 'The burn is not on Cardano (yet). It is checked again by its saved hash, never sent again.')
  }
  ev.burnDepth = tx.depth
  ev.burnFinal = tx.depth !== null && tx.depth >= USDCX_BURN_DEPTH.cardanoBlocks
  const proof = verifyXReserveCardanoBurn({ terms, cardanoTx: { txHash: leg.txHash, cbor: tx.cbor } })
  if (!proof.verified) {
    if (proof.code === 'failed-attempt') {
      ev.burn = 'failed-attempt'
      if (!ev.burnFinal) return done(null, 'The burn transaction failed script validation, but is not final on Cardano yet.')
      return done({ state: 'failed' }, 'The burn transaction failed script validation, so no USDCx was burned.')
    }
    if (proof.code === 'burn-conflict' || proof.code === 'unrelated') {
      ev.burn = proof.code === 'unrelated' ? 'unrelated' : 'conflict'
      return done({ state: 'needs-review' }, `Needs review: ${proof.reason}.`)
    }
    return done(null, `The burn could not be checked: ${proof.reason}.`)
  }
  ev.burn = 'verified'
  if (proof.valueRaw !== terms.releaseAmountRaw) {
    return done({ state: 'needs-review' }, 'Needs review: the BurnIntent release value differs from the approved release amount.')
  }

  // ── 2. The operator's account of it ───────────────────────────────────────
  if (!cardanoAddress) return done(null, 'This account has no Cardano address to read the withdrawal history for.')
  const rows = await reads.iogHistory(cardanoAddress).catch(() => 'unreadable' as const)
  if (rows === 'unreadable') { ev.provider = 'unreadable'; return done(null, 'The IOG withdrawal history could not be read; try again.') }
  const ethereum = journey.bridge === 'xreserve-cardano-ethereum'
  let track: IogWithdrawalTracking
  try {
    track = await trackIogWithdrawal(rows, {
      burnTxHash: leg.txHash, recipient: terms.releaseRecipient, releaseAmountRaw: terms.releaseAmountRaw, burnAmountRaw: terms.burnAmountRaw,
    }, async (hash) => {
      const e = await reads.ethereumEvidence(hash)
      if (e === 'unreadable' || !ethereum) throw new Error('unreadable')
      return e
    }, { minConfirmations: USDCX_BURN_DEPTH.ethereumBlocks })
  } catch {
    // Only the release read throws here: the row was finalized.
    const row = rows.find(r => r.burnTxHash === leg.txHash!.replace(/^0x/i, '').toLowerCase())
    ev.provider = 'finalized'
    ev.providerStatus = row?.providerStatus ?? null
    ev.releaseTxHash = row?.ethereumTxHash ?? null
    return done(null, ethereum ? 'The release on Ethereum could not be read; try again.'
      : 'The provider reports this withdrawal finalized. Checking the Solana credit is not supported yet.')
  }
  ev.provider = track.kind
  if ('row' in track) { ev.providerStatus = track.row.providerStatus; ev.releaseTxHash = track.row.ethereumTxHash }
  switch (track.kind) {
    case 'not-listed': return done(null, 'The provider does not list this burn yet.')
    case 'pending': return done(null, ev.burnFinal ? 'The provider is still processing the withdrawal.'
      : `The burn is ${ev.burnDepth ?? '?'} blocks deep; the provider acts after about ${USDCX_BURN_DEPTH.cardanoBlocks}.`)
    case 'ambiguous': return done({ state: 'needs-review' }, 'Needs review: the provider lists this burn more than once.')
    case 'provider-stopped': return done({ state: 'needs-review' }, 'Needs review: the provider reports this withdrawal failed or expired after the burn. This is not a refund.')
    case 'needs-review': return done({ state: 'needs-review' }, `Needs review: ${track.reason}.`)
    case 'finalized': {
      // ── 3. The release, held to the exact credit ─────────────────────────
      ev.credit = track.credit.state
      ev.creditedRaw = track.credit.netCreditRaw
      if (track.credit.state === 'verified' && track.credit.netCreditRaw) {
        if (!ev.burnFinal) return done(null, `The release is verified, but the Cardano burn is only ${ev.burnDepth ?? '?'} blocks deep; waiting for ${USDCX_BURN_DEPTH.cardanoBlocks}.`)
        return done({ state: 'confirmed', measuredOutputRaw: track.credit.netCreditRaw }, null)
      }
      if (track.credit.state === 'failed' || track.credit.state === 'needs-review' || track.credit.state === 'invalid-input') {
        return done({ state: 'needs-review' }, `Needs review: the named release does not credit the approved amount (${track.credit.code}).`)
      }
      return done(null, `The release is not yet final on Ethereum (${track.credit.code}).`)
    }
  }
}

/**
 * Live reads: Blockfrost for the burn and its depth, the IOG history endpoint,
 * and the wallet's one-endpoint-per-snapshot Ethereum evidence reader.
 */
export function liveUsdcxBurnReads(
  cardano: (path: string) => Promise<Response>,
  ethereumEvidence: (txHash: string) => Promise<EthereumDepositEvidence>,
  fetchFn?: HttpFetchFn,
): UsdcxBurnReads {
  return {
    async cardanoBurn(txHash) {
      try {
        const info = await cardano(`txs/${txHash}`)
        if (info.status === 404) return 'not-found'
        if (!info.ok) return 'unreadable'
        const { block_height } = await info.json() as { block_height?: number }
        const [cborRes, tipRes] = await Promise.all([cardano(`txs/${txHash}/cbor`), cardano('blocks/latest')])
        if (!cborRes.ok) return 'unreadable'
        const { cbor } = await cborRes.json() as { cbor?: string }
        if (typeof cbor !== 'string') return 'unreadable'
        const tip = tipRes.ok ? (await tipRes.json() as { height?: number }).height : undefined
        const depth = Number.isSafeInteger(block_height) && Number.isSafeInteger(tip) ? (tip as number) - (block_height as number) + 1 : null
        return { cbor, depth }
      } catch { return 'unreadable' }
    },
    async iogHistory(address) {
      try { return await fetchIogWithdrawalHistory(address, { fetchFn }) } catch { return 'unreadable' }
    },
    async ethereumEvidence(txHash) {
      try { return await ethereumEvidence(txHash) } catch { return 'unreadable' }
    },
  }
}
