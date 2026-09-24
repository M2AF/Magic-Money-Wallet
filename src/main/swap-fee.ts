/**
 * swap-fee.ts — the wallet's OWN check that a quote actually collects the
 * Magic Money fee, run where the keys are.
 *
 * WHY THE WALLET RE-CHECKS EVERYTHING
 *
 * The Worker sorts routes into tiers before ranking, but the wallet cannot take
 * its word for that. The quote arrives over the same untrusted transport as
 * every other field, the Worker is a separate deployable that can be older than
 * the client, and the direct LI.FI path never touches the Worker at all. So the
 * record the Worker attached is treated as a CLAIM, and this module re-derives
 * the classification from the policy the wallet itself ships.
 *
 * WHAT IS A GATE AND WHAT IS NOT
 *
 * Under the two-tier policy, failing to verify a fee is NOT a reason to refuse a
 * swap. It moves the quote into tier 2 and changes what the UI says. The only
 * fee condition that still blocks signing is an integrity one — a fee pointed at
 * an address that is not ours, or terms from a policy version the user never
 * saw. `classifyQuoteFee` answers the routing question;
 * `checkQuoteFeeIntegrity` answers the signing one, and they are deliberately
 * separate functions so a future edit cannot merge them by accident.
 *
 * WHAT COUNTS AS PROOF HERE
 *
 * Three independent things, in increasing strength:
 *
 *   1. arithmetic  the reported fee amount reconciles to the policy rate on the
 *                  base the provider says it used, in exact integer maths
 *   2. identity    the recipient is a beneficiary from the checked-in policy
 *                  table, compared with the right case sensitivity per chain
 *   3. binding     the recipient is present in the bytes that will actually be
 *                  signed -- an EVM calldata blob, or a Solana transaction's
 *                  account keys
 *
 * None of the three proves the money ARRIVED. That is a settlement question and
 * only a reconciled swap session can answer it (see swap-session.ts). Nothing in
 * this module should ever be described as payout verification.
 */

import { PublicKey } from '@solana/web3.js'
import { SWAP_FEE_BENEFICIARIES } from '../shared/swap-fee-policy'
import type { WalletConfig } from './secure-store'
import { heliusRpcUrl } from './api-proxy'

// The quote-level fee checks live in src/shared/swap-fee-checks.ts so ChainLens
// runs the same code; re-exported here for every existing caller.
export {
  feeBaseAmountRaw, checkQuoteAppFee, quoteFeeStatus, checkFeeBoundInPayload,
  classifyQuoteFee, checkQuoteFeeIntegrity, expectedAppFeeAmountRaw, feeTermsFingerprint,
  feeCapableProviders,
} from '../shared/swap-fee-checks'

/** Jupiter's referral program — referral token accounts are PDAs owned by it. */
const JUP_REFERRAL_PROGRAM = new PublicKey('REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3')
/** SPL Token programs a referral fee account may legitimately belong to. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

// ── Solana fee accounts ──────────────────────────────────────────────────────

/**
 * The referral token account (PDA) that collects our Jupiter fee for one mint.
 *
 * The PDA is deterministic, which is exactly why deriving it proves nothing:
 * every mint has one whether or not it has ever been created. Jupiter accepts an
 * uninitialised account without complaint (measured 2026-09-19 — it simply
 * embeds the pubkey), so the swap would build, and then either fail on-chain or
 * pay nobody. `resolveJupiterFeeAccount` is the derivation PLUS the existence
 * check; nothing should use this alone.
 */
export function deriveJupiterFeeAccount(referralAccount: string, mint: string): string | null {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode('referral_ata'),
        new PublicKey(referralAccount).toBytes(),
        new PublicKey(mint).toBytes(),
      ],
      JUP_REFERRAL_PROGRAM,
    )
    return pda.toBase58()
  } catch {
    return null
  }
}

export interface JupiterFeeAccountResult {
  /** Usable fee account, or null when none exists for this mint. */
  feeAccount: string | null
  /** Why not, in words a user can act on. */
  reason: string | null
}

/** Minimal `getAccountInfo` shape we rely on. */
interface ParsedAccount {
  owner?: string
  data?: { parsed?: { type?: string; info?: { mint?: string; state?: string } } }
}

type SolanaFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Derive AND validate the Jupiter fee account for an output mint.
 *
 * The account must exist, be owned by a token program, be a token account, and
 * hold the mint the fee will be paid in. A mint whose treasury account has never
 * been created makes the route unavailable under the fee policy — deliberately.
 * The alternative (create one on demand) spends lamports from somewhere, and
 * quietly charging a user rent to open our own treasury account is not something
 * to do inside a swap. Creation belongs in an explicit, funded, authorized setup
 * step; until then the error names the token so the gap is actionable.
 */
export async function resolveJupiterFeeAccount(
  outputMint: string,
  config: WalletConfig,
  fetchImpl?: SolanaFetch,
): Promise<JupiterFeeAccountResult> {
  const derived = deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, outputMint)
  if (!derived) return { feeAccount: null, reason: 'Could not derive a fee account for this token.' }

  const doFetch: SolanaFetch = fetchImpl ?? ((url, init) => fetch(url, init))
  let account: ParsedAccount | null = null
  try {
    const res = await doFetch(heliusRpcUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'mm-fee-account', method: 'getAccountInfo',
        params: [derived, { encoding: 'jsonParsed' }],
      }),
      signal: AbortSignal.timeout(8_000),
    })
    const body = await res.json().catch(() => null) as { result?: { value?: ParsedAccount | null } } | null
    account = body?.result?.value ?? null
  } catch {
    // An RPC we could not reach is NOT evidence the account is missing. Failing
    // closed here is still correct — we will not promise a fee we cannot confirm
    // — but the message must not claim the account does not exist.
    return {
      feeAccount: null,
      reason: 'Could not confirm the Magic Money fee account for this token (Solana RPC unavailable).',
    }
  }

  if (!account) {
    return {
      feeAccount: null,
      reason: 'Magic Money has no fee account for this token yet, so this route cannot collect the disclosed fee.',
    }
  }
  const owner = account.owner ?? ''
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) {
    return { feeAccount: null, reason: 'The fee account for this token is not a token account.' }
  }
  if (account.data?.parsed?.type !== 'account') {
    return { feeAccount: null, reason: 'The fee account for this token is not an initialized token account.' }
  }
  const mint = account.data?.parsed?.info?.mint ?? ''
  if (mint !== outputMint) {
    // Base58 is case-sensitive and a PDA collision is not a thing to shrug at.
    return { feeAccount: null, reason: 'The fee account for this token holds a different mint.' }
  }
  return { feeAccount: derived, reason: null }
}

