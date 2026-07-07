/**
 * spam-filter.ts — heuristic scam-token detection (audit H-1).
 *
 * Airdropped scam tokens abuse the name/symbol fields to display phishing copy
 * ("$ CLAiM : ethena-v2.com", "!Ads BTC Casino www.MaticSlot.io"). Rendering
 * them as ordinary holdings lends the wallet's credibility to the phishing URL,
 * so tokens matching these heuristics are flagged `suspectedSpam` at fetch time
 * and the dashboard buckets them with user-marked spam (restorable from the
 * Hidden & Spam manager — a restore whitelists the token permanently).
 *
 * Guardrail against false positives: a token is only ever flagged when it has
 * NO positive USD value. Scam mints have no price feed, while legit tokens with
 * domain-style names (e.g. yearn.finance) are priced — so the value check alone
 * clears them. Testnet tokens skip price enrichment entirely, but testnet mode
 * has no real-funds phishing surface, and a flagged token is restorable.
 */

export interface SpamCheckToken {
  name: string
  symbol: string
  usdValue: string | null
}

// Common TLDs seen in wallet-drainer airdrops. Deliberately NOT "every TLD" —
// each entry is a phishing-bait pattern, not a general URL parser.
const TLDS =
  'com|net|org|io|xyz|fi|app|site|club|top|vip|cc|pro|info|online|live|finance' +
  '|cash|gift|link|lol|run|click|store|fun|icu|today|life|world|events|space' +
  '|website|monster|rest|claims|codes'

// Explicit scheme/www, or a bare domain like "halving-btc.net".
const DOMAIN_RE = new RegExp(
  `(?:https?://|www\\.|\\b[a-z0-9][a-z0-9-]*\\.(?:${TLDS})\\b)`, 'i'
)

// Call-to-action bait: "claim", "airdrop", "visit … to redeem", etc.
const BAIT_RE = /\b(?:claim|airdrop|voucher|give?away|rewards?|redeem|bonus|visit)\b/i

function hasPositiveUsd(usdValue: string | null): boolean {
  if (!usdValue) return false
  const n = parseFloat(usdValue.replace(/[$,]/g, ''))
  return Number.isFinite(n) && n > 0
}

/** True when a token looks like a phishing airdrop (see module doc). */
export function isSuspectedSpamToken(token: SpamCheckToken): boolean {
  if (hasPositiveUsd(token.usdValue)) return false
  const text = `${token.name} ${token.symbol}`
  return DOMAIN_RE.test(text) || BAIT_RE.test(text)
}
