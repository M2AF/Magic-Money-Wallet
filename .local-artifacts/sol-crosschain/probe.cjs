var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/api-proxy.ts
function proxyBase(config) {
  const b = (config.swapProxyUrl || "").trim().replace(/\/+$/, "");
  return b || null;
}
function proxyHeaders(config, headers = {}) {
  const token = (config.clientToken || "").trim();
  return token ? { ...headers, "x-mm-client": token } : headers;
}
function proxyUrl(url, config) {
  const token = (config.clientToken || "").trim();
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set("mm_client", token);
  return u.toString();
}
function alchemyRpcUrl(network, config) {
  const base2 = proxyBase(config);
  return base2 ? proxyUrl(`${base2}/rpc/alchemy/${network}`, config) : `https://${network}.g.alchemy.com/v2/${config.alchemyKey}`;
}
function tronApiUrl(path, config) {
  const base2 = proxyBase(config);
  const p = path.replace(/^\/+/, "");
  return base2 ? proxyUrl(`${base2}/rpc/alchemy-tron/${p}`, config) : `https://tron-mainnet.g.alchemy.com/v2/${config.alchemyKey}/${p}`;
}
function heliusRpcUrl(config) {
  const base2 = proxyBase(config);
  return base2 ? proxyUrl(`${base2}/rpc/helius`, config) : `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`;
}
function blockfrostFetch(path, config, timeoutMs = 1e4, init) {
  const base2 = proxyBase(config);
  const url = base2 ? proxyUrl(`${base2}/blockfrost/${path}`, config) : `https://cardano-mainnet.blockfrost.io/api/v0/${path}`;
  const headers = { ...init?.headers };
  if (base2) Object.assign(headers, proxyHeaders(config));
  else headers["project_id"] = config.blockfrostKey;
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

// src/shared/swap-token-identity.ts
var EVM_SWAP_CHAINS = /* @__PURE__ */ new Set([
  "ethereum",
  "arbitrum",
  "optimism",
  "base",
  "polygon",
  "avalanche",
  "bsc",
  "monad",
  "blast",
  "gnosis",
  "abstract",
  "apechain",
  "robinhood",
  "arc",
  "ronin",
  "soneium",
  "worldchain",
  "zora",
  "hyperevm"
]);
function isEvmSwapChain(chain) {
  return EVM_SWAP_CHAINS.has((chain ?? "").trim().toLowerCase());
}
var NATIVE_EVM_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var SOL_NATIVE_MINT = "So11111111111111111111111111111111111111112";
var CARDANO_LOVELACE = "lovelace";
var CARDANO_USDCX_UNIT = {
  mainnet: "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
  preprod: "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf665553444378"
};
var EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
var BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
var CARDANO_UNIT_RE = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;
function isNativeSwapAddress(chain, address2) {
  const raw = (address2 ?? "").trim();
  if (!raw) return false;
  if (isEvmSwapChain(chain)) {
    const lower = raw.toLowerCase();
    return lower === NATIVE_EVM_SENTINEL || lower === EVM_ZERO_ADDRESS;
  }
  if (isSolanaSwapChain(chain)) {
    return raw === SOL_NATIVE_MINT || raw === "11111111111111111111111111111111";
  }
  if (isCardanoSwapChain(chain)) return raw.toLowerCase() === CARDANO_LOVELACE;
  return false;
}
function isSolanaSwapChain(chain) {
  return (chain ?? "").trim().toLowerCase() === "solana";
}
function isCardanoSwapChain(chain) {
  return (chain ?? "").trim().toLowerCase() === "cardano";
}
function splitCardanoUnit(unit2) {
  const raw = (unit2 ?? "").trim().toLowerCase();
  if (!CARDANO_UNIT_RE.test(raw)) return null;
  return { policyId: raw.slice(0, 56), assetNameHex: raw.slice(56) };
}
function normalizeSwapAddress(chain, address2) {
  const raw = (address2 ?? "").trim();
  if (!raw) return "";
  if (isEvmSwapChain(chain)) {
    return isNativeSwapAddress(chain, raw) ? NATIVE_EVM_SENTINEL : raw.toLowerCase();
  }
  if (isSolanaSwapChain(chain)) {
    return isNativeSwapAddress(chain, raw) ? SOL_NATIVE_MINT : raw;
  }
  if (isCardanoSwapChain(chain)) return raw.toLowerCase();
  return raw;
}
function swapAssetKey(chain, address2) {
  const c = (chain ?? "").trim().toLowerCase();
  return `${c}:${normalizeSwapAddress(c, address2)}`;
}
function base58ByteLength(value) {
  if (!value || !BASE58_RE.test(value)) return -1;
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [];
  for (const char of value) {
    let carry = ALPHABET.indexOf(char);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  for (const char of value) {
    if (char !== "1") break;
    leadingZeros++;
  }
  return bytes.length + leadingZeros;
}
function isValidSwapAddress(chain, address2) {
  const raw = (address2 ?? "").trim();
  if (!raw) return false;
  if (isEvmSwapChain(chain)) return EVM_ADDRESS_RE.test(raw);
  if (isSolanaSwapChain(chain)) return base58ByteLength(raw) === 32;
  if (isCardanoSwapChain(chain)) {
    return raw.toLowerCase() === CARDANO_LOVELACE || splitCardanoUnit(raw) != null;
  }
  return false;
}

// src/shared/swap-curated-tokens.ts
var NATIVE_EVM_SENTINEL2 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var t = (chain, symbol, name, address2, decimals, isNative = false) => ({ chain, symbol, name, address: address2, decimals, isNative });
var CURATED_SWAP_TOKENS = [
  // ── Ethereum ──
  t("ethereum", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("ethereum", "USDC", "USD Coin", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
  t("ethereum", "USDT", "Tether USD", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
  t("ethereum", "DAI", "Dai", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
  t("ethereum", "WETH", "Wrapped Ether", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
  // ── Arbitrum ──
  t("arbitrum", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("arbitrum", "USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
  t("arbitrum", "USDT", "Tether USD", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
  t("arbitrum", "ARB", "Arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18),
  // ── Optimism ──
  t("optimism", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("optimism", "USDC", "USD Coin", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6),
  t("optimism", "OP", "Optimism", "0x4200000000000000000000000000000000000042", 18),
  // ── Base ──
  t("base", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("base", "USDC", "USD Coin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  // ── Polygon ──
  t("polygon", "POL", "Polygon", NATIVE_EVM_SENTINEL2, 18, true),
  t("polygon", "USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
  t("polygon", "USDT", "Tether USD", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
  t("polygon", "WETH", "Wrapped Ether", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18),
  // ── Avalanche ──
  t("avalanche", "AVAX", "Avalanche", NATIVE_EVM_SENTINEL2, 18, true),
  t("avalanche", "USDC", "USD Coin", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6),
  t("avalanche", "USDT", "Tether USD", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6),
  // ── BNB Chain ──
  t("bsc", "BNB", "BNB", NATIVE_EVM_SENTINEL2, 18, true),
  t("bsc", "USDT", "Tether USD", "0x55d398326f99059fF775485246999027B3197955", 18),
  t("bsc", "USDC", "USD Coin", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
  // ── Solana ──
  t("solana", "SOL", "Solana", "So11111111111111111111111111111111111111112", 9, true),
  t("solana", "USDC", "USD Coin", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6),
  t("solana", "USDT", "Tether USD", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6),
  // ── Monad ──
  t("monad", "MON", "Monad", NATIVE_EVM_SENTINEL2, 18, true),
  // ── Robinhood Chain ──
  // Robinhood Chain uses ETH for gas and as its native asset. Keep this in the
  // local fallback list so the native pair is available even when /tokens is
  // unavailable or the live catalogue does not return the native sentinel.
  t("robinhood", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  // ── Other supported EVM networks ──
  t("blast", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("gnosis", "XDAI", "Gnosis", NATIVE_EVM_SENTINEL2, 18, true),
  t("abstract", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("apechain", "APE", "ApeCoin", NATIVE_EVM_SENTINEL2, 18, true),
  t("ronin", "RON", "Ronin", NATIVE_EVM_SENTINEL2, 18, true),
  t("soneium", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("worldchain", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("zora", "ETH", "Ethereum", NATIVE_EVM_SENTINEL2, 18, true),
  t("hyperevm", "HYPE", "Hyperliquid", NATIVE_EVM_SENTINEL2, 18, true),
  // ── Cardano (same-chain via Minswap V2 orders; full asset units) ──
  t("cardano", "ADA", "Cardano", "lovelace", 6, true),
  t("cardano", "MIN", "Minswap", "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e", 6),
  // Circle's USDCx: unit from Circle's xReserve domain reference; 6 decimals per
  // the Cardano token registry (as read by token-fetcher) and Minswap's index.
  // Assets named "USDCx" under other policies exist and are NOT this token.
  t("cardano", "USDCx", "USDCx (Circle)", CARDANO_USDCX_UNIT.mainnet, 6),
  // ── Bitcoin / Polkadot (exchange flow only) ──
  t("bitcoin", "BTC", "Bitcoin", "bitcoin", 8, true),
  t("polkadot", "DOT", "Polkadot", "polkadot", 10, true)
];
var CURATED_KEYS = new Set(CURATED_SWAP_TOKENS.map((t2) => swapAssetKey(t2.chain, t2.address)));
function isCuratedSwapToken(chain, address2) {
  return CURATED_KEYS.has(swapAssetKey(chain, address2));
}

// src/shared/swap-networks.ts
var SWAP_NETWORKS = {
  ethereum: {
    id: "ethereum",
    chainId: 1,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "uniswap", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain ETH->USDT via okx at ~$50, signable calldata"
  },
  arbitrum: {
    id: "arbitrum",
    chainId: 42161,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "uniswap", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain ETH->USDC via nordstern; out to ethereum via relaydepository; in via arbitrum bridge. All at ~$50."
  },
  optimism: {
    id: "optimism",
    chainId: 10,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "uniswap", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain via 1inch; out via relaydepository; in via across"
  },
  base: {
    id: "base",
    chainId: 8453,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "uniswap", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured same-chain ETH->USDC and cross-chain both directions"
  },
  polygon: {
    id: "polygon",
    chainId: 137,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "uniswap", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain POL->USDC via kyberswap; out to ethereum via across at ~$50 (a 0.01-POL probe had falsely reported no route)"
  },
  avalanche: {
    id: "avalanche",
    chainId: 43114,
    signing: "evm-eoa",
    sameChain: ["0x", "1inch", "lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain AVAX->USDt via okx; out via layerswap at ~$50; in via layerswap"
  },
  monad: {
    id: "monad",
    chainId: 143,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: same-chain MON->USDC via kyberswap; out to ethereum via polymerStandard at ~$50; in via mayanFastMCTP. Relay also quotes EMO(143)->PIXL(1)."
  },
  // ── Newly covered. All three were in the Networks tab with no swap support. ──
  robinhood: {
    id: "robinhood",
    chainId: 4663,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: 457 LI.FI tokens; same-chain ETH->cbBTC via nordstern; x-chain out via across, in via layerswap; 1% integrator fee applied on both"
  },
  arc: {
    id: "arc",
    chainId: 5042,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    // Arc's gas asset is USDC, and it has TWO representations that must not be
    // mixed: the protocol carries balances and gas in 18-decimal wei units like
    // any EVM chain (gasPrice measured at ~20.7 gwei, which would be 435M USDC
    // if the native unit were 6 decimals), while LI.FI swaps it as a SIX-decimal
    // ERC-20 mirror at 0x3600...0000. Reading the mirror's decimals as the gas
    // reserve would be wrong by 1e12. LI.FI also normalizes the zero address to
    // that mirror and quotes value=0x0, so selling it is an approval flow, not a
    // native-value flow -- which the executor already handles, because the mirror
    // address is not the native sentinel.
    evidence: "measured 2026-09-20: LI.FI reports native USDC dec=6 at 0x3600...0000 while eth_gasPrice implies 18-decimal protocol units; x-chain out via lifiIntents, in via across"
  },
  abstract: {
    id: "abstract",
    chainId: 2741,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    // NOTE: this covers the account's EOA only. The Abstract Global Wallet is a
    // SMART ACCOUNT with its own balance, and the EOA cannot spend it — see
    // `abstract-agw` below.
    evidence: "measured 2026-09-20: chain id 2741 confirmed by RPC; same-chain ETH->USDC.e via fly; out via relaydepository; in via stargateV2Bus. EOA source only. Note ETH->PENGU returns NO quote on the same chain -- pair availability is not chain availability. 14 tokens listed."
  },
  "abstract-agw": {
    id: "abstract-agw",
    chainId: 2741,
    signing: "smart-account",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Swaps from the Abstract Global Wallet are not enabled. The smart account holds its own balance, which the signing key for your regular Abstract address cannot spend \u2014 a swap quoted against one and signed by the other would fail or move the wrong funds. Swap from your Abstract address instead, or move funds out of the smart wallet first.",
    evidence: "AGW is an ERC-4337-style smart account; the swap executor signs EOA transactions only"
  },
  worldchain: {
    id: "worldchain",
    chainId: 480,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: chain id 480 confirmed by RPC; native is ETH (registry said WLD); same-chain ETH->USDC via lifidexaggregator; x-chain both directions"
  },
  soneium: {
    id: "soneium",
    chainId: 1868,
    signing: "evm-eoa",
    sameChain: [],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: x-chain out via layerswap, in via across. No same-chain pair quoted in probing; same-chain remains provider-dependent."
  },
  blast: {
    id: "blast",
    chainId: 81457,
    signing: "evm-eoa",
    sameChain: [],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: x-chain out via squid, in via layerswap"
  },
  gnosis: {
    id: "gnosis",
    chainId: 100,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi", "relay"],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured 2026-09-20: 724 LI.FI tokens; same-chain xDAI->USDC via sushiswap; x-chain out via stargateV2Bus, in via gasZipBridge"
  },
  apechain: {
    id: "apechain",
    chainId: 33139,
    signing: "evm-eoa",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: "Swapping OUT of ApeChain has no route through the providers configured here. Bridging IN to ApeChain works. Only 7 tokens are listed for this chain.",
    evidence: 'measured 2026-09-20: x-chain IN via relaydepository; x-chain OUT returned HTTP 404 "No available quotes"; no same-chain pair found'
  },
  ronin: {
    id: "ronin",
    chainId: 2020,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: [],
    crossChainDestination: ["lifi", "relay"],
    discovery: true,
    status: "verified",
    reason: "Same-chain swaps on Ronin work. Swapping OUT to another chain has no route through the providers configured here; bridging IN works.",
    evidence: "measured 2026-09-20: same-chain RON->USDC via kyberswap; x-chain IN via relaydepository; x-chain OUT returned HTTP 404"
  },
  zora: {
    id: "zora",
    chainId: 7777777,
    signing: "evm-eoa",
    sameChain: [],
    crossChainSource: ["relay"],
    crossChainDestination: ["relay"],
    discovery: true,
    status: "implemented-unverified",
    reason: null,
    evidence: "measured 2026-09-20: chain id 7777777 confirmed by RPC. LI.FI does NOT list Zora; Relay does. Routed through Relay only, no live pair quoted here."
  },
  hyperevm: {
    id: "hyperevm",
    chainId: 999,
    signing: "evm-eoa",
    sameChain: ["lifi"],
    crossChainSource: ["lifi"],
    crossChainDestination: ["lifi"],
    discovery: true,
    status: "verified",
    reason: null,
    // This chain was previously recorded as blocked "because neither aggregator
    // routes it". That was an artefact of the registry carrying 998 -- the
    // TESTNET id -- for mainnet. Under its real id every route quotes, so the
    // identity fix is what unblocked it. A swap signed for 998 would have been
    // rejected by the network anyway.
    evidence: "measured 2026-09-20: rpc.hyperliquid.xyz/evm reports 0x3e7 (999); registry carried 998, which is HyperEVM TESTNET. 6891 LI.FI tokens listed; same-chain HYPE->USD\u20AE0 via enso and via fly; out to ethereum and in from ethereum both via relaydepository, all signable."
  },
  solana: {
    id: "solana",
    chainId: null,
    signing: "solana",
    sameChain: ["jupiter", "lifi"],
    crossChainSource: ["lifi"],
    crossChainDestination: ["lifi"],
    discovery: true,
    status: "verified",
    reason: null,
    evidence: "measured: Jupiter same-chain with verified platform fee; LI.FI cross-chain"
  },
  // ── Present in the Networks tab, deliberately not swappable ────────────────
  bitcoin: {
    id: "bitcoin",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "DEX swaps need a transaction this wallet signs locally, and Bitcoin spending uses PSBT signing the swap executor does not have. Use the Cross-Chain tab for BTC.",
    evidence: "executor has no PSBT path for swap payloads"
  },
  // Same-chain only, through Minswap V2 batcher orders. NOT 'verified': every
  // piece below was measured live, but no swap has yet been executed with real
  // funds from this wallet (docs/RELEASE-QA.md). Cross-chain in or out needs the
  // xReserve leg, which is not enabled (docs/CARDANO-SWAP-DISCOVERY.md).
  cardano: {
    id: "cardano",
    chainId: null,
    signing: "cardano",
    sameChain: ["minswap"],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: true,
    status: "implemented-unverified",
    reason: null,
    evidence: "measured 2026-09-26, agg-api.minswap.org (keyless): exact-unit search; estimate + unsigned build-tx for USDCx->SNEK (2-hop via NIGHT), ADA->USDCx (1-hop and 2-hop) as Minswap V2 orders; order script c3e28c36... matches the published minswap-dex-v2 README; every recorded build passes the pre-signing validator. Not yet executed with real funds."
  },
  polkadot: {
    id: "polkadot",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Polkadot needs Substrate extrinsic signing, which the swap executor does not have. Use the Cross-Chain tab for DOT.",
    evidence: "no Substrate signing in the swap executor"
  },
  tron: {
    id: "tron",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Tron swaps are not enabled. Tron transactions are not EVM transactions and the swap executor cannot sign them.",
    evidence: "Tron uses its own transaction format; no adapter wired"
  },
  dogecoin: {
    id: "dogecoin",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Dogecoin swaps are not enabled. UTXO spending needs PSBT-style signing the swap executor does not have. Use the Cross-Chain tab for DOGE.",
    evidence: "UTXO chain, no swap signing path"
  },
  monero: {
    id: "monero",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Monero swaps are not available in Swap. Routing XMR through a DEX aggregator would defeat Privacy Mode.",
    evidence: "privacy chain; deliberately excluded"
  },
  zcash: {
    id: "zcash",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Zcash swaps are not available in Swap.",
    evidence: "privacy chain; deliberately excluded"
  },
  midnight: {
    id: "midnight",
    chainId: null,
    signing: "other",
    sameChain: [],
    crossChainSource: [],
    crossChainDestination: [],
    discovery: false,
    status: "blocked",
    reason: "Midnight swaps are not available in Swap.",
    evidence: "privacy chain; deliberately excluded"
  }
};
function swapCapability(chainId) {
  return SWAP_NETWORKS[chainId] ?? null;
}

// src/shared/swap-fee-policy.ts
var SWAP_FEE_POLICY_VERSION = "2026-09-19.app-100bps-preferred";
var APP_FEE_BPS = 100;
var MAX_APP_FEE_BPS = 150;
var SWAP_FEE_BENEFICIARIES = {
  evm: "0x01faF6DFc230d755141D84d7cB980dd68f5Efe13",
  lifiIntegrator: "ChainLens",
  solanaReferralAccount: "9vBwkLqEcNs6LKv8Szyrt4P9h82SBWaD3hbiDZ1A3hUy",
  solanaWallet: "3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d",
  cardano: "addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h",
  bitcoin: "bc1qt6cx7977r8xttn5rg42d2ulnlc7agspycd600w",
  polkadot: "1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS"
};
function feeRecipientForChain(chain) {
  switch ((chain || "").toLowerCase()) {
    case "solana":
      return SWAP_FEE_BENEFICIARIES.solanaWallet;
    case "cardano":
      return SWAP_FEE_BENEFICIARIES.cardano;
    case "bitcoin":
      return SWAP_FEE_BENEFICIARIES.bitcoin;
    case "polkadot":
      return SWAP_FEE_BENEFICIARIES.polkadot;
    default:
      return SWAP_FEE_BENEFICIARIES.evm;
  }
}
var SWAP_FEE_PROVIDERS = {
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
    bases: ["input"],
    collection: "in-swap",
    recipientKind: "provider-intent",
    maxVerification: "applied-verified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "measured live 2026-09-20: fees.app.amount ~= 100 bps of input; recipient absent from the 8330-char deposit calldata and not echoed in the quote \u2014 confirmable only after settlement via data.paidAppFees[]"
  },
  // MEASURED 19 Sep 2026, keyless li.quest/v1/quote: fee=0.01 + integrator=ChainLens
  // returns estimate.feeCosts[].feeSplit = { lifiFee, integratorFee, recipients:
  // [{name:'lifi'},{name:'ChainLens', fee:'1000000000000000'}] } on a 0.1 ETH input,
  // i.e. exactly 100 bps of the INPUT, and `included: true` (already in toAmount).
  // An unregistered integrator is REFUSED with HTTP 400 rather than silently
  // dropping the fee, which is what makes this verifiable at all.
  lifi: {
    bases: ["input"],
    collection: "in-swap",
    recipientKind: "registered-integrator",
    maxVerification: "applied-verified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    // commercial terms — not established here
    evidence: "measured live 2026-09-19: feeSplit.recipients names the integrator and states the amount"
  },
  // MEASURED 19 Sep 2026, keyless lite-api.jup.ag/swap/v1: platformFeeBps=100 returns
  // quote.platformFee = { amount, feeBps:100 } where amount === floor(grossOut * 1%),
  // and outAmount is already NET of it. /swap REFUSES to build without a feeAccount
  // once the quote carries a platformFee, and the account we pass appears in the
  // transaction's static account keys — but Jupiter does NOT check that the account
  // exists or matches the fee mint, so the wallet validates that itself.
  jupiter: {
    bases: ["output"],
    collection: "in-swap",
    recipientKind: "referral-token-account",
    maxVerification: "applied-verified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "measured live 2026-09-19: quote.platformFee states amount+bps; feeAccount is bound into the transaction"
  },
  // 0x Swap API v2 (allowance-holder) documents `fees.integratorFee: {amount, token, type}`
  // echoing the applied fee, taken in an ERC-20 (never native), and `buyAmount` net of
  // it when the fee token is the buy token. NOT exercised here — no key in this
  // environment — so the adapter falls back to tier 2 if the field is absent.
  "0x": {
    bases: ["output", "input"],
    collection: "in-swap",
    recipientKind: "onchain-address",
    maxVerification: "applied-verified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "per 0x Swap API v2 monetization docs; response schema not exercised (no key here)"
  },
  // Uniswap Trading API: the integrator portion must be enabled by Uniswap Labs on the
  // API key, and the response states `portionBips`/`portionAmount`/`portionRecipient`.
  // Their docs are explicit that an EXACT_INPUT quote's output does NOT already have
  // the portion removed, so the adapter subtracts it exactly once.
  uniswap: {
    bases: ["output"],
    collection: "in-swap",
    recipientKind: "onchain-address",
    maxVerification: "applied-verified",
    quotedOutputIsNetOfAppFee: false,
    providerSharePct: null,
    evidence: "per Uniswap aggregator quote reference; requires key-side fee enablement, not exercised here"
  },
  // 1inch Classic v6 /swap accepts `fee` + `referrer` and encodes the referrer into the
  // calldata, but the response states NO applied fee amount. That is enough to know
  // WHERE a fee would go and not HOW MUCH, so 1inch cannot reach tier 1 — and is
  // therefore quoted fee-free, rather than charging a user 1% we could never account
  // for. It remains fully eligible to execute swaps.
  "1inch": {
    bases: ["input"],
    collection: "in-swap",
    recipientKind: "onchain-address",
    maxVerification: "payload-bound",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "v6 /swap returns no fee field; referrer is only observable inside calldata"
  },
  // Rango Basic accepts referrerAddress + referrerFee (percent). Its response does not
  // state an applied fee amount we can reconcile, and its docs restrict fee
  // availability by chain. Tier 2, quoted fee-free.
  rango: {
    bases: ["input"],
    collection: "in-swap",
    recipientKind: "onchain-address",
    maxVerification: "requested-unverified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "Rango Basic monetization docs; no applied-fee echo to reconcile, chain eligibility varies"
  },
  // SwapKit v3 takes `affiliateFee` in bps with the beneficiaries configured against the
  // API key in their Partner Dashboard. Without that dashboard state we cannot tell a
  // configured affiliate from an ignored one. Tier 2, quoted fee-free.
  swapkit: {
    bases: ["input"],
    collection: "in-swap",
    recipientKind: "registered-integrator",
    maxVerification: "requested-unverified",
    quotedOutputIsNetOfAppFee: true,
    providerSharePct: null,
    evidence: "SwapKit v3 quote reference; affiliate beneficiaries live in the partner dashboard, unverified here"
  }
};
function providerCanVerifyAppFee(provider) {
  return SWAP_FEE_PROVIDERS[provider]?.maxVerification === "applied-verified";
}
function feeAmountForBps(amountRaw, bps) {
  if (!/^[0-9]+$/.test(amountRaw || "")) return null;
  if (!Number.isInteger(bps) || bps < 0 || bps > 1e4) return null;
  try {
    return (BigInt(amountRaw) * BigInt(bps) / 10000n).toString();
  } catch {
    return null;
  }
}
function feeAmountMatches(reportedRaw, baseAmountRaw, bps, toleranceUnits = 2n) {
  if (!reportedRaw || !/^[0-9]+$/.test(reportedRaw)) return false;
  const expected = feeAmountForBps(baseAmountRaw, bps);
  if (expected == null) return false;
  try {
    const diff = BigInt(reportedRaw) - BigInt(expected);
    return (diff < 0n ? -diff : diff) <= toleranceUnits;
  } catch {
    return false;
  }
}
function effectiveBps(amountRaw, baseAmountRaw) {
  if (!amountRaw || !baseAmountRaw) return null;
  if (!/^[0-9]+$/.test(amountRaw) || !/^[0-9]+$/.test(baseAmountRaw)) return null;
  try {
    const base2 = BigInt(baseAmountRaw);
    if (base2 <= 0n) return null;
    return Number(BigInt(amountRaw) * 10000n / base2);
  } catch {
    return null;
  }
}
function classifyFeeStatus(record) {
  if (!record) return "unknown";
  if (record.requestedBps === 0) {
    return record.verification === "none-requested" && (record.amountRaw === "0" || record.amountRaw == null) && (record.appliedBps === 0 || record.appliedBps == null) ? "confirmed-none" : "unknown";
  }
  if (record.verification !== "applied-verified") return "unknown";
  if (!record.amountRaw || !/^[0-9]+$/.test(record.amountRaw)) return "unknown";
  try {
    if (BigInt(record.amountRaw) <= 0n) return "unknown";
  } catch {
    return "unknown";
  }
  return "verified";
}
function qualifiesAsFeePaying(record, expected) {
  const no = (reason) => ({ ok: false, reason });
  if (!record) return no("no fee record");
  if (record.policyVersion !== expected.policyVersion) return no("priced under a different fee policy");
  if (record.provider !== expected.provider) return no("fee terms belong to another route");
  if (record.requestedBps === 0) return no("quoted deliberately fee-free");
  if (record.requestedBps !== expected.bps) {
    return no(`quoted at ${(record.requestedBps / 100).toFixed(2)}% rather than ${(expected.bps / 100).toFixed(2)}%`);
  }
  if (!providerCanVerifyAppFee(record.provider)) return no(`${record.provider} cannot verify an applied fee`);
  if (classifyFeeStatus(record) !== "verified") return no(`${record.provider} did not confirm it applied the fee`);
  if (record.appliedBps !== expected.bps) {
    return no(`${record.provider} applied ${(record.appliedBps ?? 0) / 100}% rather than ${expected.bps / 100}%`);
  }
  if (!record.recipient) return no("no configured fee recipient");
  if (!recipientMatchesPolicy(record)) return no("fee recipient is not the configured Magic Money recipient");
  if (expected.baseAmountRaw && !feeAmountMatches(record.amountRaw, expected.baseAmountRaw, expected.bps)) {
    return no("reported fee amount does not reconcile to the policy rate");
  }
  return { ok: true, reason: null };
}
function checkAppFeeIntegrity(record, expected) {
  if (!record) return { ok: true, reason: null };
  if (record.policyVersion !== expected.policyVersion) {
    return { ok: false, reason: "This quote was priced under a different fee policy \u2014 refresh the quote to see current terms." };
  }
  if (record.provider !== expected.provider) {
    return { ok: false, reason: "The fee terms do not belong to this route \u2014 refresh the quote." };
  }
  if (record.requestedBps < 0 || record.requestedBps > MAX_APP_FEE_BPS) {
    return { ok: false, reason: "This quote carries a fee rate outside the allowed range \u2014 refresh the quote." };
  }
  if (record.requestedBps > 0 && record.requestedBps !== expected.bps) {
    return {
      ok: false,
      reason: `This route was quoted at a ${(record.requestedBps / 100).toFixed(2)}% app fee rather than the current ${(expected.bps / 100).toFixed(2)}% \u2014 refresh the quote.`
    };
  }
  if (record.requestedBps > 0 && record.recipient && !recipientMatchesPolicy(record)) {
    return { ok: false, reason: "This route would pay the app fee to an address that is not the configured Magic Money recipient." };
  }
  return { ok: true, reason: null };
}
function recipientMatchesPolicy(record) {
  const r = record.recipient ?? "";
  if (record.recipientKind === "none") return !r;
  if (!r) return false;
  if (record.recipientKind === "registered-integrator") {
    return r === SWAP_FEE_BENEFICIARIES.lifiIntegrator;
  }
  if (record.recipientKind === "referral-token-account") {
    return !!record.tokenAddress && r.length >= 32 && !r.startsWith("0x");
  }
  const expected = feeRecipientForChain(record.chain);
  if (/^0x[0-9a-fA-F]{40}$/.test(expected)) return r.toLowerCase() === expected.toLowerCase();
  return r === expected;
}
function feeFreeRecord(provider, chain, why) {
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider,
    requestedBps: 0,
    appliedBps: 0,
    base: "input",
    chain,
    tokenAddress: null,
    tokenSymbol: null,
    tokenDecimals: null,
    amountRaw: "0",
    recipient: null,
    recipientKind: "none",
    collection: "in-swap",
    providerSharePct: null,
    verification: "none-requested",
    evidence: [why]
  };
}

// src/shared/solana-transaction.ts
var B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
function base64ToBytes(b64) {
  const clean = b64.replace(/[\s=]+/g, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error("Invalid base64.");
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0;
  let acc = 0;
  let i = 0;
  for (const ch of clean) {
    acc = acc << 6 | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = acc >> bits & 255;
    }
  }
  return out.subarray(0, i);
}
var Reader = class {
  constructor(bytes) {
    this.bytes = bytes;
  }
  pos = 0;
  u8() {
    if (this.pos >= this.bytes.length) throw new Error("Solana transaction is truncated.");
    return this.bytes[this.pos++];
  }
  take(n) {
    if (this.pos + n > this.bytes.length) throw new Error("Solana transaction is truncated.");
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** Solana's compact-u16 ("shortvec"): up to three 7-bit groups. */
  shortvec() {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const b = this.u8();
      value |= (b & 127) << shift;
      if ((b & 128) === 0) return value;
    }
    throw new Error("Solana transaction has an invalid length prefix.");
  }
  peek() {
    if (this.pos >= this.bytes.length) throw new Error("Solana transaction is truncated.");
    return this.bytes[this.pos];
  }
};
function parseSolanaTransaction(input) {
  const bytes = typeof input === "string" ? base64ToBytes(input) : input;
  const r = new Reader(bytes);
  const signatureCount = r.shortvec();
  r.take(64 * signatureCount);
  let version = "legacy";
  const prefix = r.peek();
  if (prefix & 128) {
    r.u8();
    const v = prefix & 127;
    if (v !== 0) throw new Error(`Unsupported Solana transaction version ${v}.`);
    version = 0;
  }
  const header = {
    numRequiredSignatures: r.u8(),
    numReadonlySignedAccounts: r.u8(),
    numReadonlyUnsignedAccounts: r.u8()
  };
  const keyCount = r.shortvec();
  const staticAccountKeys = [];
  for (let i = 0; i < keyCount; i++) staticAccountKeys.push(base58Encode(r.take(32)));
  const recentBlockhash = base58Encode(r.take(32));
  const instructions = [];
  const instructionCount = r.shortvec();
  for (let i = 0; i < instructionCount; i++) {
    const programIdIndex = r.u8();
    const accountIndexes = Array.from(r.take(r.shortvec()));
    const data = r.take(r.shortvec());
    instructions.push({ programIdIndex, accountIndexes, data });
  }
  const addressTableLookups = [];
  if (version === 0) {
    const lookupCount = r.shortvec();
    for (let i = 0; i < lookupCount; i++) {
      const accountKey = base58Encode(r.take(32));
      const writableIndexes = Array.from(r.take(r.shortvec()));
      const readonlyIndexes = Array.from(r.take(r.shortvec()));
      addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
    }
  }
  if (signatureCount !== header.numRequiredSignatures) {
    throw new Error("Solana transaction signature count does not match its required signers.");
  }
  return { version, signatureCount, header, staticAccountKeys, recentBlockhash, instructions, addressTableLookups };
}

// src/shared/swap-fee-checks.ts
function feeBaseAmountRaw(quote) {
  const record = quote.appFee;
  if (!record) return null;
  if (record.base === "input") return quote.sellAmountRaw ?? null;
  const net = quote.buyAmountRaw;
  const fee = record.amountRaw;
  if (!net || !/^[0-9]+$/.test(net)) return null;
  if (!fee || !/^[0-9]+$/.test(fee)) return null;
  try {
    return (BigInt(net) + BigInt(fee)).toString();
  } catch {
    return null;
  }
}
function expectedTerms(quote) {
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    bps: APP_FEE_BPS,
    provider: quote.provider,
    chain: quote.fromChain,
    baseAmountRaw: feeBaseAmountRaw(quote)
  };
}
function checkQuoteAppFee(quote) {
  return qualifiesAsFeePaying(quote.appFee, expectedTerms(quote));
}
function quoteFeeStatus(quote) {
  return classifyFeeStatus(quote.appFee);
}
function checkFeeBoundInPayload(quote) {
  const record = quote.appFee;
  if (!record) return { ok: false, reason: "This route reported no fee terms to verify." };
  if (record.recipientKind === "none" || record.requestedBps === 0) {
    return { ok: true, reason: null };
  }
  if (record.recipientKind === "registered-integrator") {
    return { ok: true, reason: null };
  }
  if (record.recipientKind === "provider-intent") {
    if (!quote.requestId) {
      return {
        ok: false,
        reason: "This route carries a fee but no request id, so whether the fee reached Magic Money could never be checked. Another route will be tried."
      };
    }
    return { ok: true, reason: null };
  }
  if (record.recipientKind === "referral-token-account") {
    const serialized = quote.txData?.swapTransaction;
    if (!serialized) return { ok: false, reason: "Solana route carried no transaction to verify the fee against." };
    if (!record.recipient) return { ok: false, reason: "Solana route named no fee account." };
    try {
      const keys = parseSolanaTransaction(serialized).staticAccountKeys;
      if (!keys.includes(record.recipient)) {
        return {
          ok: false,
          reason: "The Solana transaction does not include the Magic Money fee account, so this route would not pay the disclosed fee. Another route will be tried."
        };
      }
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: "The Solana transaction could not be decoded to verify the fee account." };
    }
  }
  const calldata = quote.txData?.data;
  if (!calldata || !record.recipient) {
    return { ok: false, reason: "This route carried no calldata to verify the fee recipient against." };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(record.recipient)) {
    return { ok: false, reason: "This route named an invalid fee recipient." };
  }
  const found = calldata.toLowerCase().includes(record.recipient.slice(2).toLowerCase());
  return found ? { ok: true, reason: null } : {
    ok: false,
    reason: "The swap transaction does not reference the Magic Money fee recipient, so this route would not pay the disclosed fee. Another route will be tried."
  };
}
function classifyQuoteFee(quote) {
  const status = quoteFeeStatus(quote);
  const terms = checkQuoteAppFee(quote);
  if (!terms.ok) return { tier: "fee-free", status, reason: terms.reason };
  const bound = checkFeeBoundInPayload(quote);
  if (!bound.ok) return { tier: "fee-free", status: "unknown", reason: bound.reason };
  return { tier: "fee-paying", status: "verified", reason: null };
}
function checkQuoteFeeIntegrity(quote) {
  const integrity = checkAppFeeIntegrity(quote.appFee, expectedTerms(quote));
  if (!integrity.ok) return integrity;
  const record = quote.appFee;
  if (record && record.requestedBps > 0 && classifyFeeStatus(record) === "verified") {
    const bound = checkFeeBoundInPayload(quote);
    if (!bound.ok) return bound;
  }
  return { ok: true, reason: null };
}

// src/shared/swap-policy-checks.ts
function classifySwapTier(quote) {
  const sellCurated = isCuratedSwapToken(quote.fromChain, quote.fromTokenAddress);
  const buyCurated = isCuratedSwapToken(quote.toChain, quote.toTokenAddress);
  return sellCurated && buyCurated ? "curated" : "broad";
}
var MIN_ENFORCEABLE_PROVIDERS = /* @__PURE__ */ new Set(["jupiter", "lifi", "0x", "relay", "minswap"]);
var LIFECYCLE_VERIFIED_PROVIDERS = /* @__PURE__ */ new Set(["lifi", "relay"]);
var settlementTrackingActive = false;
function setSettlementTrackingActive(active) {
  settlementTrackingActive = active;
}
function checkBroadCrossChain(quote) {
  const enforceable = checkEnforceableMinimum(quote);
  if (!enforceable.ok) return enforceable;
  if (!LIFECYCLE_VERIFIED_PROVIDERS.has(quote.provider)) {
    return {
      ok: false,
      reason: `Cross-chain delivery through ${quote.provider} cannot yet be told apart from a partial delivery or a refund, so this token is not enabled on that route. A different provider may still carry it.`
    };
  }
  const terms = quote.destination;
  if (!terms) {
    return {
      ok: false,
      reason: "This route did not describe what happens if its destination leg fails, so it is not enabled."
    };
  }
  if (terms.minReceivedScope === "destination-conditional") {
    if (!terms.fallback?.tokenAddress) {
      return {
        ok: false,
        reason: "If the final swap on this route failed you would receive a bridged asset the route does not identify. It is not enabled until that asset can be shown to you before signing."
      };
    }
  } else if (terms.minReceivedScope !== "provider-guaranteed") {
    return {
      ok: false,
      reason: "The minimum shown for this cross-chain route is an estimate that nothing enforces, so this token is not enabled on it."
    };
  }
  if (!settlementTrackingActive) {
    return {
      ok: false,
      reason: "Cross-chain tracking is not active on this device, so a partial delivery or a refund could go unreported. This token is not enabled cross-chain here."
    };
  }
  return { ok: true, reason: null };
}
function checkEnforceableMinimum(quote) {
  if (quote.minReceivedSource !== "provider") {
    return {
      ok: false,
      reason: `The ${quote.provider} route did not return its own minimum received, so the figure shown is an estimate rather than a limit the transaction enforces. This token is outside the wallet's verified list, so it is not signed on an estimate.`
    };
  }
  if (!MIN_ENFORCEABLE_PROVIDERS.has(quote.provider)) {
    return {
      ok: false,
      reason: `Minimum-received handling for the ${quote.provider} route has not been verified for tokens outside the wallet's verified list, so this pair is not enabled through it yet.`
    };
  }
  return { ok: true, reason: null };
}
function checkChainCapability(quote) {
  const from = swapCapability(quote.fromChain);
  const to = swapCapability(quote.toChain);
  if (!from) {
    return { ok: false, reason: `Swaps are not enabled on ${quote.fromChain}.` };
  }
  if (!to) {
    return { ok: false, reason: `Swaps cannot deliver to ${quote.toChain}.` };
  }
  const sameChain = quote.fromChain === quote.toChain;
  const canSource = sameChain ? from.sameChain.length > 0 : from.crossChainSource.length > 0;
  if (!canSource) {
    return {
      ok: false,
      reason: from.reason ?? `No configured provider can swap ${sameChain ? "on" : "out of"} ${quote.fromChain}.`
    };
  }
  if (!sameChain && to.crossChainDestination.length === 0) {
    return { ok: false, reason: to.reason ?? `No configured provider can deliver to ${quote.toChain}.` };
  }
  return { ok: true, reason: null };
}
function decideSwapPolicy(quote) {
  const tier = classifySwapTier(quote);
  const isCrossChain = quote.fromChain !== quote.toChain;
  const capable = checkChainCapability(quote);
  if (!capable.ok) {
    return {
      tier,
      isCrossChain,
      allowed: false,
      reason: capable.reason,
      requireSimulation: true,
      requireMinReceived: true
    };
  }
  const feeIntegrity = checkQuoteFeeIntegrity(quote);
  if (!feeIntegrity.ok) {
    return {
      tier,
      isCrossChain,
      allowed: false,
      reason: feeIntegrity.reason,
      requireSimulation: true,
      requireMinReceived: true
    };
  }
  if (tier === "broad" && isCrossChain) {
    const gate = checkBroadCrossChain(quote);
    if (!gate.ok) {
      return {
        tier,
        isCrossChain,
        allowed: false,
        reason: gate.reason,
        requireSimulation: true,
        requireMinReceived: true
      };
    }
  }
  if (tier === "broad") {
    const enforceable = checkEnforceableMinimum(quote);
    if (!enforceable.ok) {
      return {
        tier,
        isCrossChain,
        allowed: false,
        reason: enforceable.reason,
        requireSimulation: true,
        requireMinReceived: true
      };
    }
  }
  return {
    tier,
    isCrossChain,
    allowed: true,
    reason: null,
    requireSimulation: tier === "broad",
    requireMinReceived: tier === "broad"
  };
}
var MIN_RECEIVED_ROUNDING_UNITS = 1n;
function isValidSlippageBps(slippageBps) {
  return typeof slippageBps === "number" && Number.isFinite(slippageBps) && Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps <= 1e4;
}
function checkMinReceived(quote) {
  if (!isValidSlippageBps(quote.slippageBps)) {
    return { ok: false, reason: "Quote has an invalid slippage setting.", shortfallBps: null };
  }
  const min = quote.minBuyAmountRaw;
  if (min == null || !/^[0-9]+$/.test(min)) {
    return { ok: false, reason: "Quote is missing a minimum received amount.", shortfallBps: null };
  }
  if (!/^[0-9]+$/.test(quote.buyAmountRaw)) {
    return { ok: false, reason: "Quote amounts are not valid integers.", shortfallBps: null };
  }
  const minV = BigInt(min);
  const buyV = BigInt(quote.buyAmountRaw);
  if (buyV <= 0n) return { ok: false, reason: "Quote has no output amount.", shortfallBps: null };
  if (minV <= 0n) {
    return { ok: false, reason: "Quote sets no minimum received \u2014 the swap would have no slippage protection.", shortfallBps: null };
  }
  if (minV > buyV) {
    return { ok: false, reason: "Quote minimum received exceeds its expected output.", shortfallBps: null };
  }
  const approvedFloor2 = buyV * BigInt(1e4 - quote.slippageBps) / 10000n;
  const shortfallBps = Number((buyV - minV) * 10000n / buyV);
  if (minV + MIN_RECEIVED_ROUNDING_UNITS < approvedFloor2) {
    return {
      ok: false,
      reason: `Quote minimum received is ${(shortfallBps / 100).toFixed(2)}% below its expected output, but the approved slippage is ${(quote.slippageBps / 100).toFixed(2)}%. Executing it would enforce a weaker bound than the one shown.`,
      shortfallBps
    };
  }
  return { ok: true, reason: null, shortfallBps };
}
function deriveMinBuyAmountRaw(buyAmountRaw, slippageBps) {
  if (!/^[0-9]+$/.test(buyAmountRaw)) return null;
  const bps = Math.max(0, Math.min(1e4, Math.round(slippageBps)));
  try {
    return (BigInt(buyAmountRaw) * BigInt(1e4 - bps) / 10000n).toString();
  } catch {
    return null;
  }
}

// src/shared/swap-destination.ts
function lifiDestinationTerms(includedSteps, toChain, toTokenAddress, slippageBps) {
  const steps = Array.isArray(includedSteps) ? includedSteps : [];
  const lastCrossIdx = steps.map((s) => String(s.type ?? "")).lastIndexOf("cross");
  if (lastCrossIdx < 0) {
    return { minReceivedScope: "atomic", fallback: null, destinationSlippageBps: slippageBps };
  }
  const hasDestinationSwap = steps.slice(lastCrossIdx + 1).some((s) => String(s.type ?? "") === "swap");
  if (!hasDestinationSwap) {
    return { minReceivedScope: "provider-guaranteed", fallback: null, destinationSlippageBps: slippageBps };
  }
  const bridgeStep = steps[lastCrossIdx];
  const action = bridgeStep.action ?? {};
  const bridged = action.toToken ?? {};
  const symbol = typeof bridged.symbol === "string" ? bridged.symbol : null;
  const address2 = typeof bridged.address === "string" ? bridged.address : null;
  const decimals = typeof bridged.decimals === "number" ? bridged.decimals : null;
  return {
    minReceivedScope: "destination-conditional",
    destinationSlippageBps: slippageBps,
    fallback: {
      chain: toChain,
      tokenAddress: address2,
      tokenSymbol: symbol,
      tokenDecimals: decimals,
      requiresFurtherTransaction: true,
      summary: symbol ? `If the final swap on ${toChain} cannot fill, you receive ${symbol} on ${toChain} instead. Your original funds are not returned, and converting it would need another transaction.` : `If the final swap on ${toChain} cannot fill, you receive the bridged asset on ${toChain} instead of the token you asked for. Your original funds are not returned, and converting it would need another transaction.`
    }
  };
}
function solverDestinationTerms(provider, fromChain, slippageBps) {
  return {
    minReceivedScope: "provider-guaranteed",
    destinationSlippageBps: slippageBps,
    fallback: {
      chain: fromChain,
      tokenAddress: null,
      tokenSymbol: null,
      tokenDecimals: null,
      requiresFurtherTransaction: false,
      summary: `If no ${provider} solver fills this order at the quoted minimum, ${provider} refunds the deposit on ${fromChain}. That refund is the provider's commitment, not something this transaction enforces.`
    }
  };
}
function sameChainDestinationTerms(minReceivedSource, slippageBps) {
  return {
    // A DERIVED floor is not in the payload, so it is not atomic however
    // same-chain the route is. This is the check that stops "same-chain" being
    // treated as a synonym for "guaranteed".
    minReceivedScope: minReceivedSource === "provider" ? "atomic" : "estimate",
    fallback: null,
    destinationSlippageBps: slippageBps
  };
}
function compactRouteSteps(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, 16)) {
    if (!s || typeof s !== "object") continue;
    const step = s;
    const action = step.action ?? {};
    const tok = action.toToken ?? {};
    if (typeof step.type !== "string") continue;
    out.push({
      type: step.type.slice(0, 32),
      tool: typeof step.tool === "string" ? step.tool.slice(0, 64) : null,
      action: {
        toChainId: typeof action.toChainId === "number" || typeof action.toChainId === "string" ? action.toChainId : null,
        toToken: {
          address: typeof tok.address === "string" ? tok.address.slice(0, 128) : null,
          symbol: typeof tok.symbol === "string" ? tok.symbol.slice(0, 32) : null,
          decimals: Number.isInteger(tok.decimals) ? tok.decimals : null
        }
      }
    });
  }
  return out.length ? out : null;
}
function destinationTermsFor(q) {
  if (q.fromChain === q.toChain) return sameChainDestinationTerms(q.minReceivedSource, q.slippageBps);
  if (q.minReceivedSource !== "provider") {
    return { minReceivedScope: "estimate", fallback: null, destinationSlippageBps: q.slippageBps };
  }
  if (q.provider === "lifi" && q.routeSteps?.length) {
    const terms = lifiDestinationTerms(
      q.routeSteps,
      q.toChain,
      q.toTokenAddress,
      q.slippageBps
    );
    if (terms.minReceivedScope === "atomic") {
      return { minReceivedScope: "estimate", fallback: null, destinationSlippageBps: q.slippageBps };
    }
    return terms;
  }
  return { minReceivedScope: "estimate", fallback: null, destinationSlippageBps: q.slippageBps };
}

// src/shared/swap-routing-policy.ts
var SWAP_ROUTING_POLICY = {
  version: "2026-09-21.routing-v1",
  feePreferenceMaxShortfallBps: 25,
  feePreferenceMaxShortfallUsd: 10,
  maxAlternatives: 3
};
function riskClassOf(scope) {
  switch (scope) {
    case "atomic":
      return 0;
    case "provider-guaranteed":
      return 1;
    case "destination-conditional":
      return 2;
    default:
      return 3;
  }
}
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function bpsOf(part, whole) {
  if (whole <= 0n) return 0;
  return Number(part * 1000000n / whole) / 100;
}
function referenceUnitPriceUsd(routes) {
  const ratios = routes.filter((r) => r.outputUsd != null && r.outputUsd > 0 && r.netOutRaw > 0n).map((r) => r.outputUsd / Number(r.netOutRaw)).filter((x) => Number.isFinite(x) && x > 0);
  return median(ratios);
}
function selectRoute(routes, settings = SWAP_ROUTING_POLICY) {
  const live = routes.filter((r) => r.netOutRaw > 0n);
  if (!live.length) return null;
  const unitUsd = referenceUnitPriceUsd(live);
  const costsNormalized = unitUsd != null && live.every((r) => r.sourceCostUsd != null);
  const valueOf = (r) => {
    if (!costsNormalized) return r.netOutRaw;
    const costUnits = BigInt(Math.round(r.sourceCostUsd / unitUsd));
    return r.netOutRaw - costUnits;
  };
  const order = (a, b) => {
    const va = valueOf(a), vb = valueOf(b);
    if (va !== vb) return va > vb ? -1 : 1;
    if (a.minOutRaw !== b.minOutRaw) return a.minOutRaw > b.minOutRaw ? -1 : 1;
    if (a.risk !== b.risk) return a.risk - b.risk;
    if (a.feeVerified !== b.feeVerified) return a.feeVerified ? -1 : 1;
    return 0;
  };
  const sorted = [...live].sort(order);
  const best = sorted[0];
  const bestValue = valueOf(best);
  const competitive = (r) => {
    if (!r.feeVerified) return false;
    if (r.risk > best.risk) return false;
    const shortfall2 = bestValue - valueOf(r);
    if (bpsOf(shortfall2, bestValue) > settings.feePreferenceMaxShortfallBps) return false;
    if (unitUsd != null && Number(shortfall2) * unitUsd > settings.feePreferenceMaxShortfallUsd) return false;
    const floorShortfall = best.minOutRaw - r.minOutRaw;
    if (floorShortfall > 0n && bpsOf(floorShortfall, best.minOutRaw) > settings.feePreferenceMaxShortfallBps) return false;
    return true;
  };
  let selected = best;
  let reason = "best-net-result";
  if (!best.feeVerified) {
    const feeRoute = sorted.find(competitive);
    if (feeRoute) {
      selected = feeRoute;
      reason = "fee-route-within-tolerance";
    }
  }
  const selectedValue = valueOf(selected);
  const shortfall = bestValue - selectedValue;
  const ranked = sorted.map((r) => ({
    key: r.key,
    provider: r.provider,
    valueRaw: valueOf(r),
    deltaBpsVsSelected: bpsOf(selectedValue - valueOf(r), selectedValue)
  }));
  return {
    policyVersion: settings.version,
    selectedKey: selected.key,
    reason,
    bestKey: best.key,
    shortfallBps: bpsOf(shortfall, bestValue),
    shortfallUsd: unitUsd != null ? Number(shortfall) * unitUsd : null,
    costsNormalized,
    comparedOn: costsNormalized ? "net output minus gas and source-side costs, all priced by the providers in USD" : unitUsd == null ? "net output only: no route priced its output in USD, so gas could not be converted" : "net output only: at least one route did not price its gas, so gas was not compared",
    ranked,
    alternatives: ranked.filter((r) => r.key !== selected.key).slice(0, settings.maxAlternatives)
  };
}

// src/shared/swap-candidates.ts
function withMinReceived(quote) {
  return withDestinationTerms(withMinReceivedOnly(quote));
}
function withDestinationTerms(quote) {
  if (!quote) return null;
  const routeSteps = compactRouteSteps(quote.routeSteps);
  return {
    ...quote,
    routeSteps,
    destination: quote.provider === "relay" && quote.fromChain !== quote.toChain ? solverDestinationTerms("Relay", quote.fromChain, quote.slippageBps) : destinationTermsFor({
      provider: quote.provider,
      fromChain: quote.fromChain,
      toChain: quote.toChain,
      toTokenAddress: quote.toTokenAddress,
      slippageBps: quote.slippageBps,
      minReceivedSource: quote.minReceivedSource,
      routeSteps
    })
  };
}
function withMinReceivedOnly(quote) {
  if (!quote) return null;
  if (quote.minBuyAmountRaw && /^[0-9]+$/.test(quote.minBuyAmountRaw)) {
    return quote.minReceivedSource ? quote : { ...quote, minReceivedSource: "derived" };
  }
  const derived = deriveMinBuyAmountRaw(quote.buyAmountRaw, quote.slippageBps);
  return derived ? { ...quote, minBuyAmountRaw: derived, minReceivedSource: "derived" } : quote;
}
function joinReasons(primary, rejected) {
  return rejected.length ? `${primary} | ${rejected.join(" | ")}` : primary;
}
function unsignableReason(quote) {
  if (!/^[0-9]+$/.test(quote.buyAmountRaw) || quote.buyAmountRaw === "0") return "no output amount";
  const integrity = checkQuoteFeeIntegrity(quote);
  if (!integrity.ok) return integrity.reason ?? "fee terms could not be verified";
  const policy = decideSwapPolicy(quote);
  if (!policy.allowed) return policy.reason ?? "not enabled";
  if (policy.requireMinReceived) {
    const min = checkMinReceived(quote);
    if (!min.ok) return min.reason ?? "minimum received could not be confirmed";
  }
  return null;
}
function outdatedWorkerReason(quote) {
  if (quote.appFee) return null;
  return "the swap service returned a quote with no fee terms, which means it is running an older version than this app \u2014 it cannot be verified, so it is not offered (the Worker needs redeploying)";
}
function selectSafeRoute(candidates, excluded) {
  if (!candidates.length) {
    return { quote: null, error: joinReasons("No route could be offered safely for this swap.", excluded) };
  }
  const metrics = candidates.map((q, i) => ({
    key: String(i),
    provider: q.provider,
    netOutRaw: BigInt(q.buyAmountRaw),
    minOutRaw: BigInt(q.minBuyAmountRaw && /^[0-9]+$/.test(q.minBuyAmountRaw) ? q.minBuyAmountRaw : q.buyAmountRaw),
    sourceCostUsd: typeof q.valuation?.sourceCostUsd === "number" ? q.valuation.sourceCostUsd : null,
    outputUsd: typeof q.valuation?.outputUsd === "number" ? q.valuation.outputUsd : null,
    feeVerified: classifyQuoteFee(q).tier === "fee-paying",
    risk: riskClassOf(q.destination?.minReceivedScope)
  }));
  const selection = selectRoute(metrics);
  if (!selection) {
    return { quote: null, error: joinReasons("No route returned a usable output.", excluded) };
  }
  const byKey = (k) => candidates[Number(k)];
  return {
    quote: byKey(selection.selectedKey),
    error: null,
    routing: {
      policyVersion: selection.policyVersion,
      reason: selection.reason,
      shortfallBps: selection.shortfallBps,
      costsNormalized: selection.costsNormalized,
      safeCandidates: candidates.length,
      excluded,
      alternatives: selection.alternatives.map((a) => {
        const q = byKey(a.key);
        return {
          provider: q.provider,
          buyAmountRaw: q.buyAmountRaw,
          minBuyAmountRaw: q.minBuyAmountRaw ?? null,
          feeVerified: classifyQuoteFee(q).tier === "fee-paying"
        };
      })
    }
  };
}

// src/shared/swap-session.ts
var SWAP_SESSION_TTL_MS = 7 * 24 * 60 * 6e4;

// src/main/swap-delivery.ts
var import_web34 = require("@solana/web3.js");

// src/main/worker-endpoint.ts
var WORKER_URL = "https://api.magicmoney.dev";
var LEGACY_WORKER_URL = "https://magicmoney-swap-proxy.guildfordking.workers.dev";
var WORKER_HOSTS = [
  new URL(WORKER_URL).hostname,
  new URL(LEGACY_WORKER_URL).hostname
];
var CLIENT_TAG = "magicmoney-wallet-v1";
function midnightEndpoints(network) {
  if (network === "preprod") {
    return {
      indexerHttp: "https://indexer.preprod.midnight.network/api/v4/graphql",
      indexerWs: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
      nodeRpc: "https://rpc.preprod.midnight.network",
      nodeRpcWs: "wss://rpc.preprod.midnight.network"
    };
  }
  const tagged = (path, ws = false) => {
    const u = new URL(`${WORKER_URL}${path}`);
    if (ws) u.protocol = "wss:";
    u.searchParams.set("mm_client", CLIENT_TAG);
    return u.toString();
  };
  return {
    indexerHttp: tagged("/midnight/indexer"),
    indexerWs: tagged("/midnight/indexer/ws", true),
    nodeRpc: tagged("/midnight/rpc"),
    nodeRpcWs: tagged("/midnight/rpc/ws", true)
  };
}

// src/main/chain-config.ts
var EVM_CHAINS = [
  {
    id: "ethereum",
    name: "Ethereum",
    type: "evm",
    chainId: 1,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("eth-mainnet", cfg),
    explorerTx: "https://etherscan.io/tx",
    color: "#627EEA",
    colorRgb: "98, 126, 234",
    alchemyNetwork: "eth-mainnet"
  },
  {
    id: "arbitrum",
    name: "Arbitrum One",
    type: "evm",
    chainId: 42161,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("arb-mainnet", cfg),
    explorerTx: "https://arbiscan.io/tx",
    color: "#28A0F0",
    colorRgb: "40, 160, 240",
    alchemyNetwork: "arb-mainnet"
  },
  {
    id: "optimism",
    name: "Optimism",
    type: "evm",
    chainId: 10,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("opt-mainnet", cfg),
    explorerTx: "https://optimistic.etherscan.io/tx",
    color: "#FF0420",
    colorRgb: "255, 4, 32",
    alchemyNetwork: "opt-mainnet"
  },
  {
    id: "base",
    name: "Base",
    type: "evm",
    chainId: 8453,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("base-mainnet", cfg),
    explorerTx: "https://basescan.org/tx",
    color: "#0052FF",
    colorRgb: "0, 82, 255",
    alchemyNetwork: "base-mainnet"
  },
  {
    id: "polygon",
    name: "Polygon",
    type: "evm",
    chainId: 137,
    nativeSymbol: "POL",
    coingeckoId: "polygon-ecosystem-token",
    rpcUrl: (cfg) => alchemyRpcUrl("polygon-mainnet", cfg),
    explorerTx: "https://polygonscan.com/tx",
    color: "#8247E5",
    colorRgb: "130, 71, 229",
    alchemyNetwork: "polygon-mainnet"
  },
  {
    id: "avalanche",
    name: "Avalanche",
    type: "evm",
    chainId: 43114,
    nativeSymbol: "AVAX",
    coingeckoId: "avalanche-2",
    rpcUrl: (cfg) => alchemyRpcUrl("avax-mainnet", cfg),
    explorerTx: "https://snowtrace.io/tx",
    color: "#E84142",
    colorRgb: "232, 65, 66",
    alchemyNetwork: "avax-mainnet"
  },
  {
    id: "blast",
    name: "Blast",
    type: "evm",
    chainId: 81457,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("blast-mainnet", cfg),
    explorerTx: "https://blastscan.io/tx",
    color: "#FCFC03",
    colorRgb: "252, 252, 3",
    alchemyNetwork: "blast-mainnet"
  },
  {
    id: "gnosis",
    name: "Gnosis",
    type: "evm",
    chainId: 100,
    nativeSymbol: "XDAI",
    coingeckoId: "xdai",
    rpcUrl: (cfg) => alchemyRpcUrl("gnosis-mainnet", cfg),
    explorerTx: "https://gnosis.blockscout.com/tx",
    color: "#04795B",
    colorRgb: "4, 121, 91",
    alchemyNetwork: "gnosis-mainnet"
  },
  {
    id: "monad",
    name: "Monad",
    type: "evm",
    chainId: 143,
    nativeSymbol: "MON",
    coingeckoId: "monad",
    rpcUrl: () => "https://rpc.monad.xyz",
    explorerTx: "https://monadexplorer.com/tx",
    color: "#836EF9",
    colorRgb: "131, 110, 249",
    blockscoutUrl: "https://monadexplorer.com"
  },
  {
    id: "abstract",
    name: "Abstract",
    type: "evm",
    chainId: 2741,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("abstract-mainnet", cfg),
    explorerTx: "https://explorer.mainnet.abs.xyz/tx",
    color: "#6B7280",
    colorRgb: "107, 114, 128",
    alchemyNetwork: "abstract-mainnet"
  },
  {
    id: "apechain",
    name: "ApeChain",
    type: "evm",
    chainId: 33139,
    nativeSymbol: "APE",
    coingeckoId: "apecoin",
    rpcUrl: (cfg) => alchemyRpcUrl("apechain-mainnet", cfg),
    explorerTx: "https://apescan.io/tx",
    color: "#0066FF",
    colorRgb: "0, 102, 255",
    alchemyNetwork: "apechain-mainnet"
  },
  {
    id: "robinhood",
    name: "Robinhood Chain",
    type: "evm",
    chainId: 4663,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("robinhood-mainnet", cfg),
    explorerTx: "https://robinhoodchain.blockscout.com/tx",
    color: "#00C805",
    colorRgb: "0, 200, 5",
    alchemyNetwork: "robinhood-mainnet"
  },
  {
    // Circle's stablecoin L1. Gas is native USDC with 18 decimals; the same
    // balance is ALSO exposed as a 6-decimal ERC-20 at ARC_USDC_MIRROR, which
    // token-fetcher drops so the holding isn't counted twice.
    id: "arc",
    name: "Arc",
    type: "evm",
    chainId: 5042,
    nativeSymbol: "USDC",
    coingeckoId: "usd-coin",
    rpcUrl: (cfg) => alchemyRpcUrl("arc-mainnet", cfg),
    explorerTx: "https://explorer.arc.io/tx",
    color: "#3D6FB6",
    colorRgb: "61, 111, 182",
    alchemyNetwork: "arc-mainnet"
  },
  {
    id: "ronin",
    name: "Ronin",
    type: "evm",
    chainId: 2020,
    nativeSymbol: "RON",
    coingeckoId: "ronin",
    rpcUrl: (cfg) => alchemyRpcUrl("ronin-mainnet", cfg),
    explorerTx: "https://explorer.roninchain.com/tx",
    color: "#1273EA",
    colorRgb: "18, 115, 234",
    alchemyNetwork: "ronin-mainnet"
  },
  {
    id: "soneium",
    name: "Soneium",
    type: "evm",
    chainId: 1868,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("soneium-mainnet", cfg),
    explorerTx: "https://soneium.blockscout.com/tx",
    color: "#5B5EA6",
    colorRgb: "91, 94, 166",
    alchemyNetwork: "soneium-mainnet"
  },
  {
    id: "worldchain",
    name: "WorldChain",
    type: "evm",
    chainId: 480,
    // Gas on World Chain is ETH. WLD is an ERC-20 on it, not the native asset -
    // verified 2026-09-20 against LI.FI's chain metadata (native ETH, 18 dp).
    // Naming WLD here mispriced the gas reserve and mislabelled native swaps.
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("worldchain-mainnet", cfg),
    explorerTx: "https://worldchain-mainnet.explorer.alchemy.com/tx",
    color: "#1A1B1F",
    colorRgb: "90, 100, 200",
    alchemyNetwork: "worldchain-mainnet"
  },
  {
    id: "zora",
    name: "Zora",
    type: "evm",
    chainId: 7777777,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("zora-mainnet", cfg),
    explorerTx: "https://explorer.zora.energy/tx",
    color: "#2B5DF0",
    colorRgb: "43, 93, 240",
    alchemyNetwork: "zora-mainnet"
  },
  {
    id: "hyperevm",
    name: "HyperEVM",
    type: "evm",
    // 999, not 998: 998 is HyperEVM TESTNET. Verified 2026-09-20 by calling
    // eth_chainId on rpc.hyperliquid.xyz/evm, which answers 0x3e7 (999), and
    // cross-checked against LI.FI's chain list. A mainnet transaction signed
    // for 998 would be rejected for wrong-chain replay protection.
    chainId: 999,
    nativeSymbol: "HYPE",
    coingeckoId: "hyperliquid",
    rpcUrl: () => "https://rpc.hyperliquid.xyz/evm",
    explorerTx: "https://purrsec.com/tx",
    color: "#00BF7D",
    colorRgb: "0, 191, 125",
    blockscoutUrl: "https://purrsec.com"
  }
];
var NON_EVM_CHAINS = [
  {
    id: "solana",
    name: "Solana",
    type: "solana",
    nativeSymbol: "SOL",
    coingeckoId: "solana",
    rpcUrl: (cfg) => heliusRpcUrl(cfg),
    explorerTx: "https://solscan.io/tx",
    color: "#9945FF",
    colorRgb: "153, 69, 255"
  },
  {
    id: "cardano",
    name: "Cardano",
    type: "cardano",
    nativeSymbol: "ADA",
    coingeckoId: "cardano",
    rpcUrl: () => "https://cardano-mainnet.blockfrost.io/api/v0",
    explorerTx: "https://cardanoscan.io/transaction",
    color: "#2A7DEA",
    colorRgb: "42, 125, 234"
  },
  {
    id: "bitcoin",
    name: "Bitcoin",
    type: "bitcoin",
    nativeSymbol: "BTC",
    coingeckoId: "bitcoin",
    rpcUrl: () => "https://bitcoin-mainnet.gateway.tatum.io",
    explorerTx: "https://mempool.space/tx",
    color: "#F7931A",
    colorRgb: "247, 147, 26"
  },
  {
    id: "polkadot",
    name: "Polkadot",
    type: "polkadot",
    nativeSymbol: "DOT",
    coingeckoId: "polkadot",
    rpcUrl: () => "https://polkadot-mainnet.gateway.tatum.io",
    explorerTx: "https://polkadot.subscan.io/extrinsic",
    color: "#E6007A",
    colorRgb: "230, 0, 122"
  },
  {
    id: "tron",
    name: "Tron",
    type: "tron",
    nativeSymbol: "TRX",
    coingeckoId: "tron",
    // Tron speaks the TRON HTTP API (wallet/*), not JSON-RPC — fetchers call
    // tronApiUrl(path) directly; this is the documentary base.
    rpcUrl: (cfg) => tronApiUrl("", cfg),
    explorerTx: "https://tronscan.org/#/transaction",
    color: "#EB0029",
    colorRgb: "235, 0, 41"
  },
  {
    id: "dogecoin",
    name: "Dogecoin",
    type: "dogecoin",
    nativeSymbol: "DOGE",
    coingeckoId: "dogecoin",
    // UTXO chain — balance/UTXOs come from the keyless Blockbook indexers in
    // DOGE_INDEXERS (Alchemy's Doge JSON-RPC can't query an arbitrary address).
    rpcUrl: () => "https://doge1.trezor.io",
    explorerTx: "https://dogechain.info/tx",
    color: "#C2A633",
    colorRgb: "194, 166, 51"
  }
];
var ALL_CHAINS = [...EVM_CHAINS, ...NON_EVM_CHAINS];
var CHAIN_MAP = Object.fromEntries(
  ALL_CHAINS.map((c) => [c.id, c])
);
var CHAIN_ORDER = ALL_CHAINS.map((c) => c.id);
var PUBLIC_RPCS = {
  // Verified 2026-08-28: cloudflare-eth.com now answers "Cannot fulfill request"
  // and eth.llamarpc.com is gone, so this list was entirely dead — the keyless
  // failover for our BIGGEST chain silently had nothing to fail over to.
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth"],
  arbitrum: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"],
  optimism: ["https://mainnet.optimism.io", "https://optimism.llamarpc.com"],
  base: ["https://mainnet.base.org", "https://base.llamarpc.com"],
  // Same 2026-08-28 sweep: polygon-rpc.com now 403s ("tenant disabled") and
  // polygon.llamarpc.com is gone.
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://1rpc.io/matic"],
  avalanche: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche.public-rpc.com"],
  blast: ["https://rpc.blast.io", "https://blast.blockpi.network/v1/rpc/public"],
  gnosis: ["https://rpc.gnosischain.com", "https://gnosis.public-rpc.com"],
  abstract: ["https://api.mainnet.abs.xyz", "https://2741.rpc.thirdweb.com"],
  apechain: ["https://rpc.apechain.com/http", "https://apechain.calderachain.xyz/http"],
  robinhood: ["https://rpc.mainnet.chain.robinhood.com"],
  // Verified 2026-09-18 (eth_chainId → 0x13b2).
  arc: ["https://rpc.mainnet.arc.io", "https://arc-rpc.publicnode.com", "https://arc.drpc.org"],
  ronin: ["https://api.roninchain.com/rpc", "https://ronin.rpc.thirdweb.com"],
  soneium: ["https://rpc.soneium.org", "https://soneium.rpc.thirdweb.com"],
  worldchain: ["https://worldchain-mainnet.g.alchemy.com/public", "https://worldchain.rpc.thirdweb.com"],
  zora: ["https://rpc.zora.energy", "https://zora.rpc.thirdweb.com"],
  // hyperevm's primary (rpc.hyperliquid.xyz/evm) is already public; 1rpc is a backup.
  hyperevm: ["https://public.1rpc.io/hyperliquid"]
  // Monad is handled separately via MONAD_RPCS (rotation) in the hot read/send paths.
};
var KOIOS_URL = "https://api.koios.rest/api/v1";
var PRIVACY_CHAINS = [
  {
    id: "monero",
    name: "Monero",
    type: "monero",
    nativeSymbol: "XMR",
    coingeckoId: "monero",
    // Monero speaks its own JSON-RPC (get_info, /sendrawtransaction …) served by
    // the keyless community nodes in MONERO_NODES; this is the documentary base.
    rpcUrl: () => MONERO_NODES[0],
    explorerTx: "https://xmrchain.net/tx",
    color: "#FF6600",
    colorRgb: "255, 102, 0"
  },
  {
    id: "zcash",
    name: "Zcash",
    type: "zcash",
    nativeSymbol: "ZEC",
    coingeckoId: "zcash",
    // Transparent-pool reads/broadcast come from the keyless providers in
    // ZCASH_APIS (Blockchair dashboards + push). Shielded (Orchard/Sapling)
    // support arrives with a vendored WebZjs WASM build — see zcash.ts.
    rpcUrl: () => "https://api.blockchair.com/zcash",
    explorerTx: "https://blockchair.com/zcash/transaction",
    color: "#F4B728",
    colorRgb: "244, 183, 40"
  },
  {
    id: "midnight",
    name: "Midnight",
    type: "midnight",
    nativeSymbol: "NIGHT",
    // 'midnight-3' is the REAL Midnight Network token on CoinGecko (rank ~105);
    // the bare 'midnight' id is an unrelated dead token squatting the name.
    coingeckoId: "midnight-3",
    // Balance reads use the indexer (see midnight.ts); this is the node RPC,
    // via the Worker's Blockfrost proxy since Midnight's own endpoints closed.
    rpcUrl: () => midnightEndpoints("mainnet").nodeRpc,
    explorerTx: "https://midnightscan.io/tx",
    color: "#7C3AED",
    colorRgb: "124, 58, 237"
    // Receive + balances only for now — sends need DUST fees + a proof server
    // (the dashboard renders no Send button for this chain).
  }
];
var PRIVACY_CHAIN_MAP = Object.fromEntries(
  PRIVACY_CHAINS.map((c) => [c.id, c])
);
var MONERO_NODES = [
  "https://xmr-node.cakewallet.com:18081",
  "https://node.sethforprivacy.com:18089",
  "https://xmr.stormycloud.org:18089"
];
var TESTNET_EVM_CHAINS = [
  {
    id: "ethereum",
    name: "Ethereum Sepolia",
    type: "evm",
    chainId: 11155111,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("eth-sepolia", cfg),
    explorerTx: "https://sepolia.etherscan.io/tx",
    color: "#627EEA",
    colorRgb: "98, 126, 234",
    alchemyNetwork: "eth-sepolia"
  },
  {
    id: "arbitrum",
    name: "Arbitrum Sepolia",
    type: "evm",
    chainId: 421614,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("arb-sepolia", cfg),
    explorerTx: "https://sepolia.arbiscan.io/tx",
    color: "#28A0F0",
    colorRgb: "40, 160, 240",
    alchemyNetwork: "arb-sepolia"
  },
  {
    id: "optimism",
    name: "OP Sepolia",
    type: "evm",
    chainId: 11155420,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("opt-sepolia", cfg),
    explorerTx: "https://sepolia-optimism.etherscan.io/tx",
    color: "#FF0420",
    colorRgb: "255, 4, 32",
    alchemyNetwork: "opt-sepolia"
  },
  {
    id: "base",
    name: "Base Sepolia",
    type: "evm",
    chainId: 84532,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("base-sepolia", cfg),
    explorerTx: "https://sepolia.basescan.org/tx",
    color: "#0052FF",
    colorRgb: "0, 82, 255",
    alchemyNetwork: "base-sepolia"
  },
  {
    id: "polygon",
    name: "Polygon Amoy",
    type: "evm",
    chainId: 80002,
    nativeSymbol: "POL",
    coingeckoId: "polygon-ecosystem-token",
    rpcUrl: (cfg) => alchemyRpcUrl("polygon-amoy", cfg),
    explorerTx: "https://amoy.polygonscan.com/tx",
    color: "#8247E5",
    colorRgb: "130, 71, 229",
    alchemyNetwork: "polygon-amoy"
  },
  {
    id: "avalanche",
    name: "Avalanche Fuji",
    type: "evm",
    chainId: 43113,
    nativeSymbol: "AVAX",
    coingeckoId: "avalanche-2",
    rpcUrl: (cfg) => alchemyRpcUrl("avax-fuji", cfg),
    explorerTx: "https://testnet.snowtrace.io/tx",
    color: "#E84142",
    colorRgb: "232, 65, 66",
    alchemyNetwork: "avax-fuji"
  },
  {
    id: "blast",
    name: "Blast Sepolia",
    type: "evm",
    chainId: 168587773,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("blast-sepolia", cfg),
    explorerTx: "https://sepolia.blastscan.io/tx",
    color: "#FCFC03",
    colorRgb: "252, 252, 3",
    alchemyNetwork: "blast-sepolia"
  },
  {
    id: "gnosis",
    name: "Gnosis Chiado",
    type: "evm",
    chainId: 10200,
    nativeSymbol: "XDAI",
    coingeckoId: "xdai",
    rpcUrl: () => "https://rpc.chiadochain.net",
    explorerTx: "https://gnosis-chiado.blockscout.com/tx",
    color: "#04795B",
    colorRgb: "4, 121, 91",
    blockscoutUrl: "https://gnosis-chiado.blockscout.com"
  },
  {
    id: "monad",
    name: "Monad Testnet",
    type: "evm",
    chainId: 10143,
    nativeSymbol: "MON",
    coingeckoId: "monad",
    rpcUrl: () => "https://testnet-rpc.monad.xyz",
    explorerTx: "https://testnet.monadexplorer.com/tx",
    color: "#836EF9",
    colorRgb: "131, 110, 249",
    blockscoutUrl: "https://testnet.monadexplorer.com"
  },
  {
    id: "abstract",
    name: "Abstract Testnet",
    type: "evm",
    chainId: 11124,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("abstract-testnet", cfg),
    explorerTx: "https://sepolia.abscan.org/tx",
    color: "#6B7280",
    colorRgb: "107, 114, 128",
    alchemyNetwork: "abstract-testnet"
  },
  {
    id: "apechain",
    name: "ApeChain Curtis",
    type: "evm",
    chainId: 33111,
    nativeSymbol: "APE",
    coingeckoId: "apecoin",
    rpcUrl: (cfg) => alchemyRpcUrl("apechain-curtis", cfg),
    explorerTx: "https://curtis.explorer.caldera.xyz/tx",
    color: "#0066FF",
    colorRgb: "0, 102, 255",
    alchemyNetwork: "apechain-curtis"
  },
  {
    id: "robinhood",
    name: "Robinhood Chain Testnet",
    type: "evm",
    chainId: 46630,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("robinhood-testnet", cfg),
    explorerTx: "https://explorer.testnet.chain.robinhood.com/tx",
    color: "#00C805",
    colorRgb: "0, 200, 5",
    alchemyNetwork: "robinhood-testnet"
  },
  {
    id: "ronin",
    name: "Ronin Saigon",
    type: "evm",
    chainId: 2021,
    nativeSymbol: "RON",
    coingeckoId: "ronin",
    rpcUrl: (cfg) => alchemyRpcUrl("ronin-saigon", cfg),
    explorerTx: "https://saigon-app.roninchain.com/tx",
    color: "#1273EA",
    colorRgb: "18, 115, 234",
    alchemyNetwork: "ronin-saigon"
  },
  {
    id: "soneium",
    name: "Soneium Minato",
    type: "evm",
    chainId: 1946,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("soneium-minato", cfg),
    explorerTx: "https://soneium-minato.blockscout.com/tx",
    color: "#5B5EA6",
    colorRgb: "91, 94, 166",
    alchemyNetwork: "soneium-minato",
    blockscoutUrl: "https://soneium-minato.blockscout.com"
  },
  {
    id: "worldchain",
    name: "World Chain Sepolia",
    type: "evm",
    chainId: 4801,
    nativeSymbol: "WLD",
    coingeckoId: "worldcoin-wld",
    rpcUrl: (cfg) => alchemyRpcUrl("worldchain-sepolia", cfg),
    explorerTx: "https://worldchain-sepolia.explorer.alchemy.com/tx",
    color: "#1A1B1F",
    colorRgb: "90, 100, 200",
    alchemyNetwork: "worldchain-sepolia"
  },
  {
    id: "zora",
    name: "Zora Sepolia",
    type: "evm",
    chainId: 999999999,
    nativeSymbol: "ETH",
    coingeckoId: "ethereum",
    rpcUrl: (cfg) => alchemyRpcUrl("zora-sepolia", cfg),
    explorerTx: "https://sepolia.explorer.zora.energy/tx",
    color: "#2B5DF0",
    colorRgb: "43, 93, 240",
    alchemyNetwork: "zora-sepolia"
  },
  {
    id: "hyperevm",
    name: "HyperEVM Testnet",
    type: "evm",
    chainId: 998,
    nativeSymbol: "HYPE",
    coingeckoId: "hyperliquid",
    rpcUrl: () => "https://rpc.hyperliquid-testnet.xyz/evm",
    explorerTx: "https://testnet.purrsec.com/tx",
    color: "#00BF7D",
    colorRgb: "0, 191, 125"
  }
];
var TESTNET_NON_EVM_CHAINS = [
  {
    id: "solana",
    name: "Solana Devnet",
    type: "solana",
    nativeSymbol: "SOL",
    coingeckoId: "solana",
    // Devnet is served keyless by the canonical public RPC (no Helius route needed).
    rpcUrl: () => "https://api.devnet.solana.com",
    explorerTx: "https://solscan.io/tx",
    // append ?cluster=devnet at link time
    color: "#9945FF",
    colorRgb: "153, 69, 255"
  },
  {
    id: "cardano",
    name: "Cardano Preprod",
    type: "cardano",
    nativeSymbol: "ADA",
    coingeckoId: "cardano",
    // Blockfrost keys are network-scoped (mainnet key ≠ preprod), so testnet reads
    // go through keyless Koios preprod instead (see activeKoiosUrl / balance-fetcher).
    rpcUrl: () => "https://preprod.koios.rest/api/v1",
    explorerTx: "https://preprod.cardanoscan.io/transaction",
    color: "#2A7DEA",
    colorRgb: "42, 125, 234"
  },
  {
    id: "bitcoin",
    name: "Bitcoin Testnet3",
    type: "bitcoin",
    nativeSymbol: "BTC",
    coingeckoId: "bitcoin",
    rpcUrl: () => "https://mempool.space/testnet/api",
    explorerTx: "https://mempool.space/testnet/tx",
    color: "#F7931A",
    colorRgb: "247, 147, 26"
  },
  {
    id: "bitcoin-testnet4",
    name: "Bitcoin Testnet4",
    type: "bitcoin",
    nativeSymbol: "BTC",
    coingeckoId: "bitcoin",
    rpcUrl: () => "https://mempool.space/testnet4/api",
    explorerTx: "https://mempool.space/testnet4/tx",
    color: "#F7931A",
    colorRgb: "247, 147, 26"
  },
  {
    id: "tron",
    name: "Tron Shasta",
    type: "tron",
    nativeSymbol: "TRX",
    coingeckoId: "tron",
    // Shasta is served keyless by TronGrid (no Alchemy/Worker route needed).
    rpcUrl: () => "https://api.shasta.trongrid.io",
    explorerTx: "https://shasta.tronscan.org/#/transaction",
    color: "#EB0029",
    colorRgb: "235, 0, 41"
  },
  {
    id: "midnight",
    name: "Midnight Preprod",
    type: "midnight",
    nativeSymbol: "NIGHT",
    coingeckoId: "midnight-3",
    rpcUrl: () => "https://rpc.preprod.midnight.network",
    // No confirmed public Preprod block explorer yet — left blank rather than
    // guessed; unused by anything today (see midnight-send.ts's own explorer
    // URL handling, which already returns '' for preprod sends).
    explorerTx: "",
    color: "#7C3AED",
    colorRgb: "124, 58, 237"
  }
];
var TESTNET_ALL_CHAINS = [...TESTNET_EVM_CHAINS, ...TESTNET_NON_EVM_CHAINS];
var TESTNET_CHAIN_MAP = Object.fromEntries(
  TESTNET_ALL_CHAINS.map((c) => [c.id, c])
);
var TESTNET_PUBLIC_RPCS = {
  ethereum: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
  arbitrum: ["https://sepolia-rollup.arbitrum.io/rpc"],
  optimism: ["https://sepolia.optimism.io"],
  base: ["https://sepolia.base.org"],
  polygon: ["https://rpc-amoy.polygon.technology"],
  avalanche: ["https://api.avax-test.network/ext/bc/C/rpc"],
  blast: ["https://sepolia.blast.io"],
  gnosis: ["https://rpc.chiadochain.net"],
  monad: ["https://testnet-rpc.monad.xyz"],
  abstract: ["https://api.testnet.abs.xyz"],
  apechain: ["https://curtis.rpc.caldera.xyz/http"],
  robinhood: ["https://rpc.testnet.chain.robinhood.com"],
  ronin: ["https://saigon-testnet.roninchain.com/rpc"],
  soneium: ["https://rpc.minato.soneium.org"],
  worldchain: ["https://worldchain-sepolia.g.alchemy.com/public"],
  zora: ["https://sepolia.rpc.zora.energy"],
  hyperevm: ["https://rpc.hyperliquid-testnet.xyz/evm"]
};
var TESTNET_KOIOS_URL = "https://preprod.koios.rest/api/v1";
var isTestnet = (cfg) => !!cfg.testnetMode;

// src/main/tx-sender.ts
var import_viem3 = require("viem");
var import_chains = require("viem/chains");
var import_accounts2 = require("viem/accounts");
var import_web33 = require("@solana/web3.js");
var import_bip39 = require("@scure/bip39");
var import_english2 = require("@scure/bip39/wordlists/english");

// src/main/wallet-core.ts
var bip39 = __toESM(require("@scure/bip39"));
var import_english = require("@scure/bip39/wordlists/english");
var import_bip32 = require("@scure/bip32");
var import_ed25519_hd_key = require("ed25519-hd-key");
var import_web3 = require("@solana/web3.js");
var import_accounts = require("viem/accounts");

// src/main/cardano-pure.ts
var import_pbkdf2 = require("@noble/hashes/pbkdf2");
var import_sha512 = require("@noble/hashes/sha512");
var import_hmac = require("@noble/hashes/hmac");
var import_blake2b = require("@noble/hashes/blake2b");
var import_ed25519 = require("@noble/curves/ed25519");
var import_base = require("@scure/base");
var CURVE_N = import_ed25519.ed25519.CURVE.n;
function decodeCardanoAddress(addr) {
  const decoded = import_base.bech32.decode(addr, 1e3);
  return import_base.bech32.fromWords(decoded.words);
}

// src/main/monero-pure.ts
var import_sha3 = require("@noble/hashes/sha3");
var import_ed255192 = require("@noble/curves/ed25519");
var L = import_ed255192.ed25519.CURVE.n;
function bytesToBigintLE(bytes) {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = v << 8n | BigInt(bytes[i]);
  return v;
}
function bigintToBytesLE(v, len = 32) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
function scReduce32(bytes) {
  return bigintToBytesLE(bytesToBigintLE(bytes) % L);
}
function scalarToPublic(scalarLE) {
  const s = bytesToBigintLE(scalarLE);
  if (s === 0n) throw new Error("Monero scalar is zero");
  return import_ed255192.ed25519.ExtendedPoint.BASE.multiply(s).toRawBytes();
}
var B58_ALPHABET2 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var FULL_BLOCK_SIZE = 8;
var ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11];
function encodeBlock(data) {
  let num = 0n;
  for (const b of data) num = num << 8n | BigInt(b);
  const size = ENCODED_BLOCK_SIZES[data.length];
  let out = "";
  while (num > 0n) {
    out = B58_ALPHABET2[Number(num % 58n)] + out;
    num /= 58n;
  }
  return out.padStart(size, B58_ALPHABET2[0]);
}
function moneroBase58Encode(data) {
  let out = "";
  for (let i = 0; i < data.length; i += FULL_BLOCK_SIZE) {
    out += encodeBlock(data.slice(i, i + FULL_BLOCK_SIZE));
  }
  return out;
}
var MAINNET_PREFIX = 18;
function addressFromPubkeys(spendPub, viewPub, prefix = MAINNET_PREFIX) {
  const payload = new Uint8Array([prefix, ...spendPub, ...viewPub]);
  const checksum = (0, import_sha3.keccak_256)(payload).slice(0, 4);
  return moneroBase58Encode(new Uint8Array([...payload, ...checksum]));
}
var hex = (b) => Buffer.from(b).toString("hex");
function deriveMoneroKeys(bip32PrivateKey) {
  const spendScalar = scReduce32((0, import_sha3.keccak_256)(bip32PrivateKey));
  const viewScalar = scReduce32((0, import_sha3.keccak_256)(spendScalar));
  const spendPub = scalarToPublic(spendScalar);
  const viewPub = scalarToPublic(viewScalar);
  return {
    privateSpendKey: hex(spendScalar),
    privateViewKey: hex(viewScalar),
    publicSpendKey: hex(spendPub),
    publicViewKey: hex(viewPub),
    address: addressFromPubkeys(spendPub, viewPub)
  };
}

// src/main/midnight-crypto.ts
var import_base2 = require("@scure/base");

// src/main/midnight.ts
var INDEXER_WS = {
  mainnet: midnightEndpoints("mainnet").indexerWs,
  preprod: midnightEndpoints("preprod").indexerWs
};
var INDEXER_HTTP = midnightEndpoints("mainnet").indexerHttp;

// src/main/wallet-core.ts
var import_sha256 = require("@noble/hashes/sha256");
var import_ripemd160 = require("@noble/hashes/ripemd160");
var import_blake2b2 = require("@noble/hashes/blake2b");
var import_sha32 = require("@noble/hashes/sha3");
var import_ed255193 = require("@noble/curves/ed25519");
var import_secp256k1 = require("@noble/curves/secp256k1");
var import_base3 = require("@scure/base");
var btc = __toESM(require("@scure/btc-signer"));
function normalizeMnemonic(phrase) {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}
async function getMoneroKeys(mnemonic, accountIndex = 0) {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic));
  const node = import_bip32.HDKey.fromMasterSeed(seed).derive(`m/44'/128'/${accountIndex}'/0/0`);
  if (!node.privateKey) throw new Error("Monero key derivation failed");
  return deriveMoneroKeys(node.privateKey);
}

// src/main/cardano-koios.ts
function koiosPost(path, body, timeoutMs = 12e3, base2 = KOIOS_URL) {
  return fetch(`${base2}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
}
async function koiosAddressUtxos(address2, base2 = KOIOS_URL) {
  try {
    const res = await koiosPost("/address_utxos", { _addresses: [address2], _extended: true }, 12e3, base2);
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows.map((u) => ({
      txHash: u.tx_hash,
      txIndex: u.tx_index,
      lovelace: BigInt(u.value ?? "0"),
      assets: (u.asset_list ?? []).map((a) => ({
        unit: a.policy_id + (a.asset_name ?? ""),
        quantity: BigInt(a.quantity)
      })),
      // Carried for the CIP-30 reads (dApps re-spend these outputs); the send
      // path ignores it.
      datumHash: u.datum_hash ?? void 0
    }));
  } catch {
    return null;
  }
}

// src/main/asset-transfer.ts
var import_viem = require("viem");
var ERC20_TRANSFER_ABI = (0, import_viem.parseAbi)([
  "function transfer(address to, uint256 amount) returns (bool)"
]);
var ERC721_TRANSFER_ABI = (0, import_viem.parseAbi)([
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
]);
var ERC1155_TRANSFER_ABI = (0, import_viem.parseAbi)([
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
]);

// src/main/spl-transfer.ts
var import_web32 = require("@solana/web3.js");
var TOKEN_PROGRAM_ID = new import_web32.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
var TOKEN_2022_PROGRAM_ID = new import_web32.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
var ASSOCIATED_TOKEN_PROGRAM_ID = new import_web32.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// src/main/tron.ts
var import_sha2562 = require("@noble/hashes/sha256");
var import_secp256k12 = require("@noble/curves/secp256k1");
var import_base4 = require("@scure/base");
var import_viem2 = require("viem");

// src/main/dogecoin.ts
var btc2 = __toESM(require("@scure/btc-signer"));
var import_base5 = require("@scure/base");

// src/main/bitcoin.ts
var btc3 = __toESM(require("@scure/btc-signer"));
var import_base6 = require("@scure/base");
var import_sha2563 = require("@noble/hashes/sha256");
var import_secp256k13 = require("@noble/curves/secp256k1");

// src/main/secure-store.ts
var import_electron2 = require("electron");

// src/main/crypto-vault.ts
var subtle = (() => {
  const g = globalThis;
  if (g.crypto?.subtle) return g.crypto.subtle;
  const nodeCrypto = require("crypto");
  return nodeCrypto.webcrypto.subtle;
})();
var HELLO_HKDF_INFO = new TextEncoder().encode("magicmoney-hello-vault-v1");

// src/main/hello-bridge.ts
var HELLO_CHALLENGE_B64 = Buffer.from("magicmoney-hello-vault-challenge-v1", "utf8").toString("base64");

// src/main/touchid-bridge.ts
var import_electron = require("electron");

// src/main/secure-store.ts
var ALLOWED_PROXY_HOSTS = new Set(WORKER_HOSTS);

// src/main/monero-rpc.ts
var XMR_ATOMIC = 1e12;
async function pickNode() {
  let lastErr = "No Monero node reachable";
  for (const uri of MONERO_NODES) {
    try {
      const res = await fetch(`${uri}/json_rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "0", method: "get_info" }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!res.ok) {
        lastErr = `${uri} \u2192 ${res.status}`;
        continue;
      }
      const json = await res.json();
      if (json.result?.height) return { uri, height: json.result.height };
    } catch (err) {
      lastErr = `${uri} \u2192 ${String(err)}`;
    }
  }
  throw new Error(lastErr);
}

// src/main/monero-impl.ts
var EXPLORER = "https://xmrchain.net/tx";
var WALLET_CREATE_TIMEOUT_MS = 9e4;
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1e3)}s`)), ms))
  ]);
}
function createMoneroModule(loadMoneroTs2, opts = {}) {
  let view = null;
  async function ensureViewWallet(privacy, config) {
    if (view && view.key === privacy.monero && view.status !== "error") return view;
    if (view?.wallet) {
      try {
        await view.wallet.close();
      } catch {
      }
    }
    const state = { key: privacy.monero, wallet: null, status: "starting", progress: 0, error: null };
    view = state;
    void (async () => {
      try {
        const ts = await loadMoneroTs2();
        const { uri, height } = await pickNode();
        const wallet = await withTimeout(ts.createWalletFull({
          networkType: ts.MoneroNetworkType.MAINNET,
          password: "view",
          // in-memory wallet — never written to disk
          primaryAddress: privacy.monero,
          privateViewKey: privacy.moneroViewKey,
          // No stamped wallet birthday (older config / stamping failed) →
          // near-tip fallback. The privacy addresses are brand-new derivations,
          // so nothing exists before the mode was first enabled; scanning from
          // genesis would take hours for a guaranteed-empty history.
          restoreHeight: config.moneroRestoreHeight || Math.max(height - 720, 0),
          server: { uri },
          proxyToWorker: opts.proxyToWorker
        }), WALLET_CREATE_TIMEOUT_MS, "Monero wallet init");
        if (view !== state) {
          await wallet.close();
          return;
        }
        state.wallet = wallet;
        state.status = "syncing";
        await wallet.startSyncing(1e4);
        for (let pass = 0; pass < 120; pass++) {
          if (view !== state) {
            await wallet.close();
            return;
          }
          const [walletH, chainH] = await Promise.all([wallet.getHeight(), wallet.getDaemonHeight()]);
          state.progress = chainH > 0 ? Math.min(100, Math.round(walletH / chainH * 100)) : 0;
          if (walletH >= chainH) break;
          await new Promise((r) => setTimeout(r, 1e4));
        }
        state.status = "ready";
      } catch (err) {
        state.status = "error";
        state.error = String(err instanceof Error ? err.message : err);
      }
    })();
    return state;
  }
  return {
    /**
     * Balance for the dashboard. Non-blocking: while the view wallet is still
     * catching up it returns a sync-status error string (the ChainCard renders
     * it), and real numbers once ready.
     */
    async fetchMoneroBalance(privacy, config) {
      if (!privacy?.monero || !privacy.moneroViewKey) return { native: 0, error: "No address" };
      try {
        const state = await ensureViewWallet(privacy, config);
        if (state.status === "error") return { native: 0, error: state.error ?? "Monero sync failed" };
        if (state.status !== "ready" || !state.wallet) {
          return { native: 0, error: state.status === "syncing" ? `Syncing ${state.progress}%` : "Syncing\u2026" };
        }
        const balance = await state.wallet.getBalance();
        return { native: Number(balance) / XMR_ATOMIC, error: null };
      } catch (err) {
        return { native: 0, error: String(err instanceof Error ? err.message : err) };
      }
    },
    async sendMoneroTransaction(mnemonic, to, amountXmr, config, accountIndex = 0) {
      const atomic = BigInt(Math.round(parseFloat(amountXmr) * XMR_ATOMIC));
      if (atomic <= 0n) throw new Error("Amount must be greater than 0");
      const ts = await loadMoneroTs2();
      const keys = await getMoneroKeys(mnemonic, accountIndex);
      const { uri, height } = await pickNode();
      const wallet = await ts.createWalletFull({
        networkType: ts.MoneroNetworkType.MAINNET,
        password: "send",
        // in-memory wallet — never written to disk
        primaryAddress: keys.address,
        privateViewKey: keys.privateViewKey,
        privateSpendKey: keys.privateSpendKey,
        restoreHeight: config.moneroRestoreHeight || Math.max(height - 720, 0),
        // see view-wallet note
        server: { uri }
      });
      try {
        await wallet.sync();
        const tx = await wallet.createTx({
          accountIndex: 0,
          address: to,
          amount: atomic,
          relay: true
        });
        const hash = tx.getHash();
        return { txHash: hash, explorerUrl: `${EXPLORER}/${hash}` };
      } finally {
        try {
          await wallet.close();
        } catch {
        }
      }
    },
    /** Tear down the scanner (mode disabled / wallet deleted). */
    async stopMoneroSync() {
      const v = view;
      view = null;
      if (v?.wallet) {
        try {
          await v.wallet.close();
        } catch {
        }
      }
    }
  };
}

// src/main/monero.ts
var _moneroTs = null;
function loadMoneroTs() {
  if (!_moneroTs) {
    const spec = "monero-ts";
    _moneroTs = import(
      /* @vite-ignore */
      spec
    ).then((m) => m.default ?? m);
  }
  return _moneroTs;
}
var backend = createMoneroModule(loadMoneroTs);
var fetchMoneroBalance = backend.fetchMoneroBalance;
var sendMoneroTransaction = backend.sendMoneroTransaction;
var stopMoneroSync = backend.stopMoneroSync;

// src/main/zcash.ts
var import_blake2b3 = require("@noble/hashes/blake2b");
var import_sha2564 = require("@noble/hashes/sha256");
var import_ripemd1602 = require("@noble/hashes/ripemd160");
var import_secp256k14 = require("@noble/curves/secp256k1");
var import_base7 = require("@scure/base");
var P2PKH_PREFIX = new Uint8Array([28, 184]);
var P2SH_PREFIX = new Uint8Array([28, 189]);

// src/main/tx-sender.ts
var monad = (0, import_viem3.defineChain)({ id: 143, name: "Monad", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } });
var abstractChain = (0, import_viem3.defineChain)({ id: 2741, name: "Abstract", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://api.mainnet.abs.xyz"] } } });
var apeChain = (0, import_viem3.defineChain)({ id: 33139, name: "ApeChain", nativeCurrency: { name: "ApeCoin", symbol: "APE", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.apechain.com/http"] } } });
var robinhood = (0, import_viem3.defineChain)({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
var arc = (0, import_viem3.defineChain)({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } } });
var soneium = (0, import_viem3.defineChain)({ id: 1868, name: "Soneium", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.soneium.org"] } } });
var worldchain = (0, import_viem3.defineChain)({ id: 480, name: "WorldChain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://worldchain-mainnet.g.alchemy.com/public"] } } });
var hyperEvm = (0, import_viem3.defineChain)({ id: 999, name: "HyperEVM", nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } } });
var monadTestnet = (0, import_viem3.defineChain)({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } }, testnet: true });
var abstractTestnet = (0, import_viem3.defineChain)({ id: 11124, name: "Abstract Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://api.testnet.abs.xyz"] } }, testnet: true });
var apeChainCurtis = (0, import_viem3.defineChain)({ id: 33111, name: "ApeChain Curtis", nativeCurrency: { name: "ApeCoin", symbol: "APE", decimals: 18 }, rpcUrls: { default: { http: ["https://curtis.rpc.caldera.xyz/http"] } }, testnet: true });
var robinhoodTestnet = (0, import_viem3.defineChain)({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } }, testnet: true });
var roninSaigon = (0, import_viem3.defineChain)({ id: 2021, name: "Ronin Saigon", nativeCurrency: { name: "Ronin", symbol: "RON", decimals: 18 }, rpcUrls: { default: { http: ["https://saigon-testnet.roninchain.com/rpc"] } }, testnet: true });
var soneiumMinato = (0, import_viem3.defineChain)({ id: 1946, name: "Soneium Minato", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.minato.soneium.org"] } }, testnet: true });
var worldchainSepolia = (0, import_viem3.defineChain)({ id: 4801, name: "World Chain Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://worldchain-sepolia.g.alchemy.com/public"] } }, testnet: true });
var hyperEvmTestnet = (0, import_viem3.defineChain)({ id: 998, name: "HyperEVM Testnet", nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] } }, testnet: true });
var PUBLIC_RPCS_BY_CHAIN_ID = Object.fromEntries(
  EVM_CHAINS.filter((c) => c.chainId != null).map((c) => [c.chainId, PUBLIC_RPCS[c.id] ?? []])
);
var TESTNET_PUBLIC_RPCS_BY_CHAIN_ID = Object.fromEntries(
  TESTNET_EVM_CHAINS.filter((c) => c.chainId != null).map((c) => [c.chainId, TESTNET_PUBLIC_RPCS[c.id] ?? []])
);
var ID_BY_CHAIN_ID = Object.fromEntries(
  EVM_CHAINS.filter((c) => c.chainId != null).map((c) => [c.chainId, c.id])
);
async function fetchUtxos(address2, config) {
  if (isTestnet(config)) {
    const koiosPreprod = await koiosAddressUtxos(address2, TESTNET_KOIOS_URL);
    if (koiosPreprod) return koiosPreprod;
    throw new Error("Could not fetch Cardano preprod UTXOs (Koios unavailable)");
  }
  try {
    const res = await blockfrostFetch(`addresses/${address2}/utxos`, config);
    if (res.status === 404) return [];
    if (res.ok) {
      const utxos = await res.json();
      return utxos.map((u) => ({
        txHash: u.tx_hash,
        txIndex: u.tx_index,
        lovelace: BigInt(u.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0"),
        // Native tokens MUST be carried through — dropping them here is what
        // burned NFTs on plain ADA sends (they vanish from the change output).
        assets: u.amount.filter((a) => a.unit !== "lovelace").map((a) => ({ unit: a.unit, quantity: BigInt(a.quantity) }))
      }));
    }
  } catch {
  }
  const koios = await koiosAddressUtxos(address2);
  if (koios) return koios;
  throw new Error("Could not fetch Cardano UTXOs (Blockfrost and Koios both unavailable)");
}
var PARAMS_TTL_MS = 10 * 6e4;
async function fetchCardanoTip(config) {
  if (!isTestnet(config)) {
    try {
      const res = await blockfrostFetch("blocks/latest", config, 1e4);
      if (res.ok) {
        const block = await res.json();
        if (typeof block.slot === "number") return BigInt(block.slot);
      }
    } catch {
    }
  }
  try {
    const base2 = isTestnet(config) ? TESTNET_KOIOS_URL : KOIOS_URL;
    const res = await fetch(`${base2}/tip`, { signal: AbortSignal.timeout(1e4) });
    if (res.ok) {
      const rows = await res.json();
      const slot = rows?.[0]?.abs_slot;
      if (typeof slot === "number") return BigInt(slot);
    }
  } catch {
  }
  return null;
}

// src/main/solana-swap-cost.ts
var import_web35 = require("@solana/web3.js");

// src/main/solana-simulation-failure.ts
function describeSolanaSimulationFailure(err, logs) {
  const all = logs.join(" | ");
  if (/Program mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny failed: custom program error: 0x1789\b/i.test(all)) {
    return "Mayan rejected the amount reaching its bridge (AmountInTooSmall, 6025). The quoted source swap did not satisfy the bridge input requirement. Request a new route.";
  }
  if (/Program 11111111111111111111111111111111 failed: custom program error: 0x1\b/i.test(all) && /ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL/.test(all)) {
    return "This route needs more SOL to create a required token account and cover Solana network fees. Add SOL, then refresh the quote.";
  }
  const diagnostic = logs.find((l) => /AnchorError|Error Code:|Error Message:/.test(l));
  const tail = logs.slice(-3).join(" | ");
  return `${JSON.stringify(err)}${diagnostic ? ` \u2014 ${diagnostic}` : ""}${tail ? ` \u2014 ${tail}` : ""}`;
}

// src/shared/solana-upfront-cost.ts
function solanaRequiredLamports(cost) {
  const staticReq = BigInt(cost.requiredLamports);
  if (cost.measuredLamports != null) {
    const m = BigInt(cost.measuredLamports);
    return { lamports: m > staticReq ? m : staticReq, exact: true };
  }
  return { lamports: staticReq, exact: cost.complete };
}
function solanaCostShortfall(cost) {
  if (cost.balanceLamports == null) return null;
  const gap = solanaRequiredLamports(cost).lamports - BigInt(cost.balanceLamports);
  return gap > 0n ? gap : null;
}
function solanaShortfallMessage(cost) {
  const gap = solanaCostShortfall(cost);
  if (gap == null) return null;
  const req = solanaRequiredLamports(cost);
  const sol = (l) => (Number(l) / 1e9).toFixed(6);
  const newAcc = cost.newAccounts.filter((a) => !a.refundedInTx).length;
  const temp = cost.newAccounts.filter((a) => a.refundedInTx).length;
  const parts = [
    newAcc ? `${newAcc} new token account${newAcc > 1 ? "s" : ""}` : "",
    temp ? `${temp} temporary account${temp > 1 ? "s" : ""} (rent returned when the swap finishes)` : ""
  ].filter(Boolean).join(" and ");
  return `This swap needs ${req.exact ? "" : "at least "}${sol(req.lamports)} SOL up front${parts ? ` for network fees and ${parts}` : " for network fees"}, and this account holds ${sol(BigInt(cost.balanceLamports ?? "0"))} SOL. Add at least ${sol(gap)} SOL, then refresh the quote.`;
}

// src/main/solana-swap-cost.ts
var SYSTEM_PROGRAM = "11111111111111111111111111111111";
var TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
var COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
var WSOL_MINT = "So11111111111111111111111111111111111111112";
var KNOWN_PROGRAMS = /* @__PURE__ */ new Set([
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  ATA_PROGRAM,
  COMPUTE_BUDGET,
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"
]);
var LAMPORTS_PER_SIGNATURE = 5000n;
var DEFAULT_CU_PER_INSTRUCTION = 200000n;
var MAX_CU = 1400000n;
var u32 = (d, o) => (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
var u64 = (d, o) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) + BigInt(d[o + i] ?? 0);
  return v;
};
function wrappedSolAccountOf(payer) {
  return import_web35.PublicKey.findProgramAddressSync(
    [new import_web35.PublicKey(payer).toBytes(), new import_web35.PublicKey(TOKEN_PROGRAM).toBytes(), new import_web35.PublicKey(WSOL_MINT).toBytes()],
    new import_web35.PublicKey(ATA_PROGRAM)
  )[0].toBase58();
}
function analyzeSolanaInstructions(payer, signatures, instructions) {
  let cuLimit = null;
  let cuPriceMicro = 0n;
  let nonBudget = 0n;
  const out = {
    signatures,
    baseFeeLamports: LAMPORTS_PER_SIGNATURE * BigInt(signatures),
    priorityFeeLamports: 0n,
    ataCreates: [],
    systemCreates: [],
    wrapLamports: 0n,
    otherTransferLamports: 0n,
    closedToPayer: [],
    opaquePrograms: []
  };
  const wsolAccount = wrappedSolAccountOf(payer);
  for (const ix of instructions) {
    const d = ix.data;
    switch (ix.programId) {
      case COMPUTE_BUDGET:
        if (d[0] === 2) cuLimit = BigInt(u32(d, 1));
        else if (d[0] === 3) cuPriceMicro = u64(d, 1);
        continue;
      case ATA_PROGRAM: {
        if ((d.length === 0 || d[0] === 0 || d[0] === 1) && ix.accounts[0] === payer) {
          out.ataCreates.push({ ata: ix.accounts[1], owner: ix.accounts[2], mint: ix.accounts[3], tokenProgram: ix.accounts[5] });
        }
        break;
      }
      case SYSTEM_PROGRAM: {
        const kind = u32(d, 0);
        if (ix.accounts[0] !== payer) break;
        if (kind === 0) out.systemCreates.push({ address: ix.accounts[1], lamports: u64(d, 4), space: u64(d, 12) });
        else if (kind === 3) {
          const seedLen = Number(u64(d, 36));
          const at = 44 + seedLen;
          out.systemCreates.push({ address: ix.accounts[1], lamports: u64(d, at), space: u64(d, at + 8) });
        } else if (kind === 2) {
          const lamports = u64(d, 4);
          if (ix.accounts[1] === wsolAccount) out.wrapLamports += lamports;
          else out.otherTransferLamports += lamports;
        }
        break;
      }
      case TOKEN_PROGRAM:
      case TOKEN_2022_PROGRAM:
        if (d[0] === 9 && ix.accounts[1] === payer) out.closedToPayer.push(ix.accounts[0]);
        break;
      default:
        if (!KNOWN_PROGRAMS.has(ix.programId) && ix.accounts.includes(payer) && !out.opaquePrograms.includes(ix.programId)) {
          out.opaquePrograms.push(ix.programId);
        }
    }
    nonBudget++;
  }
  const limit = cuLimit ?? (() => {
    const def = DEFAULT_CU_PER_INSTRUCTION * nonBudget;
    return def > MAX_CU ? MAX_CU : def;
  })();
  out.priorityFeeLamports = (cuPriceMicro * limit + 999999n) / 1000000n;
  return out;
}
function tokenAccountSize(tokenProgram, mintData) {
  if (tokenProgram !== TOKEN_2022_PROGRAM) return { size: 165, complete: true };
  let size = 165 + 1 + 4;
  let complete = true;
  if (!mintData) return { size, complete: false };
  const REQUIRED_ACCOUNT_EXT = {
    1: 4 + 8,
    // TransferFeeConfig      -> TransferFeeAmount
    9: 4 + 0,
    // NonTransferable        -> NonTransferableAccount
    14: 4 + 1,
    // TransferHook           -> TransferHookAccount
    26: 4 + 0
    // Pausable               -> PausableAccount
  };
  const KNOWN_MINT_EXT = /* @__PURE__ */ new Set([1, 3, 4, 6, 9, 10, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  let o = 166;
  while (o + 4 <= mintData.length) {
    const type = mintData[o] | mintData[o + 1] << 8;
    const len = mintData[o + 2] | mintData[o + 3] << 8;
    if (type === 0) break;
    size += REQUIRED_ACCOUNT_EXT[type] ?? 0;
    if (!KNOWN_MINT_EXT.has(type)) complete = false;
    o += 4 + len;
  }
  return { size, complete };
}
async function resolveInstructions(tx, connection) {
  const msg2 = tx.message;
  const tables = [];
  for (const l of msg2.addressTableLookups ?? []) {
    const t2 = (await connection.getAddressLookupTable(l.accountKey)).value;
    if (!t2) throw new Error(`lookup table ${l.accountKey.toBase58()} not found`);
    tables.push(t2);
  }
  const keys = msg2.getAccountKeys({ addressLookupTableAccounts: tables });
  return msg2.compiledInstructions.map((ci) => ({
    programId: keys.get(ci.programIdIndex).toBase58(),
    accounts: ci.accountKeyIndexes.map((i) => keys.get(i).toBase58()),
    data: ci.data
  }));
}
async function estimateSolanaSwapCost(swapTransactionB64, payer, connection, opts = { paysOutSolToPayer: false }) {
  let tx;
  try {
    tx = import_web35.VersionedTransaction.deserialize(Buffer.from(swapTransactionB64, "base64"));
  } catch {
    return null;
  }
  const instructions = await resolveInstructions(tx, connection);
  const s = analyzeSolanaInstructions(payer, tx.message.header.numRequiredSignatures, instructions);
  const creates = s.ataCreates;
  const probe = [.../* @__PURE__ */ new Set([...creates.map((c) => c.ata), ...creates.map((c) => c.mint), payer])];
  const infos = await connection.getMultipleAccountsInfo(probe.map((a) => new import_web35.PublicKey(a)));
  const info = new Map(probe.map((a, i) => [a, infos[i]]));
  let complete = s.opaquePrograms.length === 0;
  const reasons = [];
  if (!complete) {
    reasons.push(`the route hands your account to ${s.opaquePrograms.length} program(s) whose internal costs cannot be read before signing`);
  }
  const newAccounts = [];
  const rentBySize = /* @__PURE__ */ new Map();
  const rentFor = async (size) => {
    if (!rentBySize.has(size)) rentBySize.set(size, BigInt(await connection.getMinimumBalanceForRentExemption(size)));
    return rentBySize.get(size);
  };
  const seen = /* @__PURE__ */ new Set();
  for (const c of creates) {
    if (seen.has(c.ata) || info.get(c.ata)) continue;
    seen.add(c.ata);
    const mintInfo = info.get(c.mint);
    const sized = tokenAccountSize(c.tokenProgram, mintInfo ? new Uint8Array(mintInfo.data) : null);
    if (!sized.complete) {
      complete = false;
      reasons.push(`token account size for mint ${c.mint.slice(0, 6)}\u2026 is uncertain`);
    }
    newAccounts.push({
      address: c.ata,
      kind: "token-account",
      mint: c.mint,
      tokenProgram: c.tokenProgram,
      size: sized.size,
      rentLamports: (await rentFor(sized.size)).toString(),
      refundedInTx: s.closedToPayer.includes(c.ata)
    });
  }
  for (const sc of s.systemCreates) {
    newAccounts.push({
      address: sc.address,
      kind: "system-account",
      mint: null,
      tokenProgram: null,
      size: Number(sc.space),
      rentLamports: sc.lamports.toString(),
      refundedInTx: s.closedToPayer.includes(sc.address)
    });
  }
  const rent = newAccounts.reduce((a, n) => a + BigInt(n.rentLamports), 0n);
  const fees = s.baseFeeLamports + s.priorityFeeLamports;
  const required = fees + rent + s.otherTransferLamports + s.wrapLamports;
  const payerInfo = info.get(payer);
  let measured = null;
  let simulationError = null;
  let simulationStatus = "unavailable";
  if (!opts.paysOutSolToPayer && payerInfo) {
    try {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: "base64", addresses: [payer] }
      });
      const post2 = sim.value.accounts?.[0]?.lamports;
      simulationStatus = sim.value.err ? "revert" : "pass";
      if (sim.value.err) simulationError = describeSolanaSimulationFailure(sim.value.err, sim.value.logs ?? []);
      else if (post2 != null) {
        const took = BigInt(payerInfo.lamports) - BigInt(post2);
        if (took >= 0n) measured = took;
      }
    } catch (e) {
      simulationError = e instanceof Error ? e.message : "simulation unavailable";
    }
  }
  return {
    baseFeeLamports: s.baseFeeLamports.toString(),
    priorityFeeLamports: s.priorityFeeLamports.toString(),
    newAccounts,
    rentLamports: rent.toString(),
    otherTransferLamports: s.otherTransferLamports.toString(),
    saleLamports: s.wrapLamports.toString(),
    requiredLamports: required.toString(),
    costLamports: (required - s.wrapLamports).toString(),
    balanceLamports: payerInfo ? String(payerInfo.lamports) : "0",
    complete,
    incompleteReason: reasons.length ? reasons.join("; ") : null,
    measuredLamports: measured != null ? measured.toString() : null,
    simulationError,
    simulationStatus
  };
}

// src/main/swap-proxy.ts
var import_web37 = require("@solana/web3.js");

// src/main/swap-fee.ts
var import_web36 = require("@solana/web3.js");
var JUP_REFERRAL_PROGRAM = new import_web36.PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
var TOKEN_PROGRAM2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM2 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
function deriveJupiterFeeAccount(referralAccount, mint) {
  try {
    const [pda] = import_web36.PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("referral_ata"),
        new import_web36.PublicKey(referralAccount).toBytes(),
        new import_web36.PublicKey(mint).toBytes()
      ],
      JUP_REFERRAL_PROGRAM
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}
async function resolveJupiterFeeAccount(outputMint, config, fetchImpl) {
  const derived = deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, outputMint);
  if (!derived) return { feeAccount: null, reason: "Could not derive a fee account for this token." };
  const doFetch = fetchImpl ?? ((url, init) => fetch(url, init));
  let account = null;
  try {
    const res = await doFetch(heliusRpcUrl(config), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mm-fee-account",
        method: "getAccountInfo",
        params: [derived, { encoding: "jsonParsed" }]
      }),
      signal: AbortSignal.timeout(8e3)
    });
    const body = await res.json().catch(() => null);
    account = body?.result?.value ?? null;
  } catch {
    return {
      feeAccount: null,
      reason: "Could not confirm the Magic Money fee account for this token (Solana RPC unavailable)."
    };
  }
  if (!account) {
    return {
      feeAccount: null,
      reason: "Magic Money has no fee account for this token yet, so this route cannot collect the disclosed fee."
    };
  }
  const owner = account.owner ?? "";
  if (owner !== TOKEN_PROGRAM2 && owner !== TOKEN_2022_PROGRAM2) {
    return { feeAccount: null, reason: "The fee account for this token is not a token account." };
  }
  if (account.data?.parsed?.type !== "account") {
    return { feeAccount: null, reason: "The fee account for this token is not an initialized token account." };
  }
  const mint = account.data?.parsed?.info?.mint ?? "";
  if (mint !== outputMint) {
    return { feeAccount: null, reason: "The fee account for this token holds a different mint." };
  }
  return { feeAccount: derived, reason: null };
}

// src/main/cardano-swap.ts
var import_base9 = require("@scure/base");

// src/main/cardano-plutus-data.ts
var PlutusDataError = class extends Error {
};
var MAX_DEPTH = 64;
var BREAK = Symbol("break");
function readHead(b, off) {
  if (off >= b.length) throw new PlutusDataError("truncated datum");
  const major = b[off] >> 5;
  const ai = b[off] & 31;
  if (ai < 24) return { major, ai, arg: BigInt(ai), next: off + 1 };
  const width = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : 0;
  if (width === 0) {
    if (ai === 31) return { major, ai, arg: -1n, next: off + 1 };
    throw new PlutusDataError("reserved CBOR additional info");
  }
  if (off + 1 + width > b.length) throw new PlutusDataError("truncated datum");
  let arg = 0n;
  for (let i = 0; i < width; i++) arg = arg << 8n | BigInt(b[off + 1 + i]);
  return { major, ai, arg, next: off + 1 + width };
}
function toLength(arg, b) {
  if (arg > BigInt(b.length)) throw new PlutusDataError("length exceeds datum size");
  return Number(arg);
}
function bytesFrom(b, h) {
  if (h.ai === 31) {
    const parts = [];
    let pos = h.next;
    for (; ; ) {
      if (pos >= b.length) throw new PlutusDataError("unterminated byte string");
      if (b[pos] === 255) {
        pos++;
        break;
      }
      const chunk = readHead(b, pos);
      if (chunk.major !== 2 || chunk.ai === 31) throw new PlutusDataError("bad byte-string chunk");
      const len2 = toLength(chunk.arg, b);
      if (chunk.next + len2 > b.length) throw new PlutusDataError("truncated datum");
      parts.push(b.slice(chunk.next, chunk.next + len2));
      pos = chunk.next + len2;
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return { value: out, next: pos };
  }
  const len = toLength(h.arg, b);
  if (h.next + len > b.length) throw new PlutusDataError("truncated datum");
  return { value: b.slice(h.next, h.next + len), next: h.next + len };
}
function readItems(b, h, depth, perItem) {
  const items = [];
  let pos = h.next;
  if (h.ai === 31) {
    for (; ; ) {
      const item = readItem(b, pos, depth + 1);
      if (item.value === BREAK) return { items, next: item.next };
      items.push(item.value);
      pos = item.next;
    }
  }
  const count = toLength(h.arg, b) * perItem;
  for (let i = 0; i < count; i++) {
    const item = readItem(b, pos, depth + 1);
    if (item.value === BREAK) throw new PlutusDataError("unexpected break");
    items.push(item.value);
    pos = item.next;
  }
  return { items, next: pos };
}
function constrIndex(tag) {
  if (tag >= 121n && tag <= 127n) return Number(tag - 121n);
  if (tag >= 1280n && tag <= 1400n) return Number(tag - 1280n) + 7;
  if (tag === 102n) return -1;
  return null;
}
function readItem(b, off, depth) {
  if (depth > MAX_DEPTH) throw new PlutusDataError("datum nested too deeply");
  if (off < b.length && b[off] === 255) return { value: BREAK, next: off + 1 };
  const h = readHead(b, off);
  switch (h.major) {
    case 0:
      return { value: { kind: "int", value: h.arg }, next: h.next };
    case 1:
      return { value: { kind: "int", value: -1n - h.arg }, next: h.next };
    case 2: {
      const r = bytesFrom(b, h);
      return { value: { kind: "bytes", value: r.value }, next: r.next };
    }
    case 4: {
      const r = readItems(b, h, depth, 1);
      return { value: { kind: "list", items: r.items }, next: r.next };
    }
    case 5: {
      const r = readItems(b, h, depth, 2);
      if (r.items.length % 2 !== 0) throw new PlutusDataError("odd map entry count");
      const entries = [];
      for (let i = 0; i < r.items.length; i += 2) entries.push([r.items[i], r.items[i + 1]]);
      return { value: { kind: "map", entries }, next: r.next };
    }
    case 6: {
      if (h.arg === 2n || h.arg === 3n) {
        const inner2 = readItem(b, h.next, depth + 1);
        if (inner2.value === BREAK || inner2.value.kind !== "bytes") throw new PlutusDataError("bad bignum");
        let mag = 0n;
        for (const byte of inner2.value.value) mag = mag << 8n | BigInt(byte);
        return { value: { kind: "int", value: h.arg === 2n ? mag : -1n - mag }, next: inner2.next };
      }
      const index = constrIndex(h.arg);
      if (index == null) throw new PlutusDataError(`tag ${h.arg} is not Plutus Data`);
      const inner = readItem(b, h.next, depth + 1);
      if (inner.value === BREAK) throw new PlutusDataError("unexpected break");
      if (index === -1) {
        const v = inner.value;
        if (v.kind !== "list" || v.items.length !== 2 || v.items[0].kind !== "int" || v.items[1].kind !== "list") {
          throw new PlutusDataError("bad general constructor");
        }
        const idx = v.items[0].value;
        if (idx < 0n || idx > 0xffffffffn) throw new PlutusDataError("constructor index out of range");
        return { value: { kind: "constr", index: Number(idx), fields: v.items[1].items }, next: inner.next };
      }
      if (inner.value.kind !== "list") throw new PlutusDataError("constructor fields must be a list");
      return { value: { kind: "constr", index, fields: inner.value.items }, next: inner.next };
    }
    default:
      throw new PlutusDataError(`CBOR major type ${h.major} is not Plutus Data`);
  }
}
function decodePlutusData(bytes) {
  const r = readItem(bytes, 0, 0);
  if (r.value === BREAK) throw new PlutusDataError("unexpected break");
  if (r.next !== bytes.length) throw new PlutusDataError("trailing bytes after datum");
  return r.value;
}
function asConstr(d, what, index, arity) {
  if (d.kind !== "constr") throw new PlutusDataError(`${what}: expected a constructor`);
  if (index != null && d.index !== index) throw new PlutusDataError(`${what}: unexpected constructor ${d.index}`);
  if (arity != null && d.fields.length !== arity) throw new PlutusDataError(`${what}: expected ${arity} fields`);
  return d.fields;
}
function asInt(d, what) {
  if (d.kind !== "int") throw new PlutusDataError(`${what}: expected an integer`);
  return d.value;
}
function asBytes(d, what, length) {
  if (d.kind !== "bytes") throw new PlutusDataError(`${what}: expected bytes`);
  if (length != null && d.value.length !== length) throw new PlutusDataError(`${what}: expected ${length} bytes`);
  return d.value;
}
function asList(d, what) {
  if (d.kind !== "list") throw new PlutusDataError(`${what}: expected a list`);
  return d.items;
}
function asBool(d, what) {
  if (d.kind !== "constr" || d.fields.length !== 0 || d.index !== 0 && d.index !== 1) {
    throw new PlutusDataError(`${what}: expected a Bool`);
  }
  return d.index === 1;
}

// src/main/danogo-clmm.ts
var DANOGO_CLMM = {
  /** Pool validator; also the pool NFT's minting policy and the withdraw-zero credential. */
  poolScriptHash: "d8b69fc53637bcfadbc4469083f706bc293f4d9d2296646c5ca167bb",
  /** Reference input carrying the pool script. */
  poolScriptRef: "64d111b957e7d7848ffdde5149aa77fa4090a7fa1ad0ac108067900614848501#0",
  /** Reference input carrying the protocol config datum. */
  protocolConfigRef: "2cafd7c92f7093e5229af274be83dea660b0590b4174bbed79ba662b44fbd1ee#0",
  /**
   * protocol_config.swap_fee: lovelace every swap adds to the pool's
   * total_swap_fee. A changed config lives at a NEW reference UTxO, so the pinned
   * reference above fails closed before a different fee could be charged.
   */
  swapFeeLovelace: 100000n,
  /** protocol_config.platform_fee_rate, in basis points of the LP fee. */
  platformFeeRate: 1000n,
  /** ADA every ADA-pool UTxO keeps out of its tradable reserve. */
  poolMinAdaLovelace: 3000000n
};
var SWAP_ACTION = 3;
var DanogoError = class extends Error {
};
var hex4 = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function tupleAsset(fields, what) {
  if (fields.length !== 2) throw new PlutusDataError(`${what}: expected [policy, name]`);
  const policy = asBytes(fields[0], `${what} policy`);
  const name = asBytes(fields[1], `${what} name`);
  if (policy.length === 0) {
    if (name.length !== 0) throw new PlutusDataError(`${what}: ADA with an asset name`);
    return CARDANO_LOVELACE;
  }
  if (policy.length !== 28 || name.length > 32) throw new PlutusDataError(`${what}: malformed asset`);
  return hex4(policy) + hex4(name);
}
function asTupleAsset(d, what) {
  if (d.kind === "list") return tupleAsset(d.items, what);
  return tupleAsset(asConstr(d, what, 0), what);
}
function rational(d, what) {
  const f = asConstr(d, what, 0, 2);
  const num = asInt(f[0], `${what} numerator`);
  const den = asInt(f[1], `${what} denominator`);
  if (num <= 0n || den <= 0n) throw new PlutusDataError(`${what}: not a positive rational`);
  return [num, den];
}
function decodeDanogoPoolDatum(datumBytes) {
  try {
    const f = asConstr(decodePlutusData(datumBytes), "PoolDatum", 0, 12);
    return {
      tokenX: asTupleAsset(f[0], "token_X"),
      tokenY: asTupleAsset(f[1], "token_Y"),
      lpFeeRate: asInt(f[2], "lp_fee_rate"),
      platformFeeX: asInt(f[3], "platform_fee_X"),
      platformFeeY: asInt(f[4], "platform_fee_Y"),
      totalSwapFee: asInt(f[5], "total_swap_fee"),
      sqrtLowerPrice: rational(f[6], "sqrt_lower_price"),
      sqrtUpperPrice: rational(f[7], "sqrt_upper_price"),
      minXChange: asInt(f[8], "min_x_change"),
      minYChange: asInt(f[9], "min_y_change"),
      circulatingLpToken: asInt(f[10], "circulating_lp_token"),
      lastWithdrawEpoch: asInt(f[11], "last_withdraw_epoch")
    };
  } catch (e) {
    if (e instanceof PlutusDataError) throw new DanogoError(`Danogo pool datum: ${e.message}`);
    throw e;
  }
}
function decodeDanogoSwapRedeemer(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new DanogoError("Danogo redeemer is not a byte array");
  if (bytes.length !== 36) throw new DanogoError("Danogo redeemer is not a single-pool swap");
  if (bytes[1] !== SWAP_ACTION) throw new DanogoError("Danogo redeemer is not a swap");
  let delta = 0n;
  for (let i = 4; i < 36; i++) delta = delta << 8n | BigInt(bytes[i]);
  if (bytes[4] & 128) delta -= 1n << 256n;
  if (delta === 0n) throw new DanogoError("Danogo redeemer swaps nothing");
  return { inIdx: bytes[0], poolInIdx: bytes[2], poolOutIdx: bytes[3], delta };
}

// src/main/minswap-client.ts
var MINSWAP_AGGREGATOR_URL = "https://agg-api.minswap.org/aggregator";
var QUOTE_TTL_MS = 6e4;
var MinswapQuoteError = class extends Error {
};
var UINT = /^[0-9]+$/;
var unit = (u) => normalizeSwapAddress("cardano", String(u ?? ""));
function approvedFloor(buyAmountRaw, slippageBps) {
  return BigInt(buyAmountRaw) * BigInt(1e4 - slippageBps) / 10000n;
}
function termsFromEstimate(req, est, protocol = "MinswapV2") {
  const bad = (why) => {
    throw new MinswapQuoteError(`Minswap returned an unusable route: ${why}.`);
  };
  if (protocol === "DanogoCLMMV1") return danogoTermsFromEstimate(req, est, bad);
  if (unit(est.token_in) !== unit(req.token_in) || unit(est.token_out) !== unit(req.token_out)) bad("different tokens");
  if (String(est.amount_in ?? "") !== req.amount) bad("a different sell amount");
  for (const [name, v] of [
    ["amount_out", est.amount_out],
    ["min_amount_out", est.min_amount_out],
    ["total_dex_fee", est.total_dex_fee],
    ["deposits", est.deposits]
  ]) {
    if (typeof v !== "string" || !UINT.test(v)) bad(`missing ${name}`);
  }
  const aggregatorFee = est.aggregator_fee == null ? "0" : String(est.aggregator_fee);
  if (!UINT.test(aggregatorFee)) bad("a malformed aggregator fee");
  if (BigInt(est.amount_out) <= 0n || BigInt(est.min_amount_out) <= 0n) bad("no output");
  if (!Array.isArray(est.paths) || est.paths.length !== 1) bad("the route is split across several orders");
  const steps = est.paths[0];
  if (!Array.isArray(steps) || steps.length === 0) bad("an empty route");
  const path = [unit(steps[0].token_in)];
  steps.forEach((s, i) => {
    if (s.protocol !== "MinswapV2") bad(`hop ${i + 1} uses ${s.protocol ?? "an unknown protocol"}, not Minswap V2`);
    if (unit(s.token_in) !== path[path.length - 1]) bad(`hop ${i + 1} does not continue the route`);
    const next = unit(s.token_out);
    if (!isValidSwapAddress("cardano", next)) bad(`hop ${i + 1} names an invalid token`);
    path.push(next);
  });
  if (path[0] !== unit(req.token_in) || path[path.length - 1] !== unit(req.token_out)) bad("the route ends at a different token");
  if (new Set(path).size !== path.length) bad("the route revisits a token");
  return {
    buyAmountRaw: est.amount_out,
    minBuyAmountRaw: est.min_amount_out,
    hops: steps.length,
    priceImpactPct: typeof est.avg_price_impact === "number" && Number.isFinite(est.avg_price_impact) ? est.avg_price_impact : 0,
    terms: {
      protocol: "MinswapV2",
      path,
      batcherFeeLovelace: est.total_dex_fee,
      depositLovelace: est.deposits,
      aggregatorFeeLovelace: aggregatorFee
    }
  };
}
function danogoTermsFromEstimate(req, est, bad) {
  if (unit(est.token_in) !== unit(req.token_in) || unit(est.token_out) !== unit(req.token_out)) bad("different tokens");
  if (String(est.amount_in ?? "") !== req.amount) bad("a different sell amount");
  for (const [name, v] of [
    ["amount_out", est.amount_out],
    ["min_amount_out", est.min_amount_out],
    ["total_dex_fee", est.total_dex_fee],
    ["deposits", est.deposits]
  ]) {
    if (typeof v !== "string" || !UINT.test(v)) bad(`missing ${name}`);
  }
  const aggregatorFee = est.aggregator_fee == null ? "0" : String(est.aggregator_fee);
  if (!UINT.test(aggregatorFee)) bad("a malformed aggregator fee");
  if (est.deposits !== "0") bad("a Danogo swap with a deposit");
  if (BigInt(est.total_dex_fee) !== DANOGO_CLMM.swapFeeLovelace) bad("a Danogo swap fee different from the protocol's");
  if (!Array.isArray(est.paths) || est.paths.length !== 1) bad("the route is split across several pools");
  const steps = est.paths[0];
  if (!Array.isArray(steps) || steps.length !== 1) bad("the route crosses more than one Danogo pool");
  if (steps[0].protocol !== "DanogoCLMMV1") bad(`the route uses ${steps[0].protocol ?? "an unknown protocol"}, not Danogo`);
  const sell = unit(steps[0].token_in);
  const buy = unit(steps[0].token_out);
  if (sell !== unit(req.token_in) || buy !== unit(req.token_out)) bad("the route ends at a different token");
  if (sell === CARDANO_LOVELACE === (buy === CARDANO_LOVELACE)) bad("only Danogo swaps between ADA and a token are supported");
  const delivered = BigInt(est.amount_out) - (buy === CARDANO_LOVELACE ? DANOGO_CLMM.swapFeeLovelace : 0n);
  if (delivered <= 0n) bad("no output");
  return {
    buyAmountRaw: delivered.toString(),
    minBuyAmountRaw: delivered.toString(),
    hops: 1,
    priceImpactPct: typeof est.avg_price_impact === "number" && Number.isFinite(est.avg_price_impact) ? est.avg_price_impact : 0,
    terms: {
      protocol: "DanogoCLMMV1",
      path: [sell, buy],
      batcherFeeLovelace: "0",
      depositLovelace: "0",
      aggregatorFeeLovelace: aggregatorFee,
      dexFeeLovelace: DANOGO_CLMM.swapFeeLovelace.toString()
    }
  };
}
async function post(fetchFn, path, body) {
  const res = await fetchFn(`${MINSWAP_AGGREGATOR_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15e3)
  });
  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    throw new MinswapQuoteError("Minswap is limiting requests from this device. Wait a minute, then refresh the quote.");
  }
  if (!res.ok || !data) {
    const why = data && typeof data.message === "string" ? data.message.slice(0, 200) : `HTTP ${res.status}`;
    throw new MinswapQuoteError(`Minswap could not quote this swap: ${why}`);
  }
  return data;
}
async function minswapQuoteDirect(input, fetchFn) {
  const sell = unit(input.sellUnit);
  const buy = unit(input.buyUnit);
  if (!isValidSwapAddress("cardano", sell) || !isValidSwapAddress("cardano", buy)) {
    throw new MinswapQuoteError("Not a Cardano token.");
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps <= 0 || input.slippageBps >= 1e4) {
    throw new MinswapQuoteError("Invalid slippage for a Minswap order.");
  }
  const protocol = input.protocol ?? "MinswapV2";
  const danogo = protocol === "DanogoCLMMV1";
  const request = (slippagePct) => ({
    amount: input.sellAmountRaw,
    token_in: sell,
    token_out: buy,
    slippage: slippagePct,
    allow_multi_hops: !danogo,
    include_protocols: [protocol]
  });
  let req = request(input.slippageBps / 100);
  let est = await post(fetchFn, "estimate", req);
  let terms = termsFromEstimate(req, est, protocol);
  const floorHolds = (t2) => BigInt(t2.minBuyAmountRaw) >= approvedFloor(t2.buyAmountRaw, input.slippageBps);
  if (!danogo && !floorHolds(terms) && terms.hops > 1) {
    req = request(input.slippageBps / 100 / terms.hops);
    est = await post(fetchFn, "estimate", req);
    terms = termsFromEstimate(req, est, protocol);
  }
  if (!floorHolds(terms)) {
    throw new MinswapQuoteError("Minswap's minimum for this route is looser than your slippage setting, so it is not offered.");
  }
  const built = await post(fetchFn, "build-tx", {
    sender: input.sender,
    // Minswap's OWN floor for the estimate, unchanged (see above). For Danogo
    // the wallet's floor is the delivered amount, checked in the transaction.
    min_amount_out: danogo ? est.min_amount_out : terms.minBuyAmountRaw,
    estimate: req
  });
  if (typeof built.cbor !== "string" || !/^([0-9a-fA-F]{2})+$/.test(built.cbor)) {
    throw new MinswapQuoteError("Minswap did not return a transaction to sign.");
  }
  const ada = (name, amountRaw) => ({
    name,
    tokenSymbol: "ADA",
    tokenDecimals: 6,
    amountRaw,
    includedInQuotedOutput: false
  });
  const externalFees = danogo ? [{ ...ada("Danogo swap fee", terms.terms.dexFeeLovelace), includedInQuotedOutput: buy === CARDANO_LOVELACE }] : [ada("Minswap batcher fee", terms.terms.batcherFeeLovelace)];
  if (terms.terms.aggregatorFeeLovelace !== "0") externalFees.push(ada("Minswap aggregator fee", terms.terms.aggregatorFeeLovelace));
  const sellNum = Number(input.sellAmountRaw);
  return {
    provider: "minswap",
    fromChain: "cardano",
    toChain: "cardano",
    fromTokenAddress: sell === CARDANO_LOVELACE ? CARDANO_LOVELACE : sell,
    toTokenAddress: buy,
    fromTokenSymbol: input.fromSymbol,
    toTokenSymbol: input.toSymbol,
    sellAmountRaw: input.sellAmountRaw,
    buyAmountRaw: terms.buyAmountRaw,
    minBuyAmountRaw: terms.minBuyAmountRaw,
    // The floor is written into the order datum, and the batcher cannot pay
    // less; the wallet reads it back out of the transaction before signing.
    minReceivedSource: "provider",
    estimatedGasRaw: "0",
    slippageBps: input.slippageBps,
    priceImpactPct: terms.priceImpactPct,
    rate: sellNum > 0 ? Number(terms.buyAmountRaw) / sellNum : 0,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    isCrossChain: false,
    toAddress: input.sender,
    bridgeTool: danogo ? "Danogo CLMM" : "Minswap V2",
    estimatedDurationSec: danogo ? 30 : 60,
    feeBps: 0,
    // Minswap's API has no integrator fee, so this route carries no Magic Money
    // fee and is never counted as revenue. Its own fees are reported separately.
    appFee: feeFreeRecord("minswap", "cardano", "Minswap aggregator has no integrator fee mechanism"),
    externalFees,
    requestId: null,
    txData: { cbor: built.cbor.toLowerCase() },
    approvalTx: null,
    cardanoOrder: terms.terms
  };
}
var SEARCH_TTL_MS = 5 * 6e4;

// src/main/cardano-swap-validate.ts
var import_blake2b6 = require("@noble/hashes/blake2b");

// src/main/cardano-tx-inspect.ts
var import_base8 = require("@scure/base");
var import_blake2b5 = require("@noble/hashes/blake2b");

// src/main/cardano-cip30.ts
var import_blake2b4 = require("@noble/hashes/blake2b");
var import_bip392 = require("@scure/bip39");
var import_english3 = require("@scure/bip39/wordlists/english");

// src/main/cardano-tx-inspect.ts
var CborMap = class {
  constructor(entries = []) {
    this.entries = entries;
  }
  /** Lookup by integer key — the tx body, output and value maps are all int-keyed. */
  getInt(key) {
    for (const [k, v] of this.entries) if (typeof k === "bigint" && k === BigInt(key)) return v;
    return void 0;
  }
  get size() {
    return this.entries.length;
  }
};
var CborError = class extends Error {
};
var BREAK2 = Symbol("cbor-break");
var MAX_DEPTH2 = 96;
function readHead2(b, off) {
  if (off >= b.length) throw new CborError("unexpected end of input");
  const ai = b[off] & 31;
  const need = (n) => {
    if (off + n >= b.length) throw new CborError("truncated head");
  };
  if (ai < 24) return { arg: BigInt(ai), next: off + 1, indefinite: false };
  if (ai === 24) {
    need(1);
    return { arg: BigInt(b[off + 1]), next: off + 2, indefinite: false };
  }
  if (ai === 25) {
    need(2);
    return { arg: BigInt(b[off + 1]) << 8n | BigInt(b[off + 2]), next: off + 3, indefinite: false };
  }
  if (ai === 26) {
    need(4);
    let v = 0n;
    for (let i = 1; i <= 4; i++) v = v << 8n | BigInt(b[off + i]);
    return { arg: v, next: off + 5, indefinite: false };
  }
  if (ai === 27) {
    need(8);
    let v = 0n;
    for (let i = 1; i <= 8; i++) v = v << 8n | BigInt(b[off + i]);
    return { arg: v, next: off + 9, indefinite: false };
  }
  if (ai === 31) return { arg: 0n, next: off + 1, indefinite: true };
  throw new CborError(`reserved additional info ${ai}`);
}
function concatBytes(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
function decodeItem(b, off, depth) {
  if (depth > MAX_DEPTH2) throw new CborError("nesting too deep");
  if (off >= b.length) throw new CborError("unexpected end of input");
  const mt = b[off] >> 5;
  const head = readHead2(b, off);
  switch (mt) {
    case 0:
      return { value: head.arg, next: head.next };
    case 1:
      return { value: -1n - head.arg, next: head.next };
    case 2: {
      if (head.indefinite) {
        const chunks = [];
        let pos = head.next;
        for (; ; ) {
          const item = decodeItem(b, pos, depth + 1);
          pos = item.next;
          if (item.value === BREAK2) break;
          if (!(item.value instanceof Uint8Array)) throw new CborError("bad byte-string chunk");
          chunks.push(item.value);
        }
        return { value: concatBytes(chunks), next: pos };
      }
      const len = Number(head.arg);
      if (head.next + len > b.length) throw new CborError("truncated byte string");
      return { value: b.slice(head.next, head.next + len), next: head.next + len };
    }
    case 3: {
      if (head.indefinite) {
        let text = "";
        let pos = head.next;
        for (; ; ) {
          const item = decodeItem(b, pos, depth + 1);
          pos = item.next;
          if (item.value === BREAK2) break;
          if (typeof item.value !== "string") throw new CborError("bad text chunk");
          text += item.value;
        }
        return { value: text, next: pos };
      }
      const len = Number(head.arg);
      if (head.next + len > b.length) throw new CborError("truncated text string");
      return { value: new TextDecoder().decode(b.slice(head.next, head.next + len)), next: head.next + len };
    }
    case 4: {
      const items = [];
      let pos = head.next;
      if (head.indefinite) {
        for (; ; ) {
          const item = decodeItem(b, pos, depth + 1);
          pos = item.next;
          if (item.value === BREAK2) break;
          items.push(item.value);
        }
      } else {
        const n = Number(head.arg);
        for (let i = 0; i < n; i++) {
          const item = decodeItem(b, pos, depth + 1);
          if (item.value === BREAK2) throw new CborError("unexpected break in array");
          items.push(item.value);
          pos = item.next;
        }
      }
      return { value: items, next: pos };
    }
    case 5: {
      const entries = [];
      let pos = head.next;
      if (head.indefinite) {
        for (; ; ) {
          const k = decodeItem(b, pos, depth + 1);
          pos = k.next;
          if (k.value === BREAK2) break;
          const v = decodeItem(b, pos, depth + 1);
          if (v.value === BREAK2) throw new CborError("unexpected break in map");
          pos = v.next;
          entries.push([k.value, v.value]);
        }
      } else {
        const n = Number(head.arg);
        for (let i = 0; i < n; i++) {
          const k = decodeItem(b, pos, depth + 1);
          if (k.value === BREAK2) throw new CborError("unexpected break in map");
          const v = decodeItem(b, k.next, depth + 1);
          if (v.value === BREAK2) throw new CborError("unexpected break in map");
          entries.push([k.value, v.value]);
          pos = v.next;
        }
      }
      return { value: new CborMap(entries), next: pos };
    }
    case 6: {
      const inner = decodeItem(b, head.next, depth + 1);
      if (inner.value === BREAK2) throw new CborError("unexpected break after tag");
      if ((head.arg === 2n || head.arg === 3n) && inner.value instanceof Uint8Array) {
        let magnitude = 0n;
        for (const byte of inner.value) magnitude = magnitude << 8n | BigInt(byte);
        return { value: head.arg === 2n ? magnitude : -1n - magnitude, next: inner.next };
      }
      return { value: inner.value, next: inner.next };
    }
    case 7: {
      const ai = b[off] & 31;
      if (ai === 20) return { value: false, next: head.next };
      if (ai === 21) return { value: true, next: head.next };
      if (ai === 22 || ai === 23) return { value: null, next: head.next };
      if (ai === 31) return { value: BREAK2, next: off + 1 };
      if (ai === 25) return { value: null, next: off + 3 };
      if (ai === 26) return { value: null, next: off + 5 };
      if (ai === 27) return { value: null, next: off + 9 };
      return { value: null, next: head.next };
    }
    default:
      throw new CborError(`unsupported major type ${mt}`);
  }
}
function decodeCbor(bytes) {
  const { value } = decodeItem(bytes, 0, 0);
  if (value === BREAK2) throw new CborError("unexpected break at top level");
  return value;
}

// src/main/minswap-v2-order.ts
var import_sha33 = require("@noble/hashes/sha3");
var MINSWAP_V2 = {
  orderScriptHash: "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c",
  /** LP token policy — the `authen` minting policy the pool validator uses. */
  lpPolicyId: "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c"
};
var MinswapOrderError = class extends Error {
};
var hex5 = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
var hexToBytes2 = (h) => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
function credential(d, what) {
  if (d.kind !== "constr" || d.index !== 0 && d.index !== 1) {
    throw new PlutusDataError(`${what}: expected a credential`);
  }
  const [h] = asConstr(d, what, d.index, 1);
  return { kind: d.index === 0 ? "key" : "script", hash: hex5(asBytes(h, what, 28)) };
}
function address(d, what) {
  const [pay, stakeOpt] = asConstr(d, what, 0, 2);
  const payment = credential(pay, `${what} payment`);
  if (stakeOpt.kind !== "constr") throw new PlutusDataError(`${what}: bad stake option`);
  if (stakeOpt.index === 1) {
    asConstr(stakeOpt, `${what} stake`, 1, 0);
    return { payment, stake: null };
  }
  const [stakeCred] = asConstr(stakeOpt, `${what} stake`, 0, 1);
  const [inner] = asConstr(stakeCred, `${what} stake credential`, 0, 1);
  return { payment, stake: credential(inner, `${what} stake`) };
}
function hasExtraDatum(d, what) {
  if (d.kind !== "constr" || d.index < 0 || d.index > 2) throw new PlutusDataError(`${what}: bad extra datum`);
  if (d.index === 0) {
    asConstr(d, what, 0, 0);
    return false;
  }
  asConstr(d, what, d.index, 1);
  return true;
}
function swapAmount(d, what) {
  if (d.kind !== "constr" || d.index !== 0) {
    throw new PlutusDataError(`${what}: only a specific swap amount is accepted`);
  }
  const [amount] = asConstr(d, what, 0, 1);
  return asInt(amount, what);
}
function asset(d, what) {
  const [pid, name] = asConstr(d, what, 0, 2);
  return { policyId: hex5(asBytes(pid, `${what} policy`)), assetName: hex5(asBytes(name, `${what} name`)) };
}
function decodeMinswapV2OrderDatum(datumBytes) {
  try {
    const fields = asConstr(decodePlutusData(datumBytes), "OrderDatum", 0, 9);
    const lpAsset = asset(fields[5], "lp_asset");
    const step = fields[6];
    if (step.kind !== "constr") throw new PlutusDataError("step: expected a constructor");
    let stepKind;
    let routing;
    let amount;
    let minimumReceive;
    let killable = null;
    if (step.index === 0) {
      const [dir, amt, min, kill] = asConstr(step, "SwapExactIn", 0, 4);
      stepKind = "swap-exact-in";
      routing = [{ lpAssetName: lpAsset.assetName, aToB: asBool(dir, "a_to_b_direction") }];
      amount = swapAmount(amt, "swap_amount_option");
      minimumReceive = asInt(min, "minimum_receive");
      killable = asBool(kill, "killable");
      if (lpAsset.policyId !== MINSWAP_V2.lpPolicyId) throw new PlutusDataError("lp_asset: not a Minswap V2 LP token");
    } else if (step.index === 9) {
      const [routes, amt, min] = asConstr(step, "SwapMultiRouting", 9, 3);
      stepKind = "swap-multi-routing";
      routing = asList(routes, "routings").map((r, i) => {
        const [lp, dir] = asConstr(r, `routing[${i}]`, 0, 2);
        const a = asset(lp, `routing[${i}].lp_asset`);
        if (a.policyId !== MINSWAP_V2.lpPolicyId) throw new PlutusDataError(`routing[${i}]: not a Minswap V2 LP token`);
        return { lpAssetName: a.assetName, aToB: asBool(dir, `routing[${i}].a_to_b_direction`) };
      });
      if (routing.length < 2) throw new PlutusDataError("SwapMultiRouting: fewer than two hops");
      if (lpAsset.policyId !== MINSWAP_V2.lpPolicyId || lpAsset.assetName !== routing[0].lpAssetName) {
        throw new PlutusDataError("lp_asset does not match the first routing pool");
      }
      amount = swapAmount(amt, "swap_amount_option");
      minimumReceive = asInt(min, "minimum_receive");
    } else {
      throw new PlutusDataError(`order step ${step.index} is not a plain swap`);
    }
    const expiryOpt = fields[8];
    let expiry = null;
    if (expiryOpt.kind !== "constr") throw new PlutusDataError("expiry: bad option");
    if (expiryOpt.index === 0) {
      const [pair] = asConstr(expiryOpt, "expiry", 0, 1);
      const items = asList(pair, "expiry tuple");
      if (items.length !== 2) throw new PlutusDataError("expiry: expected a pair");
      expiry = { expiresAtMs: asInt(items[0], "expiry time"), maxTip: asInt(items[1], "expiry tip") };
    } else {
      asConstr(expiryOpt, "expiry", 1, 0);
    }
    return {
      canceller: credential(fields[0], "canceller"),
      refundReceiver: address(fields[1], "refund_receiver"),
      refundReceiverHasDatum: hasExtraDatum(fields[2], "refund_receiver_datum"),
      successReceiver: address(fields[3], "success_receiver"),
      successReceiverHasDatum: hasExtraDatum(fields[4], "success_receiver_datum"),
      lpAsset,
      stepKind,
      routing,
      swapAmount: amount,
      minimumReceive,
      killable,
      maxBatcherFee: asInt(fields[7], "max_batcher_fee"),
      expiry
    };
  } catch (e) {
    if (e instanceof PlutusDataError) throw new MinswapOrderError(`Minswap order datum: ${e.message}`);
    throw e;
  }
}
function assetIdentBytes(unit2) {
  if (unit2 === CARDANO_LOVELACE) return new Uint8Array(0);
  const split = splitCardanoUnit(unit2);
  if (!split) throw new MinswapOrderError(`not a Cardano asset unit: ${unit2}`);
  return hexToBytes2(split.policyId + split.assetNameHex);
}
function sortKey(unit2) {
  if (unit2 === CARDANO_LOVELACE) return ["", ""];
  const split = splitCardanoUnit(unit2);
  if (!split) throw new MinswapOrderError(`not a Cardano asset unit: ${unit2}`);
  return [split.policyId, split.assetNameHex];
}
function sortsBefore(a, b) {
  const [pa, na] = sortKey(a);
  const [pb, nb] = sortKey(b);
  return pa === pb ? na < nb : pa < pb;
}
function minswapV2Pool(unitX, unitY) {
  if (unitX === unitY) throw new MinswapOrderError("a pool cannot trade an asset for itself");
  const [assetA, assetB] = sortsBefore(unitX, unitY) ? [unitX, unitY] : [unitY, unitX];
  const identA = (0, import_sha33.sha3_256)(assetIdentBytes(assetA));
  const identB = (0, import_sha33.sha3_256)(assetIdentBytes(assetB));
  const pair = new Uint8Array(64);
  pair.set(identA, 0);
  pair.set(identB, 32);
  return { assetA, assetB, lpAssetName: hex5((0, import_sha33.sha3_256)(pair)) };
}
function verifyMinswapV2Route(order, path) {
  if (path.length !== order.routing.length + 1) {
    throw new MinswapOrderError(
      `route has ${order.routing.length} hop(s) but the quote described ${Math.max(0, path.length - 1)}`
    );
  }
  order.routing.forEach((hop, i) => {
    const from = path[i];
    const to = path[i + 1];
    const pool = minswapV2Pool(from, to);
    if (pool.lpAssetName !== hop.lpAssetName) {
      throw new MinswapOrderError(`hop ${i + 1} names a pool that does not trade ${from} for ${to}`);
    }
    const expectedAToB = pool.assetA === from;
    if (hop.aToB !== expectedAToB) {
      throw new MinswapOrderError(`hop ${i + 1} swaps in the wrong direction`);
    }
  });
}

// src/main/cardano-swap-validate.ts
var CardanoSwapValidationError = class extends Error {
};
var MINSWAP_AGGREGATOR_FEE_KEY_HASH = "a6392a798b36808a3a61790070a1971f606c6ae682ee084bdf1e27ee";
var CARDANO_SWAP_LIMITS = {
  /** Network fee. Measured 0.248 ADA for a 2-input order. */
  maxTxFeeLovelace: 2000000n,
  /** Batcher fee committed in the datum. Measured 2 ADA for a 2-hop route. */
  maxBatcherFeeLovelace: 5000000n,
  /** Refundable ADA locked with the order. Measured 2 ADA. */
  maxDepositLovelace: 5000000n,
  /** Aggregator fee. Measured 0.85-1 ADA. */
  maxAggregatorFeeLovelace: 5000000n,
  /** The transaction must stay valid at least this long after checking. */
  minValiditySlots: 60n,
  /** …and must not be valid absurdly far ahead (Minswap builds ~3 h). */
  maxValiditySlots: 6n * 3600n
};
var fail = (why) => {
  throw new CardanoSwapValidationError(why);
};
var hex6 = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function hexToBytesStrict(value) {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})+$/.test(value)) fail("transaction is not hex");
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function cborItemEnd(b, off, depth = 0) {
  if (depth > 128) fail("transaction nested too deeply");
  if (off >= b.length) fail("transaction is truncated");
  const major = b[off] >> 5;
  const ai = b[off] & 31;
  let pos = off + 1;
  let arg = 0;
  const indefinite = ai === 31;
  if (ai < 24) arg = ai;
  else if (ai >= 24 && ai <= 27) {
    const width = 1 << ai - 24;
    if (pos + width > b.length) fail("transaction is truncated");
    let v = 0n;
    for (let i = 0; i < width; i++) v = v << 8n | BigInt(b[pos + i]);
    pos += width;
    if ((major === 2 || major === 3 || major === 4 || major === 5) && v > BigInt(b.length)) fail("length exceeds transaction size");
    arg = Number(v > BigInt(Number.MAX_SAFE_INTEGER) ? 0n : v);
  } else if (!indefinite) fail("reserved CBOR encoding");
  switch (major) {
    case 0:
    case 1:
      return pos;
    case 7:
      if (indefinite) fail("unexpected break");
      return pos;
    case 2:
    case 3: {
      if (!indefinite) {
        if (pos + arg > b.length) fail("transaction is truncated");
        return pos + arg;
      }
      while (b[pos] !== 255) {
        if (pos >= b.length) fail("transaction is truncated");
        pos = cborItemEnd(b, pos, depth + 1);
      }
      return pos + 1;
    }
    case 4:
    case 5: {
      if (indefinite) {
        while (b[pos] !== 255) {
          if (pos >= b.length) fail("transaction is truncated");
          pos = cborItemEnd(b, pos, depth + 1);
        }
        return pos + 1;
      }
      const n = major === 5 ? arg * 2 : arg;
      for (let i = 0; i < n; i++) pos = cborItemEnd(b, pos, depth + 1);
      return pos;
    }
    case 6:
      return cborItemEnd(b, pos, depth + 1);
    default:
      return fail("unknown CBOR major type");
  }
}
function splitTxRoot(tx) {
  if (tx[0] !== 132) fail("transaction root is not a 4-element array");
  const parts = [];
  let pos = 1;
  for (let i = 0; i < 4; i++) {
    const end = cborItemEnd(tx, pos);
    parts.push(tx.slice(pos, end));
    pos = end;
  }
  if (pos !== tx.length) fail("trailing bytes after the transaction");
  return { body: parts[0], witnessSet: parts[1], isValid: parts[2], auxData: parts[3] };
}
function txIdOf(body) {
  return hex6((0, import_blake2b6.blake2b)(body, { dkLen: 32 }));
}
function strictValue(v, what) {
  if (typeof v === "bigint") {
    if (v < 0n) fail(`${what}: negative coin`);
    return { lovelace: v, assets: /* @__PURE__ */ new Map() };
  }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "bigint" || !(v[1] instanceof CborMap)) {
    return fail(`${what}: malformed value`);
  }
  if (v[0] < 0n) fail(`${what}: negative coin`);
  const assets = /* @__PURE__ */ new Map();
  for (const [policy, names] of v[1].entries) {
    if (!(policy instanceof Uint8Array) || policy.length !== 28 || !(names instanceof CborMap)) fail(`${what}: malformed multi-asset`);
    for (const [name, qty] of names.entries) {
      if (!(name instanceof Uint8Array) || name.length > 32 || typeof qty !== "bigint" || qty <= 0n) {
        fail(`${what}: malformed asset quantity`);
      }
      const unit2 = hex6(policy) + hex6(name);
      if (assets.has(unit2)) fail(`${what}: duplicate asset`);
      assets.set(unit2, qty);
    }
  }
  return { lovelace: v[0], assets };
}
function strictOutput(item, i) {
  const what = `output ${i}`;
  if (Array.isArray(item)) {
    if (item.length !== 2 || !(item[0] instanceof Uint8Array)) return fail(`${what}: unexpected legacy output`);
    return { addressBytes: item[0], value: strictValue(item[1], what), inlineDatum: null };
  }
  if (!(item instanceof CborMap)) return fail(`${what}: malformed output`);
  let addressBytes = null;
  let value = null;
  let inlineDatum = null;
  for (const [k, v] of item.entries) {
    if (k === 0n && v instanceof Uint8Array) addressBytes = v;
    else if (k === 1n) value = strictValue(v, what);
    else if (k === 2n) {
      if (!Array.isArray(v) || v.length !== 2 || v[0] !== 1n || !(v[1] instanceof Uint8Array)) {
        fail(`${what}: only an inline datum is accepted`);
      }
      inlineDatum = v[1];
    } else if (k === 3n) fail(`${what}: carries a reference script`);
    else fail(`${what}: unknown output field`);
  }
  if (!addressBytes || !value) return fail(`${what}: missing address or value`);
  return { addressBytes, value, inlineDatum };
}
function strictInputs(v, what) {
  if (!Array.isArray(v) || v.length === 0) return fail(`${what}: missing`);
  const seen = /* @__PURE__ */ new Set();
  for (const entry of v) {
    if (!Array.isArray(entry) || entry.length !== 2 || !(entry[0] instanceof Uint8Array) || entry[0].length !== 32 || typeof entry[1] !== "bigint" || entry[1] < 0n) {
      fail(`${what}: malformed input`);
    }
    const key = `${hex6(entry[0])}#${entry[1]}`;
    if (seen.has(key)) fail(`${what}: duplicate input`);
    seen.add(key);
  }
  return [...seen];
}
function walletKeys(address2, network) {
  let bytes;
  try {
    bytes = decodeCardanoAddress(address2);
  } catch {
    return fail("wallet Cardano address is invalid");
  }
  if (bytes.length !== 57 || bytes[0] >> 4 !== 0) fail("wallet Cardano address is not a base address");
  const networkNibble = bytes[0] & 15;
  if (networkNibble !== (network === "mainnet" ? 1 : 0)) fail("wallet address is for a different Cardano network");
  return {
    paymentKeyHash: hex6(bytes.slice(1, 29)),
    stakeKeyHash: hex6(bytes.slice(29, 57)),
    networkNibble,
    bytes: hex6(bytes)
  };
}
function roleOf(addr, w) {
  if ((addr[0] & 15) !== w.networkNibble) fail("an output is addressed to a different Cardano network");
  const type = addr[0] >> 4;
  if (hex6(addr) === w.bytes) return "change";
  if (type === 1 && addr.length === 57 && hex6(addr.slice(1, 29)) === MINSWAP_V2.orderScriptHash && hex6(addr.slice(29, 57)) === w.stakeKeyHash) return "order";
  if (type === 6 && addr.length === 29 && hex6(addr.slice(1, 29)) === MINSWAP_AGGREGATOR_FEE_KEY_HASH) {
    return "aggregator-fee";
  }
  return null;
}
function uintString(v, what) {
  if (typeof v !== "string" || !/^[0-9]+$/.test(v)) return fail(`quote ${what} is not an integer`);
  return BigInt(v);
}
function sameAddress(a, w) {
  return a.payment.kind === "key" && a.payment.hash === w.paymentKeyHash && !!a.stake && a.stake.kind === "key" && a.stake.hash === w.stakeKeyHash;
}
function validateMinswapOrderTx(txHex, expect, walletUtxos, nowSlot) {
  const tx = hexToBytesStrict(txHex);
  const parts = splitTxRoot(tx);
  const w = walletKeys(expect.walletAddress, expect.network);
  const sellAmount = uintString(expect.sellAmountRaw, "sell amount");
  const buyAmount = uintString(expect.buyAmountRaw, "buy amount");
  const approvedMin = uintString(expect.minBuyAmountRaw, "minimum received");
  const batcherFee = uintString(expect.terms.batcherFeeLovelace, "batcher fee");
  const deposit = uintString(expect.terms.depositLovelace, "deposit");
  const aggregatorFee = uintString(expect.terms.aggregatorFeeLovelace, "aggregator fee");
  if (sellAmount <= 0n || approvedMin <= 0n || approvedMin > buyAmount) fail("quote amounts are inconsistent");
  if (expect.terms.protocol !== "MinswapV2") fail("only Minswap V2 orders are supported");
  if (batcherFee > CARDANO_SWAP_LIMITS.maxBatcherFeeLovelace) fail("batcher fee exceeds the wallet limit");
  if (deposit > CARDANO_SWAP_LIMITS.maxDepositLovelace) fail("order deposit exceeds the wallet limit");
  if (aggregatorFee > CARDANO_SWAP_LIMITS.maxAggregatorFeeLovelace) fail("aggregator fee exceeds the wallet limit");
  const sellIsAda = expect.sellUnit === CARDANO_LOVELACE;
  if (!sellIsAda && !splitCardanoUnit(expect.sellUnit)) fail("sell token is not a Cardano unit");
  if (expect.buyUnit !== CARDANO_LOVELACE && !splitCardanoUnit(expect.buyUnit)) fail("buy token is not a Cardano unit");
  const path = expect.terms.path;
  if (!Array.isArray(path) || path[0] !== expect.sellUnit || path[path.length - 1] !== expect.buyUnit) {
    fail("the quoted route does not run from the sell token to the buy token");
  }
  let witnessSet;
  try {
    witnessSet = decodeCbor(parts.witnessSet);
  } catch (e) {
    return fail(`witness set: ${e.message}`);
  }
  if (!(witnessSet instanceof CborMap) || witnessSet.size !== 0) {
    fail("the transaction already carries witnesses or scripts; an order creation needs neither");
  }
  if (parts.isValid.length !== 1 || parts.isValid[0] !== 245) fail("the transaction is not marked valid");
  let body;
  try {
    body = decodeCbor(parts.body);
  } catch (e) {
    return fail(`body: ${e instanceof CborError ? e.message : "undecodable"}`);
  }
  if (!(body instanceof CborMap)) return fail("body is not a map");
  const ALLOWED = /* @__PURE__ */ new Set([0, 1, 2, 3, 7, 8, 15]);
  const seenKeys = /* @__PURE__ */ new Set();
  for (const [k] of body.entries) {
    if (typeof k !== "bigint") fail("body has a non-integer key");
    const key = Number(k);
    if (seenKeys.has(key)) fail("body repeats a field");
    seenKeys.add(key);
    if (!ALLOWED.has(key)) {
      const names = {
        4: "certificates",
        5: "withdrawals",
        9: "minting",
        11: "script data",
        13: "collateral",
        14: "required signers",
        16: "collateral return",
        17: "total collateral",
        18: "reference inputs",
        19: "governance votes",
        20: "governance proposals",
        21: "treasury value",
        22: "a treasury donation"
      };
      fail(`the transaction includes ${names[key] ?? `unknown body field ${key}`}`);
    }
  }
  const networkId = body.getInt(15);
  if (networkId !== void 0 && networkId !== (expect.network === "mainnet" ? 1n : 0n)) {
    fail("the transaction is for a different Cardano network");
  }
  const fee = body.getInt(2);
  if (typeof fee !== "bigint" || fee <= 0n) return fail("missing network fee");
  if (fee > CARDANO_SWAP_LIMITS.maxTxFeeLovelace) fail("network fee exceeds the wallet limit");
  const ttl = body.getInt(3);
  if (typeof ttl !== "bigint") return fail("the transaction never expires");
  if (nowSlot != null) {
    if (ttl < nowSlot + CARDANO_SWAP_LIMITS.minValiditySlots) fail("the quote has expired \u2014 refresh it and try again");
    if (ttl > nowSlot + CARDANO_SWAP_LIMITS.maxValiditySlots) fail("the transaction stays valid for an unusually long time");
  }
  const validFrom = body.getInt(8);
  if (validFrom !== void 0 && (typeof validFrom !== "bigint" || nowSlot != null && validFrom > nowSlot)) {
    fail("the transaction is not valid yet");
  }
  const inputKeys = strictInputs(body.getInt(0), "inputs");
  const spent = { lovelace: 0n, assets: /* @__PURE__ */ new Map() };
  for (const key of inputKeys) {
    const utxo = walletUtxos.get(key);
    if (!utxo) fail("the transaction spends a coin that is not an unspent coin of this wallet");
    spent.lovelace += utxo.lovelace;
    for (const a of utxo.assets) spent.assets.set(a.unit, (spent.assets.get(a.unit) ?? 0n) + a.quantity);
  }
  const outputsRaw = body.getInt(1);
  if (!Array.isArray(outputsRaw) || outputsRaw.length === 0) return fail("the transaction has no outputs");
  const kept = { lovelace: 0n, assets: /* @__PURE__ */ new Map() };
  let orderIndex = -1;
  let orderOutput = null;
  let feeOutputs = 0;
  outputsRaw.forEach((raw, i) => {
    const out = strictOutput(raw, i);
    const role = roleOf(out.addressBytes, w);
    if (role === null) fail(`output ${i} pays an address that is neither this wallet, the Minswap order script nor its fee address`);
    if (role === "change") {
      if (out.inlineDatum) fail(`output ${i} attaches a datum to this wallet's own coins`);
      kept.lovelace += out.value.lovelace;
      for (const [u, q] of out.value.assets) kept.assets.set(u, (kept.assets.get(u) ?? 0n) + q);
    } else if (role === "order") {
      if (orderOutput) fail("the transaction creates more than one order");
      orderIndex = i;
      orderOutput = out;
    } else {
      feeOutputs++;
      if (feeOutputs > 1) fail("the transaction pays the aggregator fee more than once");
      if (out.inlineDatum || out.value.assets.size) fail("the aggregator fee output carries more than ADA");
      if (out.value.lovelace !== aggregatorFee) fail("the aggregator fee differs from the quote");
    }
  });
  if (feeOutputs === 0 && aggregatorFee !== 0n) fail("the quoted aggregator fee is missing");
  if (!orderOutput) return fail("the transaction creates no Minswap order");
  const order = orderOutput;
  if (!order.inlineDatum) fail("the order carries no inline datum");
  let parsed;
  try {
    parsed = decodeMinswapV2OrderDatum(order.inlineDatum);
    verifyMinswapV2Route(parsed, path);
  } catch (e) {
    if (e instanceof MinswapOrderError) return fail(e.message);
    throw e;
  }
  if (parsed.canceller.kind !== "key" || parsed.canceller.hash !== w.paymentKeyHash) {
    fail("someone other than this wallet could cancel the order");
  }
  if (!sameAddress(parsed.successReceiver, w)) fail("the order pays its proceeds to an address that is not this wallet");
  if (!sameAddress(parsed.refundReceiver, w)) fail("the order refunds to an address that is not this wallet");
  if (parsed.successReceiverHasDatum || parsed.refundReceiverHasDatum) fail("the order attaches a datum to this wallet's proceeds");
  if (parsed.swapAmount !== sellAmount) fail("the order sells a different amount than the quote");
  if (parsed.minimumReceive < approvedMin) fail("the order's minimum received is below the one you approved");
  if (parsed.minimumReceive > buyAmount) fail("the order's minimum received exceeds the quoted output");
  if (parsed.maxBatcherFee !== batcherFee) fail("the order's batcher fee differs from the quote");
  const orderAssets = order.value.assets;
  if (sellIsAda) {
    if (orderAssets.size !== 0) fail("the order locks tokens that are not being sold");
    if (order.value.lovelace !== sellAmount + batcherFee + deposit) fail("the order locks a different amount of ADA than quoted");
  } else {
    if (orderAssets.size !== 1 || orderAssets.get(expect.sellUnit) !== sellAmount) {
      fail("the order locks a different token amount than the one being sold");
    }
    if (order.value.lovelace !== batcherFee + deposit) fail("the order locks a different amount of ADA than quoted");
  }
  const units = /* @__PURE__ */ new Set([...spent.assets.keys(), ...kept.assets.keys()]);
  for (const unit2 of units) {
    const delta = (spent.assets.get(unit2) ?? 0n) - (kept.assets.get(unit2) ?? 0n);
    const expected = !sellIsAda && unit2 === expect.sellUnit ? sellAmount : 0n;
    if (delta !== expected) fail("the transaction moves a token of this wallet that is not part of the swap");
  }
  if (!sellIsAda && !units.has(expect.sellUnit)) fail("the transaction does not spend the token being sold");
  const adaOut = spent.lovelace - kept.lovelace;
  const expectedAdaOut = fee + order.value.lovelace + aggregatorFee;
  if (adaOut !== expectedAdaOut) fail("the transaction does not balance to the quoted costs");
  return {
    txId: txIdOf(parts.body),
    orderOutputIndex: orderIndex,
    order: parsed,
    cost: {
      txFeeLovelace: fee.toString(),
      batcherFeeLovelace: batcherFee.toString(),
      depositLovelace: deposit.toString(),
      aggregatorFeeLovelace: aggregatorFee.toString(),
      adaSpentLovelace: adaOut.toString(),
      validUntilSlot: ttl.toString(),
      orderMinimumRaw: parsed.minimumReceive.toString(),
      killable: parsed.killable
    }
  };
}
function indexWalletUtxos(utxos) {
  const map = /* @__PURE__ */ new Map();
  for (const u of utxos) {
    map.set(`${u.txHash.toLowerCase()}#${u.txIndex}`, {
      lovelace: u.lovelace,
      assets: u.assets.map((a) => ({ unit: a.unit.toLowerCase(), quantity: a.quantity }))
    });
  }
  return map;
}

// src/main/cardano-danogo-validate.ts
var import_blake2b7 = require("@noble/hashes/blake2b");
var fail2 = (why) => {
  throw new CardanoSwapValidationError(why);
};
var hex7 = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
var byRef = (a, b) => {
  const [ha, ia] = a.split("#");
  const [hb, ib] = b.split("#");
  return ha !== hb ? ha < hb ? -1 : 1 : Number(ia) - Number(ib);
};
function redeemersOf(v) {
  const out = [];
  if (Array.isArray(v)) {
    for (const r of v) {
      if (!Array.isArray(r) || r.length !== 4 || typeof r[0] !== "bigint" || typeof r[1] !== "bigint") fail2("malformed redeemer");
      out.push({ tag: r[0], index: r[1], data: r[2] });
    }
  } else if (v instanceof CborMap) {
    for (const [k, val] of v.entries) {
      if (!Array.isArray(k) || k.length !== 2 || typeof k[0] !== "bigint" || typeof k[1] !== "bigint" || !Array.isArray(val) || val.length !== 2) fail2("malformed redeemer");
      out.push({ tag: k[0], index: k[1], data: val[0] });
    }
  } else {
    fail2("the transaction carries no redeemers");
  }
  if (!out.length) fail2("the transaction carries no redeemers");
  return out;
}
function swapRedeemer(r) {
  if (!(r.data instanceof Uint8Array)) return fail2("a redeemer is not a Danogo swap");
  try {
    return decodeDanogoSwapRedeemer(r.data);
  } catch (e) {
    if (e instanceof DanogoError) return fail2(e.message);
    throw e;
  }
}
function validateDanogoSwapTx(txHex, expect, walletUtxos, nowSlot) {
  const parts = splitTxRoot(hexToBytesStrict(txHex));
  const w = walletKeys(expect.walletAddress, expect.network);
  const terms = expect.terms;
  if (terms.protocol !== "DanogoCLMMV1") fail2("this check only accepts Danogo swaps");
  const sellAmount = uintString(expect.sellAmountRaw, "sell amount");
  const buyAmount = uintString(expect.buyAmountRaw, "buy amount");
  const approvedMin = uintString(expect.minBuyAmountRaw, "minimum received");
  const aggregatorFee = uintString(terms.aggregatorFeeLovelace, "aggregator fee");
  const swapFee = uintString(terms.dexFeeLovelace ?? "", "Danogo swap fee");
  if (sellAmount <= 0n || approvedMin <= 0n || approvedMin > buyAmount) fail2("quote amounts are inconsistent");
  if (terms.batcherFeeLovelace !== "0" || terms.depositLovelace !== "0") fail2("a Danogo swap has no batcher fee or deposit");
  if (swapFee !== DANOGO_CLMM.swapFeeLovelace) fail2("the Danogo swap fee differs from the protocol's");
  if (aggregatorFee > CARDANO_SWAP_LIMITS.maxAggregatorFeeLovelace) fail2("aggregator fee exceeds the wallet limit");
  const sellIsAda = expect.sellUnit === CARDANO_LOVELACE;
  const buyIsAda = expect.buyUnit === CARDANO_LOVELACE;
  if (sellIsAda === buyIsAda) fail2("only Danogo swaps between ADA and a token are supported");
  const token = sellIsAda ? expect.buyUnit : expect.sellUnit;
  if (!splitCardanoUnit(token)) fail2("the token is not a Cardano unit");
  if (!Array.isArray(terms.path) || terms.path.length !== 2 || terms.path[0] !== expect.sellUnit || terms.path[1] !== expect.buyUnit) {
    fail2("the quoted route is not one Danogo pool between the sell and buy tokens");
  }
  if (parts.isValid.length !== 1 || parts.isValid[0] !== 245) fail2("the transaction is not marked valid");
  let body;
  let witnessSet;
  try {
    body = decodeCbor(parts.body);
    witnessSet = decodeCbor(parts.witnessSet);
  } catch (e) {
    return fail2(`transaction: ${e instanceof CborError ? e.message : "undecodable"}`);
  }
  if (!(body instanceof CborMap)) return fail2("body is not a map");
  if (!(witnessSet instanceof CborMap)) return fail2("witness set is not a map");
  const ALLOWED = /* @__PURE__ */ new Set([0, 1, 2, 3, 5, 7, 8, 11, 13, 15, 18]);
  const names = {
    4: "certificates",
    9: "minting",
    14: "required signers",
    16: "collateral return",
    17: "total collateral",
    19: "governance votes",
    20: "governance proposals",
    21: "treasury value",
    22: "a treasury donation"
  };
  const seenKeys = /* @__PURE__ */ new Set();
  for (const [k] of body.entries) {
    if (typeof k !== "bigint") fail2("body has a non-integer key");
    const key = Number(k);
    if (seenKeys.has(key)) fail2("body repeats a field");
    seenKeys.add(key);
    if (!ALLOWED.has(key)) fail2(`the transaction includes ${names[key] ?? `unknown body field ${key}`}`);
  }
  for (const required of [5, 11, 13, 18]) if (!seenKeys.has(required)) fail2("the transaction is not a Danogo pool swap");
  const networkId = body.getInt(15);
  if (networkId !== void 0 && networkId !== (expect.network === "mainnet" ? 1n : 0n)) {
    fail2("the transaction is for a different Cardano network");
  }
  const fee = body.getInt(2);
  if (typeof fee !== "bigint" || fee <= 0n) return fail2("missing network fee");
  if (fee > CARDANO_SWAP_LIMITS.maxTxFeeLovelace) fail2("network fee exceeds the wallet limit");
  const ttl = body.getInt(3);
  if (typeof ttl !== "bigint") return fail2("the transaction never expires");
  if (nowSlot != null) {
    if (ttl < nowSlot + CARDANO_SWAP_LIMITS.minValiditySlots) fail2("the quote has expired \u2014 refresh it and try again");
    if (ttl > nowSlot + CARDANO_SWAP_LIMITS.maxValiditySlots) fail2("the transaction stays valid for an unusually long time");
  }
  const validFrom = body.getInt(8);
  if (validFrom !== void 0 && (typeof validFrom !== "bigint" || nowSlot != null && validFrom > nowSlot)) {
    fail2("the transaction is not valid yet");
  }
  const inputs = strictInputs(body.getInt(0), "inputs").sort(byRef);
  const spent = { lovelace: 0n, assets: /* @__PURE__ */ new Map() };
  const foreign = [];
  inputs.forEach((key, i) => {
    const utxo = walletUtxos.get(key);
    if (!utxo) {
      foreign.push(i);
      return;
    }
    spent.lovelace += utxo.lovelace;
    for (const a of utxo.assets) spent.assets.set(a.unit, (spent.assets.get(a.unit) ?? 0n) + a.quantity);
  });
  if (foreign.length !== 1) fail2("the transaction must spend exactly one pool besides this wallet's coins");
  if (foreign.length === inputs.length) fail2("the transaction spends none of this wallet's coins");
  const poolInputIndex = foreign[0];
  const collateral = strictInputs(body.getInt(13), "collateral");
  if (collateral.length > 3) fail2("the transaction offers unusual collateral");
  if (collateral.some((k) => walletUtxos.has(k))) fail2("the transaction would put this wallet's coins up as collateral");
  const refs = strictInputs(body.getInt(18), "reference inputs").sort(byRef);
  if (!refs.includes(DANOGO_CLMM.poolScriptRef) || !refs.includes(DANOGO_CLMM.protocolConfigRef)) {
    fail2("the transaction does not use Danogo's published pool script and protocol config");
  }
  if (refs.length > 3) fail2("the transaction reads unexpected reference inputs");
  if (refs.some((k) => walletUtxos.has(k))) fail2("the transaction reads this wallet's coins as reference inputs");
  const protocolConfigIndex = refs.indexOf(DANOGO_CLMM.protocolConfigRef);
  const withdrawalsRaw = body.getInt(5);
  if (!(withdrawalsRaw instanceof CborMap) || withdrawalsRaw.size === 0 || withdrawalsRaw.size > 3) {
    return fail2("the transaction has unexpected withdrawals");
  }
  const withdrawals = [];
  for (const [acct, amount] of withdrawalsRaw.entries) {
    if (!(acct instanceof Uint8Array) || acct.length !== 29 || typeof amount !== "bigint" || amount < 0n) {
      fail2("malformed withdrawal");
    }
    const a = acct;
    if (a[0] >> 4 !== 15 || (a[0] & 15) !== w.networkNibble) fail2("the transaction withdraws from a non-script reward account");
    withdrawals.push({ hash: hex7(a.slice(1, 29)), bytes: hex7(a), amount });
  }
  withdrawals.sort((x, y) => x.bytes < y.bytes ? -1 : x.bytes > y.bytes ? 1 : 0);
  const poolWithdrawal = withdrawals.findIndex((x) => x.hash === DANOGO_CLMM.poolScriptHash);
  if (poolWithdrawal < 0 || withdrawals[poolWithdrawal].amount !== 0n) fail2("the transaction lacks the pool script's withdraw-zero");
  const outputsRaw = body.getInt(1);
  if (!Array.isArray(outputsRaw) || outputsRaw.length === 0) return fail2("the transaction has no outputs");
  const kept = { lovelace: 0n, assets: /* @__PURE__ */ new Map() };
  let poolOutputIndex = -1;
  let feeOutputs = 0;
  const pool = { tokenX: "" };
  outputsRaw.forEach((raw, i) => {
    const out = strictOutput(raw, i);
    const addr = out.addressBytes;
    if ((addr[0] & 15) !== w.networkNibble) fail2("an output is addressed to a different Cardano network");
    const type = addr[0] >> 4;
    if (hex7(addr) === w.bytes) {
      if (out.inlineDatum) fail2(`output ${i} attaches a datum to this wallet's own coins`);
      kept.lovelace += out.value.lovelace;
      for (const [u, q] of out.value.assets) kept.assets.set(u, (kept.assets.get(u) ?? 0n) + q);
      return;
    }
    if (type === 6 && addr.length === 29 && hex7(addr.slice(1, 29)) === MINSWAP_AGGREGATOR_FEE_KEY_HASH) {
      feeOutputs++;
      if (feeOutputs > 1) fail2("the transaction pays the aggregator fee more than once");
      if (out.inlineDatum || out.value.assets.size) fail2("the aggregator fee output carries more than ADA");
      if (out.value.lovelace !== aggregatorFee) fail2("the aggregator fee differs from the quote");
      return;
    }
    if (type <= 7 && (type & 1) === 1 && addr.length >= 29 && hex7(addr.slice(1, 29)) === DANOGO_CLMM.poolScriptHash) {
      if (poolOutputIndex >= 0) fail2("the transaction pays more than one Danogo pool");
      poolOutputIndex = i;
      const nfts = [...out.value.assets].filter(([u]) => u.startsWith(DANOGO_CLMM.poolScriptHash));
      if (nfts.length !== 1 || nfts[0][1] !== 1n) fail2("the pool output does not carry exactly one Danogo pool NFT");
      if (!out.inlineDatum) fail2("the pool output carries no pool datum");
      let pair;
      try {
        const d = decodeDanogoPoolDatum(out.inlineDatum);
        pair = [d.tokenX, d.tokenY];
      } catch (e) {
        if (e instanceof DanogoError) return fail2(e.message);
        throw e;
      }
      const want = [expect.sellUnit, expect.buyUnit].sort().join();
      if ([...pair].sort().join() !== want) fail2("the pool trades a different token pair than the quote");
      pool.tokenX = pair[0];
      return;
    }
    fail2(`output ${i} pays an address that is neither this wallet, the Danogo pool nor the aggregator's fee address`);
  });
  if (feeOutputs === 0 && aggregatorFee !== 0n) fail2("the quoted aggregator fee is missing");
  if (poolOutputIndex < 0) fail2("the transaction does not return the Danogo pool");
  for (const [k, v] of witnessSet.entries) {
    if (k === 0n) {
      if (!Array.isArray(v) || v.length > 2) fail2("the transaction carries unexpected signatures");
      for (const vk of v) {
        if (!Array.isArray(vk) || vk.length !== 2 || !(vk[0] instanceof Uint8Array) || vk[0].length !== 32) {
          fail2("malformed provider signature");
        }
        if (hex7((0, import_blake2b7.blake2b)(vk[0], { dkLen: 28 })) === w.paymentKeyHash) {
          fail2("the transaction already carries a signature from this wallet");
        }
      }
    } else if (k !== 5n) {
      fail2("the transaction carries scripts or data in its witness set");
    }
  }
  const redeemers = redeemersOf(witnessSet.getInt(5));
  let spends = 0;
  const rewardIndexes = /* @__PURE__ */ new Set();
  let swap = null;
  for (const r of redeemers) {
    const s = swapRedeemer(r);
    if (s.poolInIdx !== poolInputIndex || s.poolOutIdx !== poolOutputIndex) fail2("the swap redeemer points at a different pool");
    if (swap && s.delta !== swap.delta) fail2("the redeemers disagree about the swap amount");
    swap = s;
    if (r.tag === 0n) {
      spends++;
      if (r.index !== BigInt(poolInputIndex) || s.inIdx !== poolInputIndex) fail2("the spend redeemer is not for the pool input");
    } else if (r.tag === 3n) {
      if (r.index < 0n || r.index >= BigInt(withdrawals.length) || rewardIndexes.has(r.index)) fail2("a withdrawal redeemer is misplaced");
      rewardIndexes.add(r.index);
      if (r.index === BigInt(poolWithdrawal) && s.inIdx !== protocolConfigIndex) {
        fail2("the pool withdraw-zero does not reference the protocol config");
      }
    } else {
      fail2("the transaction runs a script that is not part of a Danogo swap");
    }
  }
  if (spends !== 1 || rewardIndexes.size !== withdrawals.length || !swap) fail2("the swap redeemers are incomplete");
  const redeemer = swap;
  const sellsX = expect.sellUnit === pool.tokenX;
  if (redeemer.delta !== (sellsX ? sellAmount : -sellAmount)) fail2("the swap sells a different amount than the quote");
  const units = /* @__PURE__ */ new Set([...spent.assets.keys(), ...kept.assets.keys()]);
  let delivered = 0n;
  for (const unit2 of units) {
    const net = (kept.assets.get(unit2) ?? 0n) - (spent.assets.get(unit2) ?? 0n);
    if (unit2 === token) {
      if (sellIsAda) {
        if (net <= 0n) fail2("the transaction delivers none of the token being bought");
        delivered = net;
      } else if (net !== -sellAmount) fail2("the transaction sells a different token amount than the quote");
    } else if (net !== 0n) {
      fail2("the transaction moves a token of this wallet that is not part of the swap");
    }
  }
  if (!units.has(token)) fail2(sellIsAda ? "the transaction delivers none of the token being bought" : "the transaction does not spend the token being sold");
  const netAda = kept.lovelace - spent.lovelace;
  let adaSpent;
  if (sellIsAda) {
    adaSpent = sellAmount + swapFee + aggregatorFee + fee;
    if (-netAda !== adaSpent) fail2("the transaction does not balance to the quoted costs");
  } else {
    delivered = netAda + fee + aggregatorFee;
    adaSpent = fee + aggregatorFee;
  }
  if (delivered < approvedMin) fail2("the transaction delivers less than the minimum you approved");
  return {
    txId: txIdOf(parts.body),
    poolOutputIndex,
    redeemer,
    deliveredRaw: delivered.toString(),
    cost: {
      txFeeLovelace: fee.toString(),
      batcherFeeLovelace: "0",
      depositLovelace: "0",
      aggregatorFeeLovelace: aggregatorFee.toString(),
      dexFeeLovelace: swapFee.toString(),
      adaSpentLovelace: adaSpent.toString(),
      validUntilSlot: ttl.toString(),
      orderMinimumRaw: delivered.toString(),
      killable: null
    }
  };
}

// src/main/cardano-swap.ts
var CardanoSwapError = class extends Error {
};
function expectationFromQuote(quote, walletAddress, testnet) {
  if (quote.provider !== "minswap" || !quote.cardanoOrder || !quote.txData?.cbor) {
    throw new CardanoSwapError("This Cardano quote carries no order to check.");
  }
  if (!quote.minBuyAmountRaw) throw new CardanoSwapError("This Cardano quote has no minimum received.");
  return {
    walletAddress,
    network: testnet ? "testnet" : "mainnet",
    sellUnit: normalizeSwapAddress("cardano", quote.fromTokenAddress),
    sellAmountRaw: quote.sellAmountRaw,
    buyUnit: normalizeSwapAddress("cardano", quote.toTokenAddress),
    buyAmountRaw: quote.buyAmountRaw,
    minBuyAmountRaw: quote.minBuyAmountRaw,
    terms: quote.cardanoOrder
  };
}
async function checkCardanoSwapTx(quote, walletAddress, config) {
  const expectation = expectationFromQuote(quote, walletAddress, isTestnet(config));
  const [utxos, tip] = await Promise.all([fetchUtxos(walletAddress, config), fetchCardanoTip(config)]);
  if (tip == null) {
    throw new CardanoSwapError("Could not read the current Cardano slot, so the order's validity window cannot be checked.");
  }
  const validate = expectation.terms.protocol === "DanogoCLMMV1" ? validateDanogoSwapTx : validateMinswapOrderTx;
  return validate(quote.txData.cbor, expectation, indexWalletUtxos(utxos), tip);
}
async function prepareCardanoSwapQuote(req, config, fetchFn, protocol = "MinswapV2") {
  if (isTestnet(config)) {
    throw new CardanoSwapError("Cardano swaps are mainnet-only: the Minswap aggregator has no Preprod endpoint.");
  }
  if (!req.taker) throw new CardanoSwapError("This wallet has no Cardano address for this account.");
  let quote;
  try {
    quote = await minswapQuoteDirect({
      sellUnit: req.fromToken,
      buyUnit: req.toToken,
      sellAmountRaw: req.sellAmountRaw,
      slippageBps: req.slippageBps,
      sender: req.taker,
      fromSymbol: req.fromSymbol,
      toSymbol: req.toSymbol,
      protocol
    }, fetchFn);
  } catch (e) {
    if (e instanceof MinswapQuoteError) throw new CardanoSwapError(e.message);
    throw e;
  }
  try {
    const validated = await checkCardanoSwapTx(quote, req.taker, config);
    return { ...quote, cardanoCost: validated.cost };
  } catch (e) {
    if (e instanceof CardanoSwapValidationError) {
      const what = protocol === "DanogoCLMMV1" ? "Danogo swap" : "Minswap transaction";
      throw new CardanoSwapError(`The ${what} failed the wallet's safety check: ${e.message}.`);
    }
    throw e;
  }
}

// src/main/swap-proxy.ts
var LIFI_INTEGRATOR = SWAP_FEE_BENEFICIARIES.lifiIntegrator;
var swapFetch = (input, init) => fetch(input, init);
function setSwapFetch(fn) {
  swapFetch = fn;
}
async function fetchWithDeadline(url, init, ms, label) {
  let timer;
  const deadline = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([swapFetch(url, init), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function proxyBase2(config) {
  const base2 = (config.swapProxyUrl || "").trim().replace(/\/+$/, "");
  return base2 || null;
}
var NOT_CONFIGURED = "DEX swap proxy is not configured yet. Deploy the Cloudflare Worker and set swapProxyUrl to enable on-chain swaps.";
var msg = (e) => e instanceof Error && e.name === "TimeoutError" ? "Quote request timed out \u2014 try again." : e instanceof Error ? e.message : "Network error";
var LIFI_CHAIN = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  avalanche: 43114,
  bsc: 56,
  monad: 143,
  solana: 1151111081099710,
  bitcoin: 20000000000001
};
var NATIVE_EVM_SENTINEL3 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var SOL_NATIVE_MINT2 = "So11111111111111111111111111111111111111112";
var isNativeEvmAddr = (a) => a.toLowerCase() === NATIVE_EVM_SENTINEL3 || a === "0x0000000000000000000000000000000000000000";
function erc20ApproveData(spender) {
  const addr = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x095ea7b3${addr}${"f".repeat(64)}`;
}
function lifiToken(chain, addr) {
  if (chain === "solana") return addr === SOL_NATIVE_MINT2 ? "11111111111111111111111111111111" : addr;
  return isNativeEvmAddr(addr) ? "0x0000000000000000000000000000000000000000" : addr;
}
async function lifiQuoteDirect(req, noFee = false, denyBridges = []) {
  const fromId = LIFI_CHAIN[req.fromChain] ?? req.fromChainId ?? null;
  const toId = LIFI_CHAIN[req.toChain] ?? req.toChainId ?? null;
  if (fromId == null || toId == null) return null;
  const params = new URLSearchParams({
    fromChain: String(fromId),
    toChain: String(toId),
    fromToken: lifiToken(req.fromChain, req.fromToken),
    toToken: lifiToken(req.toChain, req.toToken),
    fromAmount: req.sellAmountRaw,
    fromAddress: req.taker,
    toAddress: req.toAddress || req.taker,
    slippage: String(req.slippageBps / 1e4)
  });
  params.set("integrator", LIFI_INTEGRATOR);
  for (const bridge of denyBridges) params.append("denyBridges", bridge);
  if (!noFee) params.set("fee", String(APP_FEE_BPS / 1e4));
  const res = await fetchWithDeadline(`https://li.quest/v1/quote?${params}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2e4)
  }, 12e3, "LI.FI direct");
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  if (!d) return null;
  const est = d.estimate || {};
  const tr = d.transactionRequest || {};
  const toolDetails = d.toolDetails;
  let txData;
  let approvalTx = null;
  if (req.fromChain === "solana") {
    if (!tr.data) return null;
    txData = { swapTransaction: String(tr.data) };
  } else {
    if (!tr.to || !tr.data) return null;
    txData = { to: String(tr.to), data: String(tr.data), value: String(tr.value ?? "0") };
    if (!isNativeEvmAddr(req.fromToken) && est.approvalAddress) {
      approvalTx = { to: req.fromToken, data: erc20ApproveData(String(est.approvalAddress)), value: "0x0" };
    }
  }
  const { appFee, externalFees } = lifiFeeRecords(est, req, noFee);
  const sellAmt = Number(req.sellAmountRaw), buyAmt = Number(est.toAmount ?? 0);
  return {
    provider: "lifi",
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromTokenAddress: req.fromToken,
    toTokenAddress: req.toToken,
    fromTokenSymbol: req.fromSymbol,
    toTokenSymbol: req.toSymbol,
    sellAmountRaw: req.sellAmountRaw,
    buyAmountRaw: String(est.toAmount ?? "0"),
    // LI.FI states the executed floor directly (verified live: toAmount x
    // (1 - slippage)). Only that counts as a provider floor; a fallback is an
    // estimate and is labelled as one.
    ...lifiMinReceived(est, req.slippageBps),
    estimatedGasRaw: String(tr.gasLimit ?? "0"),
    slippageBps: req.slippageBps,
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 3e4,
    isCrossChain: req.fromChain !== req.toChain,
    toAddress: req.toAddress || req.taker,
    bridgeTool: d.tool || toolDetails?.key || null,
    // The route's own step list: it names the asset that crosses the bridge,
    // which is what the user holds if a destination swap fails.
    routeSteps: compactRouteSteps(d.includedSteps),
    estimatedDurationSec: Number(est.executionDuration ?? 0),
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees,
    requestId: null,
    txData,
    approvalTx
  };
}
function lifiFeeRecords(est, req, noFee = false) {
  const cap = SWAP_FEE_PROVIDERS.lifi;
  const appFee = noFee ? feeFreeRecord("lifi", req.fromChain, "quoted without an app fee (tier-2 fallback)") : {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider: "lifi",
    requestedBps: APP_FEE_BPS,
    appliedBps: null,
    base: "input",
    chain: req.fromChain,
    tokenAddress: req.fromToken,
    tokenSymbol: req.fromSymbol || null,
    tokenDecimals: req.fromDecimals ?? null,
    amountRaw: null,
    recipient: LIFI_INTEGRATOR,
    recipientKind: "registered-integrator",
    collection: cap.collection,
    providerSharePct: cap.providerSharePct,
    verification: "requested-unverified",
    evidence: []
  };
  const externalFees = [];
  const costs = Array.isArray(est.feeCosts) ? est.feeCosts : [];
  for (const cost of costs) {
    const split = cost.feeSplit;
    const token = cost.token ?? {};
    if (!noFee && split && split.integratorFee != null) {
      const amount = String(split.integratorFee).replace(/[^0-9]/g, "");
      const named = Array.isArray(split.recipients) && split.recipients.some((r) => r?.name === LIFI_INTEGRATOR);
      appFee.amountRaw = amount || null;
      if (token.symbol) appFee.tokenSymbol = token.symbol;
      if (typeof token.decimals === "number") appFee.tokenDecimals = token.decimals;
      appFee.appliedBps = effectiveBps(amount, req.sellAmountRaw);
      appFee.evidence.push("estimate.feeCosts[].feeSplit reported by LI.FI");
      if (!named) {
        appFee.evidence.push("integrator was not named in feeSplit.recipients");
      } else if (feeAmountMatches(amount, req.sellAmountRaw, APP_FEE_BPS)) {
        appFee.appliedBps = APP_FEE_BPS;
        appFee.verification = "applied-verified";
        appFee.evidence.push(`integrator named in recipients; amount reconciles to ${APP_FEE_BPS} bps of the input`);
      } else {
        appFee.evidence.push("integrator fee did not reconcile to the policy rate");
      }
    }
    const lifiCut = split?.lifiFee != null ? String(split.lifiFee).replace(/[^0-9]/g, "") : "";
    if (lifiCut && lifiCut !== "0") {
      externalFees.push({
        name: "LI.FI fee",
        tokenSymbol: token.symbol ?? null,
        tokenDecimals: typeof token.decimals === "number" ? token.decimals : null,
        amountRaw: lifiCut,
        includedInQuotedOutput: cost.included !== false
      });
    }
  }
  if (!noFee && !appFee.amountRaw) appFee.evidence.push("LI.FI response carried no integrator fee split");
  return { appFee, externalFees };
}
function lifiMinReceived(est, slippageBps) {
  const stated = String(est.toAmountMin ?? "");
  if (/^[0-9]+$/.test(stated) && stated !== "0") {
    return { minBuyAmountRaw: stated, minReceivedSource: "provider" };
  }
  const derived = deriveMinBuyAmountRaw(String(est.toAmount ?? "0"), slippageBps);
  return derived ? { minBuyAmountRaw: derived, minReceivedSource: "derived" } : {};
}
async function getSwapQuote(req, config) {
  if (req.fromChain === "cardano" || req.toChain === "cardano") return getCardanoSwapQuote(req, config);
  const base2 = proxyBase2(config);
  if (!base2) return { quote: null, error: NOT_CONFIGURED };
  const excluded = [];
  const candidates = [];
  const consider = (raw, label) => {
    const ready = withMinReceived(raw);
    if (!ready) return;
    const why = unsignableReason(ready);
    if (why) {
      excluded.push(`${label}: ${why}`);
      return;
    }
    candidates.push(ready);
  };
  const crossChain = req.fromChain !== req.toChain;
  if (crossChain) {
    let paid = null;
    try {
      paid = withMinReceived(await lifiQuoteDirect(req));
      if (!paid || !paid.buyAmountRaw || paid.buyAmountRaw === "0") {
        excluded.push("lifi: no route returned for this pair");
        paid = null;
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.warn("[swap] LI.FI direct failed:", why);
      excluded.push(`lifi: ${why}`);
    }
    if (paid && classifyQuoteFee(paid).tier === "fee-paying") {
      consider(paid, "lifi");
    } else {
      let free = null;
      try {
        free = await lifiQuoteDirect(req, true);
      } catch {
      }
      if (free && free.buyAmountRaw && free.buyAmountRaw !== "0") consider(free, "lifi (fee-free)");
      else if (paid) consider(paid, "lifi");
    }
  }
  const params = new URLSearchParams({
    chain: req.fromChain,
    // legacy alias (same-chain); fromChain is authoritative
    fromChain: req.fromChain,
    toChain: req.toChain,
    sell: req.fromToken,
    buy: req.toToken,
    sellSymbol: req.fromSymbol,
    buySymbol: req.toSymbol,
    amount: req.sellAmountRaw,
    slippageBps: String(req.slippageBps),
    taker: req.taker,
    toAddress: req.toAddress || req.taker
  });
  if (req.fromDecimals != null) params.set("fromDecimals", String(req.fromDecimals));
  if (req.toDecimals != null) params.set("toDecimals", String(req.toDecimals));
  if (req.fromChainId != null) params.set("fromChainId", String(req.fromChainId));
  if (req.toChainId != null) params.set("toChainId", String(req.toChainId));
  if (crossChain) params.set("skipLifi", "1");
  if (!crossChain && req.fromChain === "solana") {
    const resolved = await resolveJupiterFeeAccount(req.toToken, config);
    if (resolved.feeAccount) params.set("solFeeAccount", resolved.feeAccount);
    else excluded.push(`jupiter fee: ${resolved.reason ?? "no fee account for this token"}`);
  }
  let workerError = null;
  try {
    const res = await fetchWithDeadline(proxyUrl(`${base2}/quote?${params}`, config), {
      headers: proxyHeaders(config, { accept: "application/json" }),
      signal: AbortSignal.timeout(2e4)
    }, 15e3, "Worker /quote");
    const data = await res.json().catch(() => null);
    if (!res.ok) workerError = data && data.error || `Proxy ${res.status}`;
    else if (!data) workerError = "Malformed proxy response.";
    else {
      const list = Array.isArray(data.candidates) && data.candidates.length ? data.candidates : data.quote ? [data.quote] : [];
      for (const q of list) {
        if (!q || typeof q !== "object") continue;
        const outdated = outdatedWorkerReason(q);
        if (outdated) {
          excluded.push(`${q.provider}: ${outdated}`);
          continue;
        }
        consider(q, String(q.provider));
      }
      if (!list.length) workerError = data.error ?? "No route available.";
    }
  } catch (e) {
    workerError = msg(e);
  }
  if (!candidates.length) {
    return {
      quote: null,
      error: joinReasons(workerError ?? "No route could be offered safely for this swap.", excluded)
    };
  }
  if (crossChain && req.fromChain === "solana") {
    return selectSimulatedSolanaRoute(req, config, candidates, excluded);
  }
  const selected = selectSafeRoute(candidates, excluded);
  if (!selected.quote) return selected;
  return { ...selected, quote: await withSolanaCost(selected.quote, req.taker, config) };
}
async function selectSimulatedSolanaRoute(req, config, candidates, excluded) {
  const pending = [...candidates];
  const denied = [];
  let requotes = 0;
  while (pending.length) {
    const selected = selectSafeRoute(pending, excluded);
    if (!selected.quote) return selected;
    const candidate = selected.quote;
    pending.splice(pending.indexOf(candidate), 1);
    let timer;
    let measured;
    try {
      measured = await Promise.race([
        // A backend's cost/status is not local simulation evidence.
        withSolanaCost({ ...candidate, solanaCost: void 0 }, req.taker, config),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Solana route simulation timed out")), 1e4);
        })
      ]);
    } catch {
      excluded.push(`${candidate.provider}: Solana route simulation unavailable; refresh the quote.`);
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const cost = measured.solanaCost;
    if (candidate.expiresAt <= Date.now()) {
      excluded.push(`${candidate.provider}: quote expired during route checks; request a fresh quote.`);
      continue;
    }
    const shortfall = cost ? solanaShortfallMessage(cost) : null;
    if (shortfall) {
      excluded.push(`${candidate.provider}: ${shortfall}`);
      continue;
    }
    if (cost?.simulationStatus === "pass") {
      return selectSafeRoute([measured], excluded);
    }
    if (cost?.simulationStatus !== "revert") {
      excluded.push(`${candidate.provider}: Solana route simulation unavailable; refresh the quote.`);
      continue;
    }
    excluded.push(`${candidate.provider}${candidate.bridgeTool ? ` (${candidate.bridgeTool})` : ""}: ${cost.simulationError}`);
    const bridge = candidate.bridgeTool;
    if (candidate.provider !== "lifi" || !bridge || !/^[a-zA-Z0-9_-]{1,64}$/.test(bridge) || denied.includes(bridge) || requotes >= 2) continue;
    denied.push(bridge);
    requotes++;
    try {
      let replacement = await lifiQuoteDirect(req, false, denied);
      if (!replacement || classifyQuoteFee(replacement).tier !== "fee-paying") {
        try {
          replacement = await lifiQuoteDirect(req, true, denied) ?? replacement;
        } catch {
        }
      }
      const ready = withMinReceived(replacement);
      if (!ready) continue;
      const why = unsignableReason(ready);
      if (why) {
        excluded.push(`lifi alternative: ${why}`);
        continue;
      }
      if (!ready.bridgeTool || denied.includes(ready.bridgeTool)) {
        excluded.push("lifi alternative: provider returned an excluded bridge");
        continue;
      }
      pending.push(ready);
    } catch (e) {
      excluded.push(`lifi alternative: ${msg(e)}`);
    }
  }
  return { quote: null, error: joinReasons("No SOL cross-chain route passed simulation. Nothing was sent.", excluded) };
}
async function getCardanoSwapQuote(req, config) {
  if (req.fromChain !== req.toChain) {
    return {
      quote: null,
      error: "Swapping between Cardano and another network is not available in Swap yet. Swap on Cardano, or use the Cross-Chain tab for ADA."
    };
  }
  const excluded = [];
  const candidates = [];
  const fetchFn = (url, init) => fetchWithDeadline(url, init, 15e3, "Minswap");
  for (const [label, protocol] of [["minswap", "MinswapV2"], ["danogo", "DanogoCLMMV1"]]) {
    let quote;
    try {
      quote = await prepareCardanoSwapQuote(req, config, fetchFn, protocol);
    } catch (e) {
      excluded.push(`${label}: ${e instanceof CardanoSwapError ? e.message : msg(e)}`);
      continue;
    }
    const ready = withMinReceived(quote);
    const why = ready ? unsignableReason(ready) : "no output amount";
    if (!ready || why) {
      excluded.push(`${label}: ${why}`);
      continue;
    }
    candidates.push(ready);
  }
  if (!candidates.length) {
    return { quote: null, error: excluded.length === 1 ? excluded[0].replace(/^\w+: /, "") : joinReasons("No route could be offered safely for this swap.", excluded) };
  }
  return selectSafeRoute(candidates, excluded);
}
async function withSolanaCost(quote, payer, config) {
  if (quote.fromChain !== "solana" || !quote.txData.swapTransaction || !payer) return quote;
  try {
    const cost = await estimateSolanaSwapCost(
      quote.txData.swapTransaction,
      // The canonical taker: this wallet's Solana address, which the executor
      // requires to be the transaction's fee payer (swap-executor.ts).
      payer,
      new import_web37.Connection(heliusRpcUrl(config), "confirmed"),
      { paysOutSolToPayer: quote.toChain === "solana" && isNativeSwapAddress("solana", quote.toTokenAddress) }
    );
    return cost ? { ...quote, solanaCost: cost } : quote;
  } catch {
    return quote;
  }
}
var PROVIDER_CHAINS_TTL_MS = 6 * 60 * 6e4;

// .local-artifacts/sol-crosschain/probe-entry.ts
var import_node_fs = require("node:fs");
async function main() {
  const chain = process.argv[2] === "ethereum" ? "ethereum" : "base";
  const replay = process.argv.includes("--replay-rejected");
  const nativeFetch = globalThis.fetch;
  let initial = true;
  const calls = [];
  setSwapFetch(async (input, init) => {
    const url = new URL(input);
    calls.push({ host: url.host, denied: url.searchParams.getAll("denyBridges") });
    if (url.hostname === "li.quest" && replay && initial) {
      initial = false;
      return new Response((0, import_node_fs.readFileSync)(".local-artifacts/sol-crosschain/lifi-base-alternative.json", "utf8"));
    }
    const response = await nativeFetch(input, init);
    if (url.hostname === "li.quest") {
      (0, import_node_fs.writeFileSync)(`.local-artifacts/sol-crosschain/live-${chain}-${calls.length}.json`, await response.clone().text());
    }
    return response;
  });
  setSettlementTrackingActive(true);
  const result = await getSwapQuote({
    fromChain: "solana",
    toChain: chain,
    fromToken: "So11111111111111111111111111111111111111112",
    toToken: "0x0000000000000000000000000000000000000000",
    fromSymbol: "SOL",
    toSymbol: "ETH",
    sellAmountRaw: "1000000000",
    slippageBps: 50,
    taker: "3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d",
    toAddress: "0x01faF6DFc230d755141D84d7cB980dd68f5Efe13"
  }, { swapProxyUrl: "https://api.magicmoney.dev", clientToken: "magicmoney-wallet-v1" });
  const summary = {
    chain,
    replay,
    calls,
    error: result.error,
    tool: result.quote?.bridgeTool,
    simulation: result.quote?.solanaCost?.simulationStatus,
    cost: result.quote?.solanaCost,
    routing: result.routing,
    sellAmountRaw: result.quote?.sellAmountRaw,
    recipient: result.quote?.toAddress,
    minBuyAmountRaw: result.quote?.minBuyAmountRaw,
    fee: result.quote?.appFee
  };
  (0, import_node_fs.writeFileSync)(`.local-artifacts/sol-crosschain/app-path-${chain}${replay ? "-replay" : ""}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!result.quote) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
