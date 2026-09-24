/**
 * swap-fee-policy.ts — what Magic Money charges for a DEX/aggregated swap, who
 * receives it, what counts as proof it was applied, and — since the policy
 * change — what happens when no route can pay it.
 *
 * WHY ONE MODULE
 *
 * The rate used to live in two places that could disagree: the Worker's
 * `FEE_BPS` env default and a hardcoded constant in the privileged client's
 * direct LI.FI path. A Worker-only change could not fix a client constant, and
 * the client had no way to check what the Worker had done. So the rate, the
 * beneficiaries and the verification rules live here, and BOTH quote paths are
 * measured against them. `cloudflare-worker/swap-fee.js` mirrors the constants
 * for the Worker (which has no TypeScript build), exactly as `tokens.js` mirrors
 * `swap-token-identity.ts`; `swap-fee-policy.test.ts` asserts the two agree.
 *
 * TWO ROUTING TIERS — THE FEE IS PREFERRED, NOT MANDATORY
 *
 * An earlier version of this policy refused any route that could not prove it
 * had applied the app fee. That protected revenue by removing working swaps,
 * which is the wrong trade: a user who cannot swap at all is worse off than a
 * user who swaps and we earn nothing on.
 *
 *   TIER 1  fee-paying — the provider's own response states an applied fee that
 *           reconciles to the policy rate and names one of our beneficiaries
 *   TIER 2  fee-free — no app fee is charged AT ALL, and we say so
 *
 * Routing prefers tier 1 and ranks within it by real net output. Only when tier
 * 1 is empty does tier 2 run, ranked the same way. Because the tiers are chosen
 * before price is compared, the winner is the best route THAT PAYS US, which is
 * not necessarily the best route available — nothing in this codebase may
 * describe it as the cheapest.
 *
 * THREE FEE STATES, NEVER COLLAPSED INTO TWO
 *
 *   verified        the provider stated an applied fee and it reconciles
 *   confirmed-none  we explicitly asked for no fee and none was applied
 *   unknown         we asked for a fee and cannot tell what happened
 *
 * `unknown` is not zero and is not revenue. A tier-2 fallback deliberately asks
 * for NO fee rather than asking for one it cannot account for, so the common
 * fallback case is `confirmed-none` — a fact we can state — instead of a 1%
 * charge nobody can explain.
 *
 * Provider, bridge and network costs are independent of all of this: a route
 * with no Magic Money fee is not a free route, and the UI says so.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

/**
 * Bump whenever the rate, the beneficiaries or the verification rules change.
 *
 * It is bound into every issued intent: a quote priced under an older policy
 * cannot be executed after the policy moves, because the terms the user
 * approved are no longer the terms in force.
 */
export const SWAP_FEE_POLICY_VERSION = '2026-09-19.app-100bps-preferred'

/**
 * The Magic Money app fee, in basis points, charged to the user and disclosed
 * in the quote card WHEN a route can carry it.
 *
 * 100 bps = 1%. This REPLACES the previous 90 bps; it is not added to it.
 * Provider revenue shares (where a provider keeps part of this) reduce what the
 * app receives and are reported separately — this number is never inflated to
 * compensate for one.
 */
export const APP_FEE_BPS = 100

/**
 * Upper bound on any configured rate.
 *
 * The Worker reads its rate from an env var. A typo there (or a compromised
 * config) must not be able to charge a user an arbitrary amount, so both sides
 * refuse rather than clamp-and-proceed.
 */
export const MAX_APP_FEE_BPS = 150

/** Which side of the trade a provider takes its cut from. */
export type SwapFeeBase = 'input' | 'output'

/** How the money reaches us. */
export type SwapFeeCollection =
  /** Transferred inside the swap transaction itself. */
  | 'in-swap'
  /** Accrues to an off-chain balance we later claim (Relay-style). */
  | 'accrued-claimable'

export type SwapFeeRecipientKind =
  /** A plain on-chain address in the payload (0x, 1inch, Uniswap, Rango). */
  | 'onchain-address'
  /** A name registered with the provider, whose payout wallets live in their portal (LI.FI, SwapKit). */
  | 'registered-integrator'
  /** A Solana token account that must exist and match the fee mint (Jupiter). */
  | 'referral-token-account'
  /**
   * The recipient lives in the PROVIDER's off-chain intent, not in the bytes the
   * user signs (Relay).
   *
   * MEASURED 2026-09-20: Relay's deposit calldata for EMO -> PIXL is 8330
   * characters and contains our fee address nowhere; the `appFees` recipient is
   * held against the `requestId` instead. That is a genuinely weaker guarantee
   * than an address in the payload, and it is a separate KIND rather than an
   * exemption so the difference stays visible: it can only be confirmed after
   * settlement, from `data.paidAppFees[]`, which names who was actually paid.
   */
  | 'provider-intent'
  /** No fee is being collected, so there is no recipient. */
  | 'none'

/**
 * How well the provider's own response supports the claim that our fee was
 * applied. Ordered weakest to strongest.
 */
export type SwapFeeVerification =
  /** We explicitly requested NO fee, and the response is consistent with that. */
  | 'none-requested'
  /** We asked for a fee and the response says nothing about it. NOT evidence. */
  | 'requested-unverified'
  /** Our beneficiary is in the payload that will execute, but the amount is not stated. */
  | 'payload-bound'
  /** The response states the applied amount and it agrees with the policy rate. */
  | 'applied-verified'

/**
 * What we can honestly tell the user, and what accounting may count.
 *
 * Derived from the verification level plus what was requested — never asserted
 * by an adapter directly, so a provider cannot talk its way into `verified`.
 */
export type SwapFeeStatus = 'verified' | 'confirmed-none' | 'unknown'

/** Which routing tier a quote belongs to. */
export type SwapFeeTier = 'fee-paying' | 'fee-free'

/**
 * Public beneficiary configuration.
 *
 * These are PUBLIC identifiers — on-chain addresses and a provider-portal
 * integrator name. They are checked into the client on purpose: the privileged
 * wallet must be able to tell whether the Worker (or anything else in the quote
 * path) redirected our fee somewhere else, and it cannot do that against a value
 * only the Worker knows. The Worker mirrors the same table and refuses to serve
 * a quote whose env disagrees with it.
 *
 * No key material, and nothing derived from any.
 */
export interface SwapFeeBeneficiaries {
  /** All EVM chains — 0x / 1inch / Uniswap / Rango recipient. */
  evm: string
  /** LI.FI integrator name; the payout wallets are configured at portal.li.fi. */
  lifiIntegrator: string
  /** Jupiter referral ACCOUNT (not a token account) — fee accounts are PDAs of it. */
  solanaReferralAccount: string
  /** Plain Solana wallet, for providers that take an address rather than a token account. */
  solanaWallet: string
  cardano: string
  bitcoin: string
  polkadot: string
}

export const SWAP_FEE_BENEFICIARIES: SwapFeeBeneficiaries = {
  evm: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
  lifiIntegrator: 'ChainLens',
  solanaReferralAccount: '9vBwkLqEcNs6LKv8Szyrt4P9h82SBWaD3hbiDZ1A3hUy',
  solanaWallet: '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d',
  cardano: 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h',
  bitcoin: 'bc1qt6cx7977r8xttn5rg42d2ulnlc7agspycd600w',
  polkadot: '1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS',
}

/** The beneficiary a plain-address provider must pay on a given source chain. */
export function feeRecipientForChain(chain: string): string {
  switch ((chain || '').toLowerCase()) {
    case 'solana': return SWAP_FEE_BENEFICIARIES.solanaWallet
    case 'cardano': return SWAP_FEE_BENEFICIARIES.cardano
    case 'bitcoin': return SWAP_FEE_BENEFICIARIES.bitcoin
    case 'polkadot': return SWAP_FEE_BENEFICIARIES.polkadot
    default: return SWAP_FEE_BENEFICIARIES.evm
  }
}

/**
 * What each provider can do about fees, and what its response gives us to check.
 *
 * `maxVerification` is the CEILING an adapter can honestly reach from that
 * provider's response. Under the two-tier policy this decides which TIER a
 * provider can reach — it no longer decides whether the provider may serve
 * routes at all. A provider below `applied-verified` is a perfectly good tier-2
 * route; it simply carries no app fee, and we ask it for none.
 */
export interface SwapFeeProviderCapability {
  /** Which side the provider's fee comes from, when we get to choose. */
  bases: SwapFeeBase[]
  collection: SwapFeeCollection
  recipientKind: SwapFeeRecipientKind
  maxVerification: SwapFeeVerification
  /**
   * Does the provider's quoted output already have our fee taken out?
   *
   * Getting this wrong in either direction is a real error: assuming "yes" when
   * it is "no" overstates what the user receives, and subtracting a fee that was
   * already deducted understates it. Measured where possible, documented where
   * not.
   */
  quotedOutputIsNetOfAppFee: boolean
  /** Share the provider keeps of our fee, when their terms state one. null = unknown. */
  providerSharePct: number | null
  /** One line on where the above comes from, so a stale assumption is visible. */
  evidence: string
}

export const SWAP_FEE_PROVIDERS: Record<string, SwapFeeProviderCapability> = {
  // MEASURED 2026-09-20, keyless api.relay.link/quote: `appFees: [{recipient,
  // fee: '100'}]` returns `fees.app.amount` = $0.772951 on a $77.60 input — ~100
  // bps, taken on the INPUT and denominated in the source chain's USDC.
  //
  // The limitation, recorded because it changes what may be claimed: the QUOTE
  // states the amount but does NOT echo the recipient, so a quote proves the fee
  // was applied and not who receives it. Relay is the only provider that closes
  // that gap afterwards — `data.paidAppFees[]` in the request history names
  // recipient, bps and amount, which is what settlement reconciles against.
  relay: {
    bases: ['input'],
    collection: 'in-swap',
    recipientKind: 'provider-intent',
    maxVerification: 'applied-verified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'measured live 2026-09-20: fees.app.amount ~= 100 bps of input; recipient absent from the '
      + '8330-char deposit calldata and not echoed in the quote — confirmable only after settlement '
      + 'via data.paidAppFees[]',
  },
  // MEASURED 19 Sep 2026, keyless li.quest/v1/quote: fee=0.01 + integrator=ChainLens
  // returns estimate.feeCosts[].feeSplit = { lifiFee, integratorFee, recipients:
  // [{name:'lifi'},{name:'ChainLens', fee:'1000000000000000'}] } on a 0.1 ETH input,
  // i.e. exactly 100 bps of the INPUT, and `included: true` (already in toAmount).
  // An unregistered integrator is REFUSED with HTTP 400 rather than silently
  // dropping the fee, which is what makes this verifiable at all.
  lifi: {
    bases: ['input'],
    collection: 'in-swap',
    recipientKind: 'registered-integrator',
    maxVerification: 'applied-verified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,   // commercial terms — not established here
    evidence: 'measured live 2026-09-19: feeSplit.recipients names the integrator and states the amount',
  },
  // MEASURED 19 Sep 2026, keyless lite-api.jup.ag/swap/v1: platformFeeBps=100 returns
  // quote.platformFee = { amount, feeBps:100 } where amount === floor(grossOut * 1%),
  // and outAmount is already NET of it. /swap REFUSES to build without a feeAccount
  // once the quote carries a platformFee, and the account we pass appears in the
  // transaction's static account keys — but Jupiter does NOT check that the account
  // exists or matches the fee mint, so the wallet validates that itself.
  jupiter: {
    bases: ['output'],
    collection: 'in-swap',
    recipientKind: 'referral-token-account',
    maxVerification: 'applied-verified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'measured live 2026-09-19: quote.platformFee states amount+bps; feeAccount is bound into the transaction',
  },
  // 0x Swap API v2 (allowance-holder) documents `fees.integratorFee: {amount, token, type}`
  // echoing the applied fee, taken in an ERC-20 (never native), and `buyAmount` net of
  // it when the fee token is the buy token. NOT exercised here — no key in this
  // environment — so the adapter falls back to tier 2 if the field is absent.
  '0x': {
    bases: ['output', 'input'],
    collection: 'in-swap',
    recipientKind: 'onchain-address',
    maxVerification: 'applied-verified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'per 0x Swap API v2 monetization docs; response schema not exercised (no key here)',
  },
  // Uniswap Trading API: the integrator portion must be enabled by Uniswap Labs on the
  // API key, and the response states `portionBips`/`portionAmount`/`portionRecipient`.
  // Their docs are explicit that an EXACT_INPUT quote's output does NOT already have
  // the portion removed, so the adapter subtracts it exactly once.
  uniswap: {
    bases: ['output'],
    collection: 'in-swap',
    recipientKind: 'onchain-address',
    maxVerification: 'applied-verified',
    quotedOutputIsNetOfAppFee: false,
    providerSharePct: null,
    evidence: 'per Uniswap aggregator quote reference; requires key-side fee enablement, not exercised here',
  },
  // 1inch Classic v6 /swap accepts `fee` + `referrer` and encodes the referrer into the
  // calldata, but the response states NO applied fee amount. That is enough to know
  // WHERE a fee would go and not HOW MUCH, so 1inch cannot reach tier 1 — and is
  // therefore quoted fee-free, rather than charging a user 1% we could never account
  // for. It remains fully eligible to execute swaps.
  '1inch': {
    bases: ['input'],
    collection: 'in-swap',
    recipientKind: 'onchain-address',
    maxVerification: 'payload-bound',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'v6 /swap returns no fee field; referrer is only observable inside calldata',
  },
  // Rango Basic accepts referrerAddress + referrerFee (percent). Its response does not
  // state an applied fee amount we can reconcile, and its docs restrict fee
  // availability by chain. Tier 2, quoted fee-free.
  rango: {
    bases: ['input'],
    collection: 'in-swap',
    recipientKind: 'onchain-address',
    maxVerification: 'requested-unverified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'Rango Basic monetization docs; no applied-fee echo to reconcile, chain eligibility varies',
  },
  // SwapKit v3 takes `affiliateFee` in bps with the beneficiaries configured against the
  // API key in their Partner Dashboard. Without that dashboard state we cannot tell a
  // configured affiliate from an ignored one. Tier 2, quoted fee-free.
  swapkit: {
    bases: ['input'],
    collection: 'in-swap',
    recipientKind: 'registered-integrator',
    maxVerification: 'requested-unverified',
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: 'SwapKit v3 quote reference; affiliate beneficiaries live in the partner dashboard, unverified here',
  },
}

/**
 * Can this provider reach tier 1?
 *
 * Renamed from the old `providerCanCarryAppFee`, which read as "may this
 * provider carry ROUTES" and was used that way. It never meant that, and under
 * the two-tier policy the distinction is the whole point: every provider here
 * can carry routes; only some can carry a verifiable fee.
 */
export function providerCanVerifyAppFee(provider: string): boolean {
  return SWAP_FEE_PROVIDERS[provider]?.maxVerification === 'applied-verified'
}

/**
 * The fee, as a specific route actually priced it.
 *
 * Every field is about ONE swap. Nothing here is a running total, and nothing
 * here asserts the money arrived — that is a settlement question, answered by a
 * swap session, not by a quote.
 */
export interface AppFeeRecord {
  policyVersion: string
  provider: string
  /** What we asked for. 0 on a deliberately fee-free (tier 2) quote. */
  requestedBps: number
  /** What the provider's response says it applied. null when it said nothing. */
  appliedBps: number | null
  base: SwapFeeBase
  /** Chain the fee is taken on (always the source chain for these providers). */
  chain: string
  /** Token the fee is denominated in. */
  tokenAddress: string | null
  tokenSymbol: string | null
  tokenDecimals: number | null
  /** Fee amount in that token's raw base units. '0' on a fee-free route. */
  amountRaw: string | null
  /** Address, integrator name, or referral token account, per `recipientKind`. */
  recipient: string | null
  recipientKind: SwapFeeRecipientKind
  collection: SwapFeeCollection
  providerSharePct: number | null
  verification: SwapFeeVerification
  /** Short provenance strings — what was checked, in order. */
  evidence: string[]
}

/** A cost that is NOT ours: provider, bridge, liquidity or gas. Displayed separately. */
export interface ExternalFeeRecord {
  /** Who charges it, in words the user can read: 'LI.FI', 'Bridge', 'Network'. */
  name: string
  tokenSymbol: string | null
  tokenDecimals: number | null
  amountRaw: string | null
  /** True when the quoted output already has it removed. */
  includedInQuotedOutput: boolean
}

/** floor(amount * bps / 10000) in exact integer arithmetic, or null on bad input. */
export function feeAmountForBps(amountRaw: string, bps: number): string | null {
  if (!/^[0-9]+$/.test(amountRaw || '')) return null
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return null
  try {
    return ((BigInt(amountRaw) * BigInt(bps)) / 10000n).toString()
  } catch {
    return null
  }
}

/**
 * Does a provider-reported fee amount agree with the policy rate applied to the
 * base it says it used?
 *
 * Providers round their own way, so a couple of raw units either side is
 * accepted — but nothing proportional. A tolerance expressed in percent would
 * defeat the whole check, since the thing being checked IS a percentage.
 */
export function feeAmountMatches(
  reportedRaw: string | null | undefined,
  baseAmountRaw: string,
  bps: number,
  toleranceUnits = 2n,
): boolean {
  if (!reportedRaw || !/^[0-9]+$/.test(reportedRaw)) return false
  const expected = feeAmountForBps(baseAmountRaw, bps)
  if (expected == null) return false
  try {
    const diff = BigInt(reportedRaw) - BigInt(expected)
    return (diff < 0n ? -diff : diff) <= toleranceUnits
  } catch {
    return false
  }
}

/** Effective rate a reported amount represents, in bps — for display and reporting. */
export function effectiveBps(amountRaw: string | null, baseAmountRaw: string | null): number | null {
  if (!amountRaw || !baseAmountRaw) return null
  if (!/^[0-9]+$/.test(amountRaw) || !/^[0-9]+$/.test(baseAmountRaw)) return null
  try {
    const base = BigInt(baseAmountRaw)
    if (base <= 0n) return null
    return Number((BigInt(amountRaw) * 10000n) / base)
  } catch {
    return null
  }
}

/**
 * Classify what we can truthfully say about a route's app fee.
 *
 * Derived, never asserted. `confirmed-none` requires that we ASKED for nothing —
 * a provider that was asked for 1% and stayed silent is `unknown`, because
 * silence is not a denial. That distinction is the one the UI and the revenue
 * accounting both depend on.
 */
export function classifyFeeStatus(record: AppFeeRecord | null | undefined): SwapFeeStatus {
  if (!record) return 'unknown'
  if (record.requestedBps === 0) {
    // We asked for nothing. Anything other than a clean "none" here means the
    // response disagrees with our request, which is not a confirmed zero.
    return record.verification === 'none-requested'
      && (record.amountRaw === '0' || record.amountRaw == null)
      && (record.appliedBps === 0 || record.appliedBps == null)
      ? 'confirmed-none'
      : 'unknown'
  }
  if (record.verification !== 'applied-verified') return 'unknown'
  if (!record.amountRaw || !/^[0-9]+$/.test(record.amountRaw)) return 'unknown'
  try {
    if (BigInt(record.amountRaw) <= 0n) return 'unknown'
  } catch {
    return 'unknown'
  }
  return 'verified'
}

/** Only a `verified` fee is revenue. `unknown` never is, and neither is `confirmed-none`. */
export function isEarnedAppFee(record: AppFeeRecord | null | undefined): boolean {
  return classifyFeeStatus(record) === 'verified'
}

export interface FeePolicyCheck {
  ok: boolean
  reason: string | null
}

/** Expected terms a record is judged against, all re-derived by the checker's caller. */
export interface ExpectedFeeTerms {
  policyVersion: string
  bps: number
  provider: string
  chain: string
  /** Amount the fee should be a percentage of, in raw units of the fee token. */
  baseAmountRaw: string | null
}

/**
 * Does this record qualify the route for TIER 1?
 *
 * A "no" is not a refusal to execute — it means the route falls to tier 2 and
 * carries no app fee. This is the function that used to be the signing gate.
 */
export function qualifiesAsFeePaying(
  record: AppFeeRecord | null | undefined,
  expected: ExpectedFeeTerms,
): FeePolicyCheck {
  const no = (reason: string): FeePolicyCheck => ({ ok: false, reason })

  if (!record) return no('no fee record')
  if (record.policyVersion !== expected.policyVersion) return no('priced under a different fee policy')
  if (record.provider !== expected.provider) return no('fee terms belong to another route')
  if (record.requestedBps === 0) return no('quoted deliberately fee-free')
  if (record.requestedBps !== expected.bps) {
    return no(`quoted at ${(record.requestedBps / 100).toFixed(2)}% rather than ${(expected.bps / 100).toFixed(2)}%`)
  }
  if (!providerCanVerifyAppFee(record.provider)) return no(`${record.provider} cannot verify an applied fee`)
  if (classifyFeeStatus(record) !== 'verified') return no(`${record.provider} did not confirm it applied the fee`)
  if (record.appliedBps !== expected.bps) {
    return no(`${record.provider} applied ${(record.appliedBps ?? 0) / 100}% rather than ${expected.bps / 100}%`)
  }
  if (!record.recipient) return no('no configured fee recipient')
  if (!recipientMatchesPolicy(record)) return no('fee recipient is not the configured Magic Money recipient')
  if (expected.baseAmountRaw && !feeAmountMatches(record.amountRaw, expected.baseAmountRaw, expected.bps)) {
    return no('reported fee amount does not reconcile to the policy rate')
  }
  return { ok: true, reason: null }
}

/**
 * The only fee condition that still BLOCKS signing.
 *
 * Failing to collect is now acceptable; being pointed somewhere else is not.
 * A record naming a recipient that is not ours, or priced under a policy the
 * user never saw, means the quote in hand is not the quote that was described —
 * and that is a tampering question, not a revenue one.
 *
 * Note what is deliberately NOT here: a missing record, an unverified fee, and a
 * fee-free route all pass. They cost us money; they do not endanger the user.
 */
export function checkAppFeeIntegrity(
  record: AppFeeRecord | null | undefined,
  expected: ExpectedFeeTerms,
): FeePolicyCheck {
  if (!record) return { ok: true, reason: null }   // no fee claimed, nothing to misdirect

  if (record.policyVersion !== expected.policyVersion) {
    return { ok: false, reason: 'This quote was priced under a different fee policy — refresh the quote to see current terms.' }
  }
  if (record.provider !== expected.provider) {
    return { ok: false, reason: 'The fee terms do not belong to this route — refresh the quote.' }
  }
  if (record.requestedBps < 0 || record.requestedBps > MAX_APP_FEE_BPS) {
    return { ok: false, reason: 'This quote carries a fee rate outside the allowed range — refresh the quote.' }
  }
  if (record.requestedBps > 0 && record.requestedBps !== expected.bps) {
    return {
      ok: false,
      reason: `This route was quoted at a ${(record.requestedBps / 100).toFixed(2)}% app fee rather than the current `
        + `${(expected.bps / 100).toFixed(2)}% — refresh the quote.`,
    }
  }
  // A fee going somewhere that is not ours is the case worth stopping: the user
  // would pay a "Magic Money fee" to a stranger.
  if (record.requestedBps > 0 && record.recipient && !recipientMatchesPolicy(record)) {
    return { ok: false, reason: 'This route would pay the app fee to an address that is not the configured Magic Money recipient.' }
  }
  return { ok: true, reason: null }
}

/**
 * Is the recipient in this record one of ours?
 *
 * Addresses are compared case-insensitively only where that is correct: EVM hex
 * is case-insensitive, base58 is NOT, and treating a Solana account the EVM way
 * would accept a different account that differs only in case.
 */
export function recipientMatchesPolicy(record: AppFeeRecord): boolean {
  const r = record.recipient ?? ''
  if (record.recipientKind === 'none') return !r
  if (!r) return false
  if (record.recipientKind === 'registered-integrator') {
    return r === SWAP_FEE_BENEFICIARIES.lifiIntegrator
  }
  if (record.recipientKind === 'referral-token-account') {
    // The account itself is a PDA per mint; the wallet derives and checks it
    // against the referral account on-chain (see swap-fee.ts). What is
    // checkable here is that the record names an account-shaped recipient.
    return !!record.tokenAddress && r.length >= 32 && !r.startsWith('0x')
  }
  const expected = feeRecipientForChain(record.chain)
  if (/^0x[0-9a-fA-F]{40}$/.test(expected)) return r.toLowerCase() === expected.toLowerCase()
  return r === expected
}

/** A record for a route we deliberately asked to charge nothing. */
export function feeFreeRecord(provider: string, chain: string, why: string): AppFeeRecord {
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider,
    requestedBps: 0,
    appliedBps: 0,
    base: 'input',
    chain,
    tokenAddress: null,
    tokenSymbol: null,
    tokenDecimals: null,
    amountRaw: '0',
    recipient: null,
    recipientKind: 'none',
    collection: 'in-swap',
    providerSharePct: null,
    verification: 'none-requested',
    evidence: [why],
  }
}

/**
 * Human summary for the quote card and for reporting.
 *
 * Never invents a number, and never renders an unknown fee as "none" — the two
 * sentences below are different claims and the user is entitled to the
 * difference.
 */
export function describeAppFee(record: AppFeeRecord | null | undefined): string {
  const status = classifyFeeStatus(record)
  if (status === 'confirmed-none') return 'No Magic Money fee on this route'
  if (status === 'unknown') return 'Magic Money fee not confirmed for this route'
  const pct = ((record!.appliedBps ?? record!.requestedBps) / 100).toFixed(2)
  const where = record!.base === 'input' ? 'of the amount sold' : 'of the amount received'
  return `${pct}% ${where}`
}
