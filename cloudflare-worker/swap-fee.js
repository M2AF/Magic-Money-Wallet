/**
 * swap-fee.js — Worker-side mirror of src/shared/swap-fee-policy.ts.
 *
 * The Worker has no TypeScript build, so the fee policy is duplicated here the
 * same way token normalization is duplicated between tokens.js and
 * swap-token-identity.ts. The duplication is deliberate and GUARDED:
 * src/main/swap-fee-policy.test.ts imports BOTH modules and fails if the rate,
 * the beneficiaries or the provider capability table drift apart.
 *
 * Equally deliberate: nothing the Worker asserts here is trusted by the wallet.
 * The privileged client re-derives every one of these checks against the same
 * policy before it will sign (src/main/swap-fee.ts).
 *
 * TWO TIERS. Routing prefers a route whose app fee is verified, and falls back
 * to an explicitly fee-free route rather than dropping the swap. See the header
 * of the TypeScript module for why, and for what `unknown` must never be
 * flattened into.
 */

export const SWAP_FEE_POLICY_VERSION = '2026-09-19.app-100bps-preferred'
export const APP_FEE_BPS = 100
export const MAX_APP_FEE_BPS = 150

export const SWAP_FEE_BENEFICIARIES = {
  evm: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
  lifiIntegrator: 'ChainLens',
  solanaReferralAccount: '9vBwkLqEcNs6LKv8Szyrt4P9h82SBWaD3hbiDZ1A3hUy',
  solanaWallet: '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d',
  cardano: 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h',
  bitcoin: 'bc1qt6cx7977r8xttn5rg42d2ulnlc7agspycd600w',
  polkadot: '1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS',
}

/** Mirror of SWAP_FEE_PROVIDERS. Keep field-for-field identical to the TS table. */
export const SWAP_FEE_PROVIDERS = {
  // MEASURED 2026-09-20, keyless api.relay.link/quote: appFees:[{recipient,fee:'100'}]
  // returns fees.app.amount = $0.772951 on a $77.60 input, i.e. ~100 bps, taken on
  // the INPUT side and denominated in the source chain's USDC. The quote does NOT
  // echo the recipient -- that only appears after settlement, in the request
  // history's data.paidAppFees[], which names recipient + bps + amount.
  relay: {
    bases: ['input'], collection: 'in-swap', recipientKind: 'provider-intent',
    maxVerification: 'applied-verified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  lifi: {
    bases: ['input'], collection: 'in-swap', recipientKind: 'registered-integrator',
    maxVerification: 'applied-verified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  jupiter: {
    bases: ['output'], collection: 'in-swap', recipientKind: 'referral-token-account',
    maxVerification: 'applied-verified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  '0x': {
    bases: ['output', 'input'], collection: 'in-swap', recipientKind: 'onchain-address',
    maxVerification: 'applied-verified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  uniswap: {
    bases: ['output'], collection: 'in-swap', recipientKind: 'onchain-address',
    maxVerification: 'applied-verified', quotedOutputIsNetOfAppFee: false, providerSharePct: null,
  },
  '1inch': {
    bases: ['input'], collection: 'in-swap', recipientKind: 'onchain-address',
    maxVerification: 'payload-bound', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  rango: {
    bases: ['input'], collection: 'in-swap', recipientKind: 'onchain-address',
    maxVerification: 'requested-unverified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
  swapkit: {
    bases: ['input'], collection: 'in-swap', recipientKind: 'registered-integrator',
    maxVerification: 'requested-unverified', quotedOutputIsNetOfAppFee: true, providerSharePct: null,
  },
}

/** Can this provider reach tier 1? Every provider can still SERVE routes. */
export function providerCanVerifyAppFee(provider) {
  const cap = SWAP_FEE_PROVIDERS[provider]
  return !!cap && cap.maxVerification === 'applied-verified'
}

/**
 * The rate in force, from env, refusing anything the policy does not allow.
 *
 * A misconfigured FEE_BPS used to fall back to a default and keep serving. It
 * now throws: quoting at a rate nobody approved is worse than not quoting, and
 * the error names the variable so the misconfiguration is visible in /health
 * rather than in a user's fill.
 */
export function policyFeeBps(env) {
  const raw = env.FEE_BPS
  if (raw == null || raw === '') return APP_FEE_BPS
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_APP_FEE_BPS) {
    throw new Error(`FEE_BPS is not a valid app fee rate (0-${MAX_APP_FEE_BPS} bps)`)
  }
  return n
}

/**
 * Beneficiary for a chain, validated against the policy table.
 *
 * An env value that disagrees with the checked-in beneficiary is treated as a
 * misconfiguration, not as an override: the wallet validates recipients against
 * its own copy of this table and would refuse the quote anyway.
 */
export function policyFeeRecipient(env, chain) {
  const c = (chain || '').toLowerCase()
  const envValue =
    c === 'solana' ? env.FEE_SOLANA
    : c === 'cardano' ? env.FEE_CARDANO
    : c === 'bitcoin' ? env.FEE_BITCOIN
    : c === 'polkadot' ? env.FEE_POLKADOT
    : env.FEE_EVM
  const expected =
    c === 'solana' ? SWAP_FEE_BENEFICIARIES.solanaWallet
    : c === 'cardano' ? SWAP_FEE_BENEFICIARIES.cardano
    : c === 'bitcoin' ? SWAP_FEE_BENEFICIARIES.bitcoin
    : c === 'polkadot' ? SWAP_FEE_BENEFICIARIES.polkadot
    : SWAP_FEE_BENEFICIARIES.evm
  if (!envValue) return expected
  const same = /^0x[0-9a-f]{40}$/i.test(expected)
    ? String(envValue).toLowerCase() === expected.toLowerCase()
    : String(envValue) === expected
  if (!same) throw new Error(`Configured fee recipient for ${c || 'evm'} does not match the fee policy`)
  return expected
}

/** LI.FI integrator name, validated the same way. */
export function policyLifiIntegrator(env) {
  const envValue = env.LIFI_INTEGRATOR
  if (!envValue) return SWAP_FEE_BENEFICIARIES.lifiIntegrator
  if (String(envValue) !== SWAP_FEE_BENEFICIARIES.lifiIntegrator) {
    throw new Error('Configured LI.FI integrator does not match the fee policy')
  }
  return SWAP_FEE_BENEFICIARIES.lifiIntegrator
}

export function feeAmountForBps(amountRaw, bps) {
  if (!/^[0-9]+$/.test(String(amountRaw || ''))) return null
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return null
  try { return ((BigInt(amountRaw) * BigInt(bps)) / 10000n).toString() } catch { return null }
}

export function feeAmountMatches(reportedRaw, baseAmountRaw, bps, toleranceUnits = 2n) {
  if (!reportedRaw || !/^[0-9]+$/.test(String(reportedRaw))) return false
  const expected = feeAmountForBps(baseAmountRaw, bps)
  if (expected == null) return false
  try {
    const diff = BigInt(reportedRaw) - BigInt(expected)
    return (diff < 0n ? -diff : diff) <= toleranceUnits
  } catch { return false }
}

export function effectiveBps(amountRaw, baseAmountRaw) {
  if (!amountRaw || !baseAmountRaw) return null
  if (!/^[0-9]+$/.test(String(amountRaw)) || !/^[0-9]+$/.test(String(baseAmountRaw))) return null
  try {
    const base = BigInt(baseAmountRaw)
    if (base <= 0n) return null
    return Number((BigInt(amountRaw) * 10000n) / base)
  } catch { return null }
}

/** Mirror of classifyFeeStatus — derived, never asserted by an adapter. */
export function classifyFeeStatus(record) {
  if (!record) return 'unknown'
  if (record.requestedBps === 0) {
    return record.verification === 'none-requested'
      && (record.amountRaw === '0' || record.amountRaw == null)
      && (record.appliedBps === 0 || record.appliedBps == null)
      ? 'confirmed-none'
      : 'unknown'
  }
  if (record.verification !== 'applied-verified') return 'unknown'
  if (!record.amountRaw || !/^[0-9]+$/.test(String(record.amountRaw))) return 'unknown'
  try { if (BigInt(record.amountRaw) <= 0n) return 'unknown' } catch { return 'unknown' }
  return 'verified'
}

/** Empty skeleton for a fee-BEARING request, so every adapter emits one shape. */
export function emptyFeeRecord(provider, chain, requestedBps) {
  const cap = SWAP_FEE_PROVIDERS[provider] || {}
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider,
    requestedBps,
    appliedBps: null,
    base: (cap.bases && cap.bases[0]) || 'input',
    chain,
    tokenAddress: null, tokenSymbol: null, tokenDecimals: null,
    amountRaw: null,
    recipient: null,
    recipientKind: cap.recipientKind || 'onchain-address',
    collection: cap.collection || 'in-swap',
    providerSharePct: cap.providerSharePct ?? null,
    verification: 'requested-unverified',
    evidence: [],
  }
}

/** A record for a route we deliberately asked to charge nothing (tier 2). */
export function feeFreeRecord(provider, chain, why) {
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider,
    requestedBps: 0,
    appliedBps: 0,
    base: 'input',
    chain,
    tokenAddress: null, tokenSymbol: null, tokenDecimals: null,
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
 * Is our recipient's address actually present in the payload that will execute?
 *
 * Not proof of an amount, and not proof of a transfer — an address can appear in
 * calldata for other reasons. It IS proof that the beneficiary is bound into the
 * bytes the user is about to sign, which a request parameter is not.
 */
export function recipientBoundInCalldata(calldata, recipient) {
  if (!calldata || !recipient) return false
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) return false
  return String(calldata).toLowerCase().includes(recipient.slice(2).toLowerCase())
}

/**
 * Which tier a served quote belongs to, and why it is not tier 1.
 *
 * Returns { tier, reason }. `reason` is null for tier 1; otherwise it names the
 * gap in words that belong in a log, not in a user-facing error — under the
 * two-tier policy this is never the reason a swap is unavailable.
 */
export function feeTierOf(quote, bps) {
  const rec = quote && quote.appFee
  const status = classifyFeeStatus(rec)
  if (status === 'verified' && rec.requestedBps === bps && rec.appliedBps === bps && rec.recipient) {
    return { tier: 'fee-paying', reason: null }
  }
  if (!rec) return { tier: 'fee-free', reason: `${quote && quote.provider}: no fee record` }
  if (status === 'confirmed-none') return { tier: 'fee-free', reason: `${rec.provider}: quoted fee-free` }
  return { tier: 'fee-free', reason: `${rec.provider}: fee not confirmed (${status})` }
}

/**
 * Rank by ACTUAL net output — the amount the user receives after everything the
 * adapter normalized out of it.
 *
 * No hypothetical penalties. The predecessor of this function discounted each
 * quote by a fee it had NOT charged and then returned the undiscounted quote,
 * which was an accounting fiction in both directions. Tier selection happens
 * before this runs, so within a tier the comparison is like-for-like.
 */
export function byNetOutputDesc(a, b) {
  const v = (q) => { try { return BigInt(q.buyAmountRaw) } catch { return 0n } }
  const av = v(a), bv = v(b)
  return av > bv ? -1 : av < bv ? 1 : 0
}
