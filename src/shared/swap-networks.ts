/**
 * swap-networks.ts — swap CAPABILITY, keyed by the wallet's own network identity.
 *
 * TWO THINGS THAT ARE NOT THE SAME THING
 *
 * The wallet's network registry (`src/main/chain-config.ts`) answers "what is
 * this chain?" — its id, its numeric chain id, its native asset, its RPC. This
 * module answers "what can we do with it?" and deliberately does NOT restate any
 * of the first. Being listed in the Networks tab, or having a working RPC, says
 * nothing about whether a swap on that chain can be quoted, signed or settled.
 *
 * The previous arrangement had a second hardcoded list (`DEX_CHAINS` in the
 * renderer) naming nine chains by hand. It drifted, in both directions: it
 * offered `bsc`, which the wallet has no network for at all, and it omitted
 * eleven chains the Networks tab shows and the providers actually support —
 * including Robinhood Chain, Arc and Abstract. A list maintained by hand beside
 * another list is a list that will disagree with it.
 *
 * So: identity comes from the registry, capability is declared here, and the two
 * are joined by chain id at runtime. A chain with no entry here is simply not
 * swappable yet — it keeps working everywhere else in the wallet.
 *
 * EVERY `verified` FLAG BELOW WAS MEASURED, not read off a support page. A
 * provider listing a chain does not prove a pair on it is executable; each entry
 * records a real quote that returned a signable payload. Dates included so a
 * stale claim is visible as one.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

/** What the wallet can sign for, which is narrower than what it can display. */
export type SwapSigningKind =
  /** secp256k1 EVM transaction, from the account's EOA. */
  | 'evm-eoa'
  /** Ed25519 Solana VersionedTransaction. */
  | 'solana'
  /** Cardano CBOR transaction, key-witnessed by the account's payment key. */
  | 'cardano'
  /** Requires a smart-account path the swap executor does not have. */
  | 'smart-account'
  /** PSBT / CBOR / Substrate — not wired into the swap executor. */
  | 'other'

export type SwapCoverageStatus =
  /** Wired end to end and measured against a live quote. */
  | 'verified'
  /** Wired, but no live measurement here (usually needs a provider key). */
  | 'implemented-unverified'
  /** Deliberately not available, with a reason the user can read. */
  | 'blocked'

export interface SwapNetworkCapability {
  /** Wallet chain id, matching `chain-config.ts`. Identity is NOT redefined here. */
  id: string
  /** EVM numeric chain id, or null for non-EVM. Used to match providers by IDENTITY. */
  chainId: number | null
  signing: SwapSigningKind
  /** Same-chain swap providers with a MEASURED executable quote. */
  sameChain: string[]
  /** Cross-chain providers that can spend FROM this chain. */
  crossChainSource: string[]
  /** Cross-chain providers that can deliver TO this chain. */
  crossChainDestination: string[]
  /** Token search + exact-address lookup available. */
  discovery: boolean
  status: SwapCoverageStatus
  /**
   * Why, in words a user can read, when `status` is not `verified`. Null for a
   * verified chain. Never a vague "unsupported".
   */
  reason: string | null
  /** What was actually measured, and when. Empty for an unmeasured entry. */
  evidence: string
}

/**
 * Measured 19-20 September 2026 against keyless LI.FI (`li.quest/v1`) and Relay
 * (`api.relay.link`). "same-chain" means a quote returned signable calldata for a
 * real pair on that chain; "cross-chain" means a quote returned a signable SOURCE
 * transaction with no destination-chain signature required.
 *
 * TWO THINGS THAT MAKE A PROBE LIE, both hit during this measurement:
 *
 *   AMOUNT.  A first pass at ~0.01 native reported "no route" for Polygon,
 *            Avalanche, Monad and Arbitrum. Re-probed at ~$50 every one of them
 *            routed, same-chain and outbound. The amount was below the bridges'
 *            minimums, not the chain unsupported. A "no route" measured at dust
 *            size is evidence of nothing.
 *   PAIR.    Abstract ETH->PENGU returns no quote while ETH->USDC.e routes via
 *            `fly`. Chain support and pair support are different questions, and
 *            only the second one decides whether a user's swap works.
 *
 * Keyless LI.FI also rate-limits ("retry in 2 hours"), so a probe run can end in
 * false negatives. Entries below say which ones were actually measured.
 */
export const SWAP_NETWORKS: Record<string, SwapNetworkCapability> = {
  ethereum: {
    id: 'ethereum', chainId: 1, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'uniswap', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain ETH->USDT via okx at ~$50, signable calldata',
  },
  arbitrum: {
    id: 'arbitrum', chainId: 42161, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'uniswap', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain ETH->USDC via nordstern; out to ethereum via '
      + 'relaydepository; in via arbitrum bridge. All at ~$50.',
  },
  optimism: {
    id: 'optimism', chainId: 10, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'uniswap', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain via 1inch; out via relaydepository; in via across',
  },
  base: {
    id: 'base', chainId: 8453, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'uniswap', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured same-chain ETH->USDC and cross-chain both directions',
  },
  polygon: {
    id: 'polygon', chainId: 137, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'uniswap', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain POL->USDC via kyberswap; out to ethereum via '
      + 'across at ~$50 (a 0.01-POL probe had falsely reported no route)',
  },
  avalanche: {
    id: 'avalanche', chainId: 43114, signing: 'evm-eoa',
    sameChain: ['0x', '1inch', 'lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain AVAX->USDt via okx; out via layerswap at ~$50; '
      + 'in via layerswap',
  },
  monad: {
    id: 'monad', chainId: 143, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: same-chain MON->USDC via kyberswap; out to ethereum via '
      + 'polymerStandard at ~$50; in via mayanFastMCTP. Relay also quotes EMO(143)->PIXL(1).',
  },
  // ── Newly covered. All three were in the Networks tab with no swap support. ──
  robinhood: {
    id: 'robinhood', chainId: 4663, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: 457 LI.FI tokens; same-chain ETH->cbBTC via nordstern; '
      + 'x-chain out via across, in via layerswap; 1% integrator fee applied on both',
  },
  arc: {
    id: 'arc', chainId: 5042, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    // Arc's gas asset is USDC, and it has TWO representations that must not be
    // mixed: the protocol carries balances and gas in 18-decimal wei units like
    // any EVM chain (gasPrice measured at ~20.7 gwei, which would be 435M USDC
    // if the native unit were 6 decimals), while LI.FI swaps it as a SIX-decimal
    // ERC-20 mirror at 0x3600...0000. Reading the mirror's decimals as the gas
    // reserve would be wrong by 1e12. LI.FI also normalizes the zero address to
    // that mirror and quotes value=0x0, so selling it is an approval flow, not a
    // native-value flow -- which the executor already handles, because the mirror
    // address is not the native sentinel.
    evidence: 'measured 2026-09-20: LI.FI reports native USDC dec=6 at 0x3600...0000 while '
      + 'eth_gasPrice implies 18-decimal protocol units; x-chain out via lifiIntents, in via across',
  },
  abstract: {
    id: 'abstract', chainId: 2741, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    // NOTE: this covers the account's EOA only. The Abstract Global Wallet is a
    // SMART ACCOUNT with its own balance, and the EOA cannot spend it — see
    // `abstract-agw` below.
    evidence: 'measured 2026-09-20: chain id 2741 confirmed by RPC; same-chain ETH->USDC.e via fly; '
      + 'out via relaydepository; in via stargateV2Bus. EOA source only. Note ETH->PENGU returns NO '
      + 'quote on the same chain -- pair availability is not chain availability. 14 tokens listed.',
  },
  'abstract-agw': {
    id: 'abstract-agw', chainId: 2741, signing: 'smart-account',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Swaps from the Abstract Global Wallet are not enabled. The smart account holds its own '
      + 'balance, which the signing key for your regular Abstract address cannot spend — a swap quoted '
      + 'against one and signed by the other would fail or move the wrong funds. Swap from your Abstract '
      + 'address instead, or move funds out of the smart wallet first.',
    evidence: 'AGW is an ERC-4337-style smart account; the swap executor signs EOA transactions only',
  },
  worldchain: {
    id: 'worldchain', chainId: 480, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: chain id 480 confirmed by RPC; native is ETH (registry said WLD); '
      + 'same-chain ETH->USDC via lifidexaggregator; x-chain both directions',
  },
  soneium: {
    id: 'soneium', chainId: 1868, signing: 'evm-eoa',
    sameChain: [],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: x-chain out via layerswap, in via across. No same-chain pair '
      + 'quoted in probing; same-chain remains provider-dependent.',
  },
  blast: {
    id: 'blast', chainId: 81457, signing: 'evm-eoa',
    sameChain: [],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: x-chain out via squid, in via layerswap',
  },
  gnosis: {
    id: 'gnosis', chainId: 100, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi', 'relay'], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured 2026-09-20: 724 LI.FI tokens; same-chain xDAI->USDC via sushiswap; '
      + 'x-chain out via stargateV2Bus, in via gasZipBridge',
  },
  apechain: {
    id: 'apechain', chainId: 33139, signing: 'evm-eoa',
    sameChain: [],
    crossChainSource: [], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified',
    reason: 'Swapping OUT of ApeChain has no route through the providers configured here. '
      + 'Bridging IN to ApeChain works. Only 7 tokens are listed for this chain.',
    evidence: 'measured 2026-09-20: x-chain IN via relaydepository; x-chain OUT returned '
      + 'HTTP 404 "No available quotes"; no same-chain pair found',
  },
  ronin: {
    id: 'ronin', chainId: 2020, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: [], crossChainDestination: ['lifi', 'relay'],
    discovery: true, status: 'verified',
    reason: 'Same-chain swaps on Ronin work. Swapping OUT to another chain has no route through '
      + 'the providers configured here; bridging IN works.',
    evidence: 'measured 2026-09-20: same-chain RON->USDC via kyberswap; x-chain IN via '
      + 'relaydepository; x-chain OUT returned HTTP 404',
  },
  zora: {
    id: 'zora', chainId: 7777777, signing: 'evm-eoa',
    sameChain: [],
    crossChainSource: ['relay'], crossChainDestination: ['relay'],
    discovery: true, status: 'implemented-unverified',
    reason: null,
    evidence: 'measured 2026-09-20: chain id 7777777 confirmed by RPC. LI.FI does NOT list Zora; '
      + 'Relay does. Routed through Relay only, no live pair quoted here.',
  },
  hyperevm: {
    id: 'hyperevm', chainId: 999, signing: 'evm-eoa',
    sameChain: ['lifi'],
    crossChainSource: ['lifi'], crossChainDestination: ['lifi'],
    discovery: true, status: 'verified', reason: null,
    // This chain was previously recorded as blocked "because neither aggregator
    // routes it". That was an artefact of the registry carrying 998 -- the
    // TESTNET id -- for mainnet. Under its real id every route quotes, so the
    // identity fix is what unblocked it. A swap signed for 998 would have been
    // rejected by the network anyway.
    evidence: 'measured 2026-09-20: rpc.hyperliquid.xyz/evm reports 0x3e7 (999); registry carried '
      + '998, which is HyperEVM TESTNET. 6891 LI.FI tokens listed; same-chain HYPE->USD₮0 via enso '
      + 'and via fly; out to ethereum and in from ethereum both via relaydepository, all signable.',
  },
  solana: {
    id: 'solana', chainId: null, signing: 'solana',
    sameChain: ['jupiter', 'lifi'],
    crossChainSource: ['lifi'], crossChainDestination: ['lifi'],
    discovery: true, status: 'verified', reason: null,
    evidence: 'measured: Jupiter same-chain with verified platform fee; LI.FI cross-chain',
  },
  // ── Present in the Networks tab, deliberately not swappable ────────────────
  bitcoin: {
    id: 'bitcoin', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'DEX swaps need a transaction this wallet signs locally, and Bitcoin spending uses PSBT '
      + 'signing the swap executor does not have. Use the Cross-Chain tab for BTC.',
    evidence: 'executor has no PSBT path for swap payloads',
  },
  // Same-chain only, through Minswap V2 batcher orders. NOT 'verified': every
  // piece below was measured live, but no swap has yet been executed with real
  // funds from this wallet (docs/RELEASE-QA.md). Cross-chain in or out needs the
  // xReserve leg, which is not enabled (docs/CARDANO-SWAP-DISCOVERY.md).
  cardano: {
    id: 'cardano', chainId: null, signing: 'cardano',
    sameChain: ['minswap'], crossChainSource: [], crossChainDestination: [],
    discovery: true, status: 'implemented-unverified',
    reason: null,
    evidence: 'measured 2026-09-26, agg-api.minswap.org (keyless): exact-unit search; estimate + unsigned '
      + 'build-tx for USDCx->SNEK (2-hop via NIGHT), ADA->USDCx (1-hop and 2-hop) as Minswap V2 orders; '
      + 'order script c3e28c36... matches the published minswap-dex-v2 README; every recorded build passes '
      + 'the pre-signing validator. Not yet executed with real funds.',
  },
  polkadot: {
    id: 'polkadot', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Polkadot needs Substrate extrinsic signing, which the swap executor does not have. '
      + 'Use the Cross-Chain tab for DOT.',
    evidence: 'no Substrate signing in the swap executor',
  },
  tron: {
    id: 'tron', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Tron swaps are not enabled. Tron transactions are not EVM transactions and the swap '
      + 'executor cannot sign them.',
    evidence: 'Tron uses its own transaction format; no adapter wired',
  },
  dogecoin: {
    id: 'dogecoin', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Dogecoin swaps are not enabled. UTXO spending needs PSBT-style signing the swap executor '
      + 'does not have. Use the Cross-Chain tab for DOGE.',
    evidence: 'UTXO chain, no swap signing path',
  },
  monero: {
    id: 'monero', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Monero swaps are not available in Swap. Routing XMR through a DEX aggregator would defeat '
      + 'Privacy Mode.',
    evidence: 'privacy chain; deliberately excluded',
  },
  zcash: {
    id: 'zcash', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Zcash swaps are not available in Swap.',
    evidence: 'privacy chain; deliberately excluded',
  },
  midnight: {
    id: 'midnight', chainId: null, signing: 'other',
    sameChain: [], crossChainSource: [], crossChainDestination: [],
    discovery: false, status: 'blocked',
    reason: 'Midnight swaps are not available in Swap.',
    evidence: 'privacy chain; deliberately excluded',
  },
}

/**
 * One network as the swap picker sees it: registry IDENTITY joined with measured
 * CAPABILITY. Built in the privileged layer (src/main/swap-network-resolver.ts);
 * the renderer only displays it, and never decides swappability itself.
 */
export interface SwapNetworkOption {
  id: string
  label: string
  chainId: number | null
  color: string
  /** May this network be offered as a swap SOURCE? */
  source: boolean
  /** May a swap DELIVER here? A superset of `source`. */
  destination: boolean
  /** Null when swappable; otherwise a reason a user can read. */
  reason: string | null
  status: SwapCoverageStatus | 'unsupported'
  isCustom: boolean
  /**
   * Swaps here must start AND end on this network (Cardano: no bridge leg is
   * enabled). The picker pairs it with itself; the privileged gate refuses
   * anything else regardless.
   */
  sameChainOnly?: boolean
}

/** Capability for a wallet chain id, or null when the chain has no entry. */
export function swapCapability(chainId: string): SwapNetworkCapability | null {
  return SWAP_NETWORKS[chainId] ?? null
}

/** Chains the picker may offer as a SOURCE (something must be signable there). */
export function swappableSourceChains(): SwapNetworkCapability[] {
  return Object.values(SWAP_NETWORKS).filter(c =>
    c.status !== 'blocked'
    && (c.signing === 'evm-eoa' || c.signing === 'solana')
    && (c.sameChain.length > 0 || c.crossChainSource.length > 0))
}

/** Chains a swap may DELIVER to, which is a strictly larger set than the above. */
export function swappableDestinationChains(): SwapNetworkCapability[] {
  // A same-chain-only destination (Cardano) is reachable only from a source on
  // the same chain, which this helper's consumers (ChainLens) cannot sign for.
  return Object.values(SWAP_NETWORKS).filter(c =>
    c.status !== 'blocked'
    && (c.crossChainDestination.length > 0
      || (c.sameChain.length > 0 && (c.signing === 'evm-eoa' || c.signing === 'solana'))))
}

/** Match an imported network to capability by VERIFIED chain id, never by name. */
export function capabilityForChainId(chainId: number): SwapNetworkCapability | null {
  if (!Number.isInteger(chainId) || chainId <= 0) return null
  return Object.values(SWAP_NETWORKS).find(c => c.chainId === chainId && c.signing === 'evm-eoa') ?? null
}

/** Why a chain cannot be swapped, phrased for a user. Null when it can. */
export function swapUnavailableReason(chainId: string): string | null {
  const cap = SWAP_NETWORKS[chainId]
  if (!cap) {
    return 'Swaps are not enabled for this network yet. It works everywhere else in the wallet.'
  }
  if (cap.status === 'blocked') return cap.reason
  if (cap.sameChain.length === 0 && cap.crossChainSource.length === 0) {
    return cap.reason ?? 'No swap provider configured here can spend from this network.'
  }
  return null
}
