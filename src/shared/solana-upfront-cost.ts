/**
 * solana-upfront-cost.ts — the SOL a Solana swap needs before it can be signed,
 * and the ONE rule for deciding whether a balance covers it.
 *
 * The record is produced in the privileged layer (src/main/solana-swap-cost.ts,
 * which reads the quoted transaction, current rent and account existence). The
 * rules below are shared so the quote screen (button, Max, displayed cost) and
 * the pre-signing check apply literally the same arithmetic and wording.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

export interface SolanaNewAccount {
  address: string
  kind: 'token-account' | 'system-account'
  mint: string | null
  tokenProgram: string | null
  size: number
  rentLamports: string
  /** Closed back to the payer later in the same transaction (e.g. temporary wrapped SOL). */
  refundedInTx: boolean
}

/** Serializable (strings, not bigints) — it crosses IPC and extension messaging. */
export interface SolanaUpfrontCost {
  baseFeeLamports: string
  priorityFeeLamports: string
  newAccounts: SolanaNewAccount[]
  rentLamports: string
  /** SOL sent elsewhere by the payer inside the transaction (not the sale itself). */
  otherTransferLamports: string
  /** SOL being sold, wrapped inside the transaction. Part of the sale, not a cost. */
  saleLamports: string
  /** What the payer must hold before signing: fees + rent + transfers + sale. */
  requiredLamports: string
  /** Required minus the sale: what the swap costs in SOL on top of what is sold. */
  costLamports: string
  balanceLamports: string | null
  /** False when a program the payer is handed to may take more — figures are then a lower bound. */
  complete: boolean
  incompleteReason: string | null
  /**
   * SOL the transaction actually took from the payer in a SUCCESSFUL simulation
   * (balance before minus after, fees included). Only measured when the swap
   * pays nothing back in SOL — otherwise the proceeds net against the cost and
   * the difference means nothing. Measured 2026-09-23: a LI.FI/Mayan route read
   * 63,029 lamports statically but consumed 2,252,509 in simulation, because
   * the bridge program funds accounts internally.
   */
  measuredLamports: string | null
  /** Why a simulation did not measure, when it was attempted and failed. */
  simulationError: string | null
}


/**
 * The SOL the payer must hold, as best known: the simulated consumption when it
 * was measured (it sees everything, including opaque programs), otherwise the
 * static requirement — which is exact when `complete`, a lower bound when not.
 */
export function solanaRequiredLamports(cost: SolanaUpfrontCost): { lamports: bigint; exact: boolean } {
  const staticReq = BigInt(cost.requiredLamports)
  if (cost.measuredLamports != null) {
    const m = BigInt(cost.measuredLamports)
    return { lamports: m > staticReq ? m : staticReq, exact: true }
  }
  return { lamports: staticReq, exact: cost.complete }
}

/** How far the balance falls short of the (best-known) requirement, or null when it does not. */
export function solanaCostShortfall(cost: SolanaUpfrontCost): bigint | null {
  if (cost.balanceLamports == null) return null
  const gap = solanaRequiredLamports(cost).lamports - BigInt(cost.balanceLamports)
  return gap > 0n ? gap : null
}

/**
 * The user-facing reason a swap cannot be signed for lack of SOL, or null. The
 * SAME text is used by the quote screen and the pre-signing check.
 */
export function solanaShortfallMessage(cost: SolanaUpfrontCost): string | null {
  const gap = solanaCostShortfall(cost)
  if (gap == null) return null
  const req = solanaRequiredLamports(cost)
  const sol = (l: bigint) => (Number(l) / 1e9).toFixed(6)
  const newAcc = cost.newAccounts.filter(a => !a.refundedInTx).length
  const temp = cost.newAccounts.filter(a => a.refundedInTx).length
  const parts = [
    newAcc ? `${newAcc} new token account${newAcc > 1 ? 's' : ''}` : '',
    temp ? `${temp} temporary account${temp > 1 ? 's' : ''} (rent returned when the swap finishes)` : '',
  ].filter(Boolean).join(' and ')
  return `This swap needs ${req.exact ? '' : 'at least '}${sol(req.lamports)} SOL up front`
    + `${parts ? ` for network fees and ${parts}` : ' for network fees'}`
    + `, and this account holds ${sol(BigInt(cost.balanceLamports ?? '0'))} SOL. Add at least ${sol(gap)} SOL, then refresh the quote.`
}


/**
 * The most native SOL that can be SOLD while leaving enough for everything else
 * the swap needs: balance minus the non-sale cost. Null when there is no cost
 * record to base it on. Never negative.
 */
export function maxSolSaleLamports(cost: SolanaUpfrontCost, balanceLamports: bigint): bigint {
  const req = solanaRequiredLamports(cost).lamports
  const sale = BigInt(cost.saleLamports)
  const nonSale = req > sale ? req - sale : 0n
  return balanceLamports > nonSale ? balanceLamports - nonSale : 0n
}
