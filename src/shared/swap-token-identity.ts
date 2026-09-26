/**
 * swap-token-identity.ts — the one token identity the DEX swap uses everywhere.
 *
 * The swap picker used to identify a token by its SYMBOL, which is not an
 * identity at all: a live Jupiter search for "BONK" returns five different mints
 * with three different decimal counts, and picking the wrong one is a silent
 * wrong-token trade. Everything here is keyed on chain + contract/mint instead.
 *
 * Two address rules that are NOT interchangeable, and are the reason this file
 * exists rather than a `.toLowerCase()` at each call site:
 *
 *   EVM     hex, case-insensitive (the mixed case is only an EIP-55 checksum).
 *           Lowercasing is safe and is what makes dedupe across providers work —
 *           Relay returns lowercase, LI.FI returns checksummed, same token.
 *   Solana  base58, case-SENSITIVE. `So111…112` and `so111…112` are different
 *           strings and only one is a real mint. Lowercasing a mint destroys it.
 *   Cardano the FULL unit: 56-hex policy id + 0-32 bytes of asset-name hex,
 *           lowercased (hex). ADA is the separate identity `lovelace`. A policy
 *           id alone, a ticker, or a decoded name is never an identity — the
 *           same name is minted under many policies.
 *
 * Providers also disagree about how to spell a chain's own coin: Relay says the
 * zero address, 0x/1inch/LI.FI say the 0xeee… sentinel, Jupiter says the wrapped
 * SOL mint. They all collapse to one spelling here so a quote request built from
 * a discovered token reaches the aggregators in the form they already expect.
 *
 * Platform-neutral by design (no Electron, Chrome, Capacitor, node: or fetch) so
 * the Electron main process, the extension/Capacitor handler router, the renderer
 * and — later — ChainLens can all import it unchanged.
 */

/**
 * Chains the DEX swap can discover tokens on. EVM members share the hex rules.
 *
 * Must equal the executor's signable set (`EVM_CHAIN_ID` in
 * src/main/swap-executor.ts) and the Worker's `EVM_CHAIN_IDS` in tokens.js and
 * swap-proxy.js — pinned by swap-chain-set-parity.test.ts. It listed only the
 * original 8 until 2026-09-22, so on Robinhood, Arc and the other networks added
 * since, every EVM address failed validation and discovered tokens were dropped.
 */
export const EVM_SWAP_CHAINS = new Set([
  'ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'bsc', 'monad',
  'blast', 'gnosis', 'abstract', 'apechain', 'robinhood', 'arc', 'ronin', 'soneium',
  'worldchain', 'zora', 'hyperevm',
])

export function isEvmSwapChain(chain: string): boolean {
  return EVM_SWAP_CHAINS.has((chain ?? '').trim().toLowerCase())
}

/** EVM native-asset sentinel used by 0x / 1inch / LI.FI (and our curated lists). */
export const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const EVM_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** Wrapped-SOL mint. Jupiter treats it as native SOL, and so do our curated lists. */
export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Cardano's own coin. Not an asset unit — ADA has no policy — so it is a
 * distinct identity that can never collide with one.
 */
export const CARDANO_LOVELACE = 'lovelace'

/**
 * Circle's USDCx, pinned by FULL unit (policy id + asset-name hex "USDCx").
 * Measured 2026-09-26: Minswap search returns other assets named `USDCx`
 * (`5553444378`) under different policies, so neither the symbol nor the name
 * identifies it. Source: developers.circle.com/xreserve/references/
 * supported-blockchains-and-domains. The two networks' units differ, and a
 * swap is only ever quoted on mainnet (see swap-network-resolver.ts).
 */
export const CARDANO_USDCX_UNIT = {
  mainnet: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378',
  preprod: '31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf665553444378',
} as const

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
/**
 * A Cardano native-asset unit: a 28-byte policy id followed by an asset name of
 * 0-32 BYTES, all hex. The name is bytes, not text — it is kept exactly, and a
 * half byte (odd length) is not a name at all.
 */
const CARDANO_UNIT_RE = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/

/** True when this address means "the chain's own coin" in ANY provider's spelling. */
export function isNativeSwapAddress(chain: string, address: string): boolean {
  const raw = (address ?? '').trim()
  if (!raw) return false
  if (isEvmSwapChain(chain)) {
    const lower = raw.toLowerCase()
    return lower === NATIVE_EVM_SENTINEL || lower === EVM_ZERO_ADDRESS
  }
  if (isSolanaSwapChain(chain)) {
    // LI.FI spells native SOL as the system program; Jupiter uses wrapped SOL.
    return raw === SOL_NATIVE_MINT || raw === '11111111111111111111111111111111'
  }
  if (isCardanoSwapChain(chain)) return raw.toLowerCase() === CARDANO_LOVELACE
  return false
}

export function isSolanaSwapChain(chain: string): boolean {
  return (chain ?? '').trim().toLowerCase() === 'solana'
}

export function isCardanoSwapChain(chain: string): boolean {
  return (chain ?? '').trim().toLowerCase() === 'cardano'
}

/** Split a validated Cardano unit into its policy id and asset-name hex. */
export function splitCardanoUnit(unit: string): { policyId: string; assetNameHex: string } | null {
  const raw = (unit ?? '').trim().toLowerCase()
  if (!CARDANO_UNIT_RE.test(raw)) return null
  return { policyId: raw.slice(0, 56), assetNameHex: raw.slice(56) }
}

/**
 * The address as the aggregators expect it, with every provider's native spelling
 * collapsed onto ours. EVM is lowercased (checksum is advisory); a Solana mint is
 * returned byte-for-byte because its case carries information.
 */
export function normalizeSwapAddress(chain: string, address: string): string {
  const raw = (address ?? '').trim()
  if (!raw) return ''
  if (isEvmSwapChain(chain)) {
    return isNativeSwapAddress(chain, raw) ? NATIVE_EVM_SENTINEL : raw.toLowerCase()
  }
  if (isSolanaSwapChain(chain)) {
    return isNativeSwapAddress(chain, raw) ? SOL_NATIVE_MINT : raw
  }
  // Hex is case-insensitive, so folding is safe; the name BYTES are unchanged.
  if (isCardanoSwapChain(chain)) return raw.toLowerCase()
  return raw
}

/**
 * Dedupe/lookup key for a token. Chain-qualified, so the same symbol on two
 * networks never collides, and case-folded ONLY where the chain says that is safe.
 */
export function swapAssetKey(chain: string, address: string): string {
  const c = (chain ?? '').trim().toLowerCase()
  return `${c}:${normalizeSwapAddress(c, address)}`
}

/** Decoded byte length of a base58 string, or -1 when it isn't valid base58. */
function base58ByteLength(value: string): number {
  if (!value || !BASE58_RE.test(value)) return -1
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes: number[] = []
  for (const char of value) {
    let carry = ALPHABET.indexOf(char)
    if (carry < 0) return -1
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // Each leading '1' is a leading zero byte.
  let leadingZeros = 0
  for (const char of value) {
    if (char !== '1') break
    leadingZeros++
  }
  return bytes.length + leadingZeros
}

/**
 * Structural validity only — that this string COULD name a token on this chain.
 * It says nothing about whether the token exists, is fungible, or is tradable;
 * that needs a provider lookup and, ultimately, a quote.
 */
export function isValidSwapAddress(chain: string, address: string): boolean {
  const raw = (address ?? '').trim()
  if (!raw) return false
  if (isEvmSwapChain(chain)) return EVM_ADDRESS_RE.test(raw)
  if (isSolanaSwapChain(chain)) return base58ByteLength(raw) === 32
  if (isCardanoSwapChain(chain)) {
    return raw.toLowerCase() === CARDANO_LOVELACE || splitCardanoUnit(raw) != null
  }
  return false
}

/** True when the user's search box holds an exact contract/mint rather than a name. */
export function looksLikeSwapAddress(chain: string, query: string): boolean {
  return isValidSwapAddress(chain, (query ?? '').trim())
}

/**
 * A token as discovery returns it. Superset of the curated `SwapToken` shape, so
 * a discovered token can be selected anywhere a curated one could.
 *
 * `verified` is deliberately a tri-state: providers report "verified" or say
 * nothing at all, and "nothing at all" means UNKNOWN, not safe. Jupiter in
 * particular omits `isVerified` entirely rather than sending false.
 */
export interface DiscoveredToken {
  chain: string
  symbol: string
  name: string
  address: string
  decimals: number
  logoUri: string | null
  isNative: boolean
  /** true = provider asserts verified; false = provider asserts NOT; null = unknown. */
  verified: boolean | null
  /** Which discovery source produced this record (provenance for debugging/ranking). */
  source: string
  priceUsd?: number | null
  liquidityUsd?: number | null
  /** Solana only: the owning token program. Token-2022 mints can carry transfer fees. */
  tokenProgram?: string | null
}

/** Token-2022 program id. Mints owned by it may levy transfer fees or block transfer. */
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

export function isToken2022(token: Pick<DiscoveredToken, 'tokenProgram'>): boolean {
  return token.tokenProgram === TOKEN_2022_PROGRAM
}

const MAX_TEXT = 64

/** Collapse whitespace/control characters and clamp length for untrusted provider text. */
function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped.slice(0, MAX_TEXT) || fallback
}

/**
 * Only https: images are kept. A provider-supplied `javascript:`/`data:` URI would
 * otherwise be handed straight to an <img src>, and token metadata is attacker-
 * controlled: anyone can mint a token and name its logo.
 */
function cleanLogoUri(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.length > 512) return null
  return /^https:\/\//i.test(raw) ? raw : null
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Validate one token record from an untrusted source (a provider, the Worker, or
 * cached JSON) into a `DiscoveredToken`, or null when it cannot be trusted.
 *
 * Decimals are the field worth being strict about: they convert a raw integer into
 * the number a user reads and approves. A missing or junk value must drop the
 * token, never default to 18 — an 18 assumed for a 6-decimal token misprices the
 * trade by a factor of a trillion.
 */
export function sanitizeDiscoveredToken(raw: unknown, chain: string): DiscoveredToken | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const c = (chain ?? '').trim().toLowerCase()
  if (!c) return null

  const address = typeof t.address === 'string' ? t.address.trim() : ''
  if (!isValidSwapAddress(c, address)) return null

  const decimals = typeof t.decimals === 'number' ? t.decimals : Number(t.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 32) return null

  const symbol = cleanText(t.symbol)
  if (!symbol) return null

  return {
    chain: c,
    symbol,
    name: cleanText(t.name, symbol),
    address: normalizeSwapAddress(c, address),
    decimals,
    logoUri: cleanLogoUri(t.logoUri ?? t.logoURI ?? t.icon),
    isNative: typeof t.isNative === 'boolean' ? t.isNative : isNativeSwapAddress(c, address),
    verified: typeof t.verified === 'boolean' ? t.verified : null,
    source: cleanText(t.source, 'unknown'),
    priceUsd: finiteOrNull(t.priceUsd),
    liquidityUsd: finiteOrNull(t.liquidityUsd),
    tokenProgram: typeof t.tokenProgram === 'string' ? t.tokenProgram : null,
  }
}

/**
 * Merge token lists from several sources, earlier lists winning on conflict.
 *
 * Providers genuinely disagree about metadata for the same mint (a logo one has
 * and another doesn't, a verified flag only one asserts), so fields are filled in
 * from later sources rather than the whole record being dropped. Decimals are the
 * exception: the FIRST source's value is kept, because silently adopting another
 * provider's decimals for a token already resolved would change what the amount
 * means after the user typed it.
 */
export function mergeDiscoveredTokens(...lists: DiscoveredToken[][]): DiscoveredToken[] {
  const out = new Map<string, DiscoveredToken>()
  for (const list of lists) {
    for (const token of list ?? []) {
      const key = swapAssetKey(token.chain, token.address)
      const held = out.get(key)
      if (!held) {
        out.set(key, { ...token })
        continue
      }
      if (held.logoUri == null && token.logoUri != null) held.logoUri = token.logoUri
      if (held.verified == null && token.verified != null) held.verified = token.verified
      if (held.priceUsd == null && token.priceUsd != null) held.priceUsd = token.priceUsd
      if (held.liquidityUsd == null && token.liquidityUsd != null) held.liquidityUsd = token.liquidityUsd
      if (held.tokenProgram == null && token.tokenProgram != null) held.tokenProgram = token.tokenProgram
    }
  }
  return [...out.values()]
}

/**
 * Order search results for the picker.
 *
 * Exact symbol/address matches first, then verified, then liquidity — but nothing
 * is REMOVED for being unverified or illiquid. The whole point of the change is
 * that a user who pastes the mint of a token nobody has verified yet still finds
 * it; the UI marks it unverified instead of hiding it.
 */
export function rankDiscoveredTokens(tokens: DiscoveredToken[], query: string): DiscoveredToken[] {
  const q = (query ?? '').trim().toLowerCase()
  const score = (t: DiscoveredToken): number => {
    let s = 0
    if (q) {
      const symbol = t.symbol.toLowerCase()
      if (t.address.toLowerCase() === q) s += 1000
      else if (symbol === q) s += 500
      else if (symbol.startsWith(q)) s += 200
      else if (t.name.toLowerCase().startsWith(q)) s += 100
    }
    if (t.isNative) s += 300
    if (t.verified === true) s += 50
    const liq = t.liquidityUsd ?? 0
    if (liq > 0) s += Math.min(40, Math.log10(liq + 1) * 5)
    return s
  }
  return [...tokens].sort((a, b) => score(b) - score(a))
}
