/**
 * chain-config.ts — MagicMoney Wallet Phase 4
 *
 * Single source of truth for all 18 supported networks.
 * Shared between balance-fetcher, tx-sender, and ipc-handlers.
 */

import type { WalletConfig, CustomChain } from './secure-store'
import { alchemyRpcUrl, heliusRpcUrl, tronApiUrl } from './api-proxy'

export interface ChainDef {
  id: string
  name: string
  type: 'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot' | 'tron' | 'dogecoin' | 'monero' | 'zcash' | 'midnight'
  chainId?: number          // EVM only
  nativeSymbol: string
  coingeckoId: string       // for price batch lookup
  rpcUrl: (cfg: WalletConfig) => string
  explorerTx: string        // base URL — append '/' + hash
  color: string             // hex for UI accents
  colorRgb: string          // 'r, g, b' for rgba()
  alchemyNetwork?: string   // set for Alchemy-supported chains (enables token counts + history)
  blockscoutUrl?: string    // base URL of Blockscout explorer (enables token counts + history)
  etherscanApiUrl?: string  // base URL of Etherscan-compatible API (enables token counts + history)
  comingSoon?: boolean      // skip balance fetch, show "Coming Soon" in UI
}

// Monad (143) public RPC endpoints (docs.monad.xyz). Each provider has a low
// per-IP rate limit (QuickNode 25 rps, Alchemy 15 rps, etc.), so a chatty dApp
// (e.g. nad.fun) exhausts a single one instantly → throttled, slow, timeouts.
// Reads rotate across these and sends fall back through them, multiplying the
// effective throughput and surviving any one endpoint being slow/down.
export const MONAD_RPCS = [
  'https://rpc.monad.xyz',              // QuickNode  25 rps
  'https://rpc1.monad.xyz',             // Alchemy    15 rps
  'https://rpc2.monad.xyz',             // Goldsky    300/10s, eth_call history
  'https://rpc-mainnet.monadinfra.com', // MF         20 rps,  eth_call history
  // rpc3.monad.xyz (Ankr) removed — Ankr now 401s without a key.
]

// ─── EVM chains ───────────────────────────────────────────────────────────────

export const EVM_CHAINS: ChainDef[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    type: 'evm',
    chainId: 1,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('eth-mainnet', cfg),
    explorerTx: 'https://etherscan.io/tx',
    color: '#627EEA',
    colorRgb: '98, 126, 234',
    alchemyNetwork: 'eth-mainnet'
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum One',
    type: 'evm',
    chainId: 42161,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('arb-mainnet', cfg),
    explorerTx: 'https://arbiscan.io/tx',
    color: '#28A0F0',
    colorRgb: '40, 160, 240',
    alchemyNetwork: 'arb-mainnet'
  },
  {
    id: 'optimism',
    name: 'Optimism',
    type: 'evm',
    chainId: 10,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('opt-mainnet', cfg),
    explorerTx: 'https://optimistic.etherscan.io/tx',
    color: '#FF0420',
    colorRgb: '255, 4, 32',
    alchemyNetwork: 'opt-mainnet'
  },
  {
    id: 'base',
    name: 'Base',
    type: 'evm',
    chainId: 8453,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('base-mainnet', cfg),
    explorerTx: 'https://basescan.org/tx',
    color: '#0052FF',
    colorRgb: '0, 82, 255',
    alchemyNetwork: 'base-mainnet'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    type: 'evm',
    chainId: 137,
    nativeSymbol: 'POL',
    coingeckoId: 'polygon-ecosystem-token',
    rpcUrl: (cfg) => alchemyRpcUrl('polygon-mainnet', cfg),
    explorerTx: 'https://polygonscan.com/tx',
    color: '#8247E5',
    colorRgb: '130, 71, 229',
    alchemyNetwork: 'polygon-mainnet'
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    type: 'evm',
    chainId: 43114,
    nativeSymbol: 'AVAX',
    coingeckoId: 'avalanche-2',
    rpcUrl: (cfg) => alchemyRpcUrl('avax-mainnet', cfg),
    explorerTx: 'https://snowtrace.io/tx',
    color: '#E84142',
    colorRgb: '232, 65, 66',
    alchemyNetwork: 'avax-mainnet'
  },
  {
    id: 'blast',
    name: 'Blast',
    type: 'evm',
    chainId: 81457,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('blast-mainnet', cfg),
    explorerTx: 'https://blastscan.io/tx',
    color: '#FCFC03',
    colorRgb: '252, 252, 3',
    alchemyNetwork: 'blast-mainnet'
  },
  {
    id: 'gnosis',
    name: 'Gnosis',
    type: 'evm',
    chainId: 100,
    nativeSymbol: 'XDAI',
    coingeckoId: 'xdai',
    rpcUrl: (cfg) => alchemyRpcUrl('gnosis-mainnet', cfg),
    explorerTx: 'https://gnosis.blockscout.com/tx',
    color: '#04795B',
    colorRgb: '4, 121, 91',
    alchemyNetwork: 'gnosis-mainnet'
  },
  {
    id: 'monad',
    name: 'Monad',
    type: 'evm',
    chainId: 143,
    nativeSymbol: 'MON',
    coingeckoId: 'monad',
    rpcUrl: () => 'https://rpc.monad.xyz',
    explorerTx: 'https://monadexplorer.com/tx',
    color: '#836EF9',
    colorRgb: '131, 110, 249',
    blockscoutUrl: 'https://monadexplorer.com'
  },
  {
    id: 'abstract',
    name: 'Abstract',
    type: 'evm',
    chainId: 2741,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('abstract-mainnet', cfg),
    explorerTx: 'https://explorer.mainnet.abs.xyz/tx',
    color: '#6B7280',
    colorRgb: '107, 114, 128',
    alchemyNetwork: 'abstract-mainnet'
  },
  {
    id: 'apechain',
    name: 'ApeChain',
    type: 'evm',
    chainId: 33139,
    nativeSymbol: 'APE',
    coingeckoId: 'apecoin',
    rpcUrl: (cfg) => alchemyRpcUrl('apechain-mainnet', cfg),
    explorerTx: 'https://apescan.io/tx',
    color: '#0066FF',
    colorRgb: '0, 102, 255',
    alchemyNetwork: 'apechain-mainnet'
  },
  {
    id: 'robinhood',
    name: 'Robinhood Chain',
    type: 'evm',
    chainId: 4663,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('robinhood-mainnet', cfg),
    explorerTx: 'https://robinhoodchain.blockscout.com/tx',
    color: '#00C805',
    colorRgb: '0, 200, 5',
    alchemyNetwork: 'robinhood-mainnet'
  },
  {
    id: 'ronin',
    name: 'Ronin',
    type: 'evm',
    chainId: 2020,
    nativeSymbol: 'RON',
    coingeckoId: 'ronin',
    rpcUrl: (cfg) => alchemyRpcUrl('ronin-mainnet', cfg),
    explorerTx: 'https://explorer.roninchain.com/tx',
    color: '#1273EA',
    colorRgb: '18, 115, 234',
    alchemyNetwork: 'ronin-mainnet'
  },
  {
    id: 'soneium',
    name: 'Soneium',
    type: 'evm',
    chainId: 1868,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('soneium-mainnet', cfg),
    explorerTx: 'https://soneium.blockscout.com/tx',
    color: '#5B5EA6',
    colorRgb: '91, 94, 166',
    alchemyNetwork: 'soneium-mainnet'
  },
  {
    id: 'worldchain',
    name: 'WorldChain',
    type: 'evm',
    chainId: 480,
    nativeSymbol: 'WLD',
    coingeckoId: 'worldcoin-wld',
    rpcUrl: (cfg) => alchemyRpcUrl('worldchain-mainnet', cfg),
    explorerTx: 'https://worldchain-mainnet.explorer.alchemy.com/tx',
    color: '#1A1B1F',
    colorRgb: '90, 100, 200',
    alchemyNetwork: 'worldchain-mainnet'
  },
  {
    id: 'zora',
    name: 'Zora',
    type: 'evm',
    chainId: 7777777,
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('zora-mainnet', cfg),
    explorerTx: 'https://explorer.zora.energy/tx',
    color: '#2B5DF0',
    colorRgb: '43, 93, 240',
    alchemyNetwork: 'zora-mainnet'
  },
  {
    id: 'hyperevm',
    name: 'HyperEVM',
    type: 'evm',
    chainId: 998,
    nativeSymbol: 'HYPE',
    coingeckoId: 'hyperliquid',
    rpcUrl: () => 'https://rpc.hyperliquid.xyz/evm',
    explorerTx: 'https://purrsec.com/tx',
    color: '#00BF7D',
    colorRgb: '0, 191, 125',
    blockscoutUrl: 'https://purrsec.com'
  }
]

// ─── Non-EVM chains ───────────────────────────────────────────────────────────

export const NON_EVM_CHAINS: ChainDef[] = [
  {
    id: 'solana',
    name: 'Solana',
    type: 'solana',
    nativeSymbol: 'SOL',
    coingeckoId: 'solana',
    rpcUrl: (cfg) => heliusRpcUrl(cfg),
    explorerTx: 'https://solscan.io/tx',
    color: '#9945FF',
    colorRgb: '153, 69, 255'
  },
  {
    id: 'cardano',
    name: 'Cardano',
    type: 'cardano',
    nativeSymbol: 'ADA',
    coingeckoId: 'cardano',
    rpcUrl: () => 'https://cardano-mainnet.blockfrost.io/api/v0',
    explorerTx: 'https://cardanoscan.io/transaction',
    color: '#2A7DEA',
    colorRgb: '42, 125, 234'
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    type: 'bitcoin',
    nativeSymbol: 'BTC',
    coingeckoId: 'bitcoin',
    rpcUrl: () => 'https://bitcoin-mainnet.gateway.tatum.io',
    explorerTx: 'https://mempool.space/tx',
    color: '#F7931A',
    colorRgb: '247, 147, 26'
  },
  {
    id: 'polkadot',
    name: 'Polkadot',
    type: 'polkadot',
    nativeSymbol: 'DOT',
    coingeckoId: 'polkadot',
    rpcUrl: () => 'https://polkadot-mainnet.gateway.tatum.io',
    explorerTx: 'https://polkadot.subscan.io/extrinsic',
    color: '#E6007A',
    colorRgb: '230, 0, 122'
  },
  {
    id: 'tron',
    name: 'Tron',
    type: 'tron',
    nativeSymbol: 'TRX',
    coingeckoId: 'tron',
    // Tron speaks the TRON HTTP API (wallet/*), not JSON-RPC — fetchers call
    // tronApiUrl(path) directly; this is the documentary base.
    rpcUrl: (cfg) => tronApiUrl('', cfg),
    explorerTx: 'https://tronscan.org/#/transaction',
    color: '#EB0029',
    colorRgb: '235, 0, 41'
  },
  {
    id: 'dogecoin',
    name: 'Dogecoin',
    type: 'dogecoin',
    nativeSymbol: 'DOGE',
    coingeckoId: 'dogecoin',
    // UTXO chain — balance/UTXOs come from the keyless Blockbook indexers in
    // DOGE_INDEXERS (Alchemy's Doge JSON-RPC can't query an arbitrary address).
    rpcUrl: () => 'https://doge1.trezor.io',
    explorerTx: 'https://dogechain.info/tx',
    color: '#C2A633',
    colorRgb: '194, 166, 51'
  }
]

// ─── Combined ─────────────────────────────────────────────────────────────────

export const ALL_CHAINS: ChainDef[] = [...EVM_CHAINS, ...NON_EVM_CHAINS]

export const CHAIN_MAP: Record<string, ChainDef> = Object.fromEntries(
  ALL_CHAINS.map(c => [c.id, c])
)

export const CHAIN_ORDER: string[] = ALL_CHAINS.map(c => c.id)

// Public, keyless community RPCs — fallbacks appended AFTER each chain's primary
// (the proxy/Alchemy URL, or the chain's own public node). Reads (native-balance +
// connected-dApp calls) fail over down the list when the primary is throttled/down
// so a balance degrades to a public node instead of showing "—"; sends use the same
// list as a viem `fallback` transport (primary tried first, public only on a
// transport error — see tx-sender evmTransport). Keyed by chain id. Order = priority.
// NOTE: bare `rpc.ankr.com/<chain>` is intentionally NOT listed — Ankr deprecated
// keyless access (returns 401). The KEYED Ankr endpoint is appended as a reliable
// fallback at the call sites that have `config` (balance-fetcher, tx-sender) via
// api-proxy `ankrRpcUrl()`.
export const PUBLIC_RPCS: Record<string, string[]> = {
  ethereum:   ['https://cloudflare-eth.com', 'https://eth.llamarpc.com'],
  arbitrum:   ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'],
  optimism:   ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'],
  base:       ['https://mainnet.base.org', 'https://base.llamarpc.com'],
  polygon:    ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'],
  avalanche:  ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.public-rpc.com'],
  blast:      ['https://rpc.blast.io', 'https://blast.blockpi.network/v1/rpc/public'],
  gnosis:     ['https://rpc.gnosischain.com', 'https://gnosis.public-rpc.com'],
  abstract:   ['https://api.mainnet.abs.xyz', 'https://2741.rpc.thirdweb.com'],
  apechain:   ['https://rpc.apechain.com/http', 'https://apechain.calderachain.xyz/http'],
  robinhood:  ['https://rpc.mainnet.chain.robinhood.com'],
  ronin:      ['https://api.roninchain.com/rpc', 'https://ronin.rpc.thirdweb.com'],
  soneium:    ['https://rpc.soneium.org', 'https://soneium.rpc.thirdweb.com'],
  worldchain: ['https://worldchain-mainnet.g.alchemy.com/public', 'https://worldchain.rpc.thirdweb.com'],
  zora:       ['https://rpc.zora.energy', 'https://zora.rpc.thirdweb.com'],
  // hyperevm's primary (rpc.hyperliquid.xyz/evm) is already public; 1rpc is a backup.
  hyperevm:   ['https://public.1rpc.io/hyperliquid'],
  // Monad is handled separately via MONAD_RPCS (rotation) in the hot read/send paths.
}

// Public, keyless Solana RPCs — read-only fallback for the native getBalance call
// when the Helius proxy is throttled. Same JSON-RPC shape, so they're drop-in.
// Sends keep the single Helius Connection (sendRawTransaction is preflight-sensitive).
export const SOLANA_RPCS: string[] = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
  // keyed Ankr (rpc.ankr.com/solana) is appended via ankrRpcUrl() in balance-fetcher
]

// Public Bitcoin Esplora REST APIs — both expose the identical /address/{addr}
// (chain_stats / mempool_stats) shape, so they're drop-in fallbacks for the
// balance read. (blockchain.info, the bitcoind JSON-RPC gateways, and Electrum
// wss endpoints use different protocols and are intentionally not listed here.)
export const BITCOIN_ESPLORA: string[] = [
  'https://mempool.space/api',
  'https://blockstream.info/api',
]

// Keyless Dogecoin provider — BlockCypher serves balance, UTXOs, and broadcast from
// one consistent API (the UTXO equivalent of BITCOIN_ESPLORA). Blockchair is a
// balance-only display fallback (different shape, normalized in balance-fetcher).
// (Alchemy's Doge endpoint is Dogecoin-Core JSON-RPC, which can't return an
// arbitrary address balance, so it is intentionally not used here.)
export const DOGE_API_BASE = 'https://api.blockcypher.com/v1/doge/main'

// Koios — keyless Cardano API, used as a fallback when Blockfrost is down/throttled.
// Different request/response shape than Blockfrost, so it's normalized in cardano-koios.ts.
export const KOIOS_URL = 'https://api.koios.rest/api/v1'

// ═══ Privacy Mode ═════════════════════════════════════════════════════════════
// Privacy Mode is a FILTER, not a substitution: when on, the portfolio shows ONLY
// these privacy-focused chains (all mainnet — prices ARE fetched, unlike testnet
// mode). Their addresses are new optional WalletAddresses fields derived lazily
// the first time the mode is enabled. Privacy Mode and Testnet Mode are mutually
// exclusive (enforced in the set-mode IPC handlers). The dApp browser's EVM
// plumbing is intentionally untouched by this mode — only portfolio surfaces
// (dashboard, balance/token fetch, send) switch to the privacy set.

export const PRIVACY_CHAINS: ChainDef[] = [
  {
    id: 'monero',
    name: 'Monero',
    type: 'monero',
    nativeSymbol: 'XMR',
    coingeckoId: 'monero',
    // Monero speaks its own JSON-RPC (get_info, /sendrawtransaction …) served by
    // the keyless community nodes in MONERO_NODES; this is the documentary base.
    rpcUrl: () => MONERO_NODES[0],
    explorerTx: 'https://xmrchain.net/tx',
    color: '#FF6600',
    colorRgb: '255, 102, 0'
  },
  {
    id: 'zcash',
    name: 'Zcash',
    type: 'zcash',
    nativeSymbol: 'ZEC',
    coingeckoId: 'zcash',
    // Transparent-pool reads/broadcast come from the keyless providers in
    // ZCASH_APIS (Blockchair dashboards + push). Shielded (Orchard/Sapling)
    // support arrives with a vendored WebZjs WASM build — see zcash.ts.
    rpcUrl: () => 'https://api.blockchair.com/zcash',
    explorerTx: 'https://blockchair.com/zcash/transaction',
    color: '#F4B728',
    colorRgb: '244, 183, 40'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    type: 'midnight',
    nativeSymbol: 'NIGHT',
    // 'midnight-3' is the REAL Midnight Network token on CoinGecko (rank ~105);
    // the bare 'midnight' id is an unrelated dead token squatting the name.
    coingeckoId: 'midnight-3',
    // Balance reads use the public mainnet indexer (see midnight.ts); this is
    // the documentary node RPC (same one Lace points at).
    rpcUrl: () => 'https://rpc.mainnet.midnight.network',
    explorerTx: 'https://midnightscan.io/tx',
    color: '#7C3AED',
    colorRgb: '124, 58, 237'
    // Receive + balances only for now — sends need DUST fees + a proof server
    // (the dashboard renders no Send button for this chain).
  }
]

export const PRIVACY_CHAIN_MAP: Record<string, ChainDef> = Object.fromEntries(
  PRIVACY_CHAINS.map(c => [c.id, c])
)

// Keyless public Monero remote nodes (CORS-free from Node/Electron main; the
// extension/Android targets need host permissions / the Capacitor fetch router
// before they can scan — until then they render the address with a note).
// Order = priority; monero.ts fails over down the list.
export const MONERO_NODES: string[] = [
  'https://xmr-node.cakewallet.com:18081',
  'https://node.sethforprivacy.com:18089',
  'https://xmr.stormycloud.org:18089',
]

// Keyless Zcash transparent-pool providers. Blockchair serves balance + UTXOs +
// broadcast from one API (same role BlockCypher plays for Dogecoin). The Zcash
// insight-style explorer is a balance-display fallback (different shape,
// normalized in zcash.ts).
export const ZCASH_API_BASE = 'https://api.blockchair.com/zcash'
export const ZCASH_EXPLORER_API = 'https://mainnet.zcashexplorer.app/api'

// ═══ Testnet Mode ═════════════════════════════════════════════════════════════
// Testnet counterparts reuse the SAME `id` as their mainnet chain (renderer keys,
// colors, and fetch plumbing stay unchanged); only `bitcoin-testnet4` is a new id.
// Dogecoin and Polkadot are omitted — their testnets have no data provider in the
// current stack. Prices are never fetched in testnet mode (CoinGecko has none).

export const TESTNET_EVM_CHAINS: ChainDef[] = [
  {
    id: 'ethereum', name: 'Ethereum Sepolia', type: 'evm', chainId: 11155111,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('eth-sepolia', cfg),
    explorerTx: 'https://sepolia.etherscan.io/tx',
    color: '#627EEA', colorRgb: '98, 126, 234', alchemyNetwork: 'eth-sepolia'
  },
  {
    id: 'arbitrum', name: 'Arbitrum Sepolia', type: 'evm', chainId: 421614,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('arb-sepolia', cfg),
    explorerTx: 'https://sepolia.arbiscan.io/tx',
    color: '#28A0F0', colorRgb: '40, 160, 240', alchemyNetwork: 'arb-sepolia'
  },
  {
    id: 'optimism', name: 'OP Sepolia', type: 'evm', chainId: 11155420,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('opt-sepolia', cfg),
    explorerTx: 'https://sepolia-optimism.etherscan.io/tx',
    color: '#FF0420', colorRgb: '255, 4, 32', alchemyNetwork: 'opt-sepolia'
  },
  {
    id: 'base', name: 'Base Sepolia', type: 'evm', chainId: 84532,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('base-sepolia', cfg),
    explorerTx: 'https://sepolia.basescan.org/tx',
    color: '#0052FF', colorRgb: '0, 82, 255', alchemyNetwork: 'base-sepolia'
  },
  {
    id: 'polygon', name: 'Polygon Amoy', type: 'evm', chainId: 80002,
    nativeSymbol: 'POL', coingeckoId: 'polygon-ecosystem-token',
    rpcUrl: (cfg) => alchemyRpcUrl('polygon-amoy', cfg),
    explorerTx: 'https://amoy.polygonscan.com/tx',
    color: '#8247E5', colorRgb: '130, 71, 229', alchemyNetwork: 'polygon-amoy'
  },
  {
    id: 'avalanche', name: 'Avalanche Fuji', type: 'evm', chainId: 43113,
    nativeSymbol: 'AVAX', coingeckoId: 'avalanche-2',
    rpcUrl: (cfg) => alchemyRpcUrl('avax-fuji', cfg),
    explorerTx: 'https://testnet.snowtrace.io/tx',
    color: '#E84142', colorRgb: '232, 65, 66', alchemyNetwork: 'avax-fuji'
  },
  {
    id: 'blast', name: 'Blast Sepolia', type: 'evm', chainId: 168587773,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('blast-sepolia', cfg),
    explorerTx: 'https://sepolia.blastscan.io/tx',
    color: '#FCFC03', colorRgb: '252, 252, 3', alchemyNetwork: 'blast-sepolia'
  },
  {
    id: 'gnosis', name: 'Gnosis Chiado', type: 'evm', chainId: 10200,
    nativeSymbol: 'XDAI', coingeckoId: 'xdai',
    rpcUrl: () => 'https://rpc.chiadochain.net',
    explorerTx: 'https://gnosis-chiado.blockscout.com/tx',
    color: '#04795B', colorRgb: '4, 121, 91',
    blockscoutUrl: 'https://gnosis-chiado.blockscout.com'
  },
  {
    id: 'monad', name: 'Monad Testnet', type: 'evm', chainId: 10143,
    nativeSymbol: 'MON', coingeckoId: 'monad',
    rpcUrl: () => 'https://testnet-rpc.monad.xyz',
    explorerTx: 'https://testnet.monadexplorer.com/tx',
    color: '#836EF9', colorRgb: '131, 110, 249',
    blockscoutUrl: 'https://testnet.monadexplorer.com'
  },
  {
    id: 'abstract', name: 'Abstract Testnet', type: 'evm', chainId: 11124,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('abstract-testnet', cfg),
    explorerTx: 'https://sepolia.abscan.org/tx',
    color: '#6B7280', colorRgb: '107, 114, 128', alchemyNetwork: 'abstract-testnet'
  },
  {
    id: 'apechain', name: 'ApeChain Curtis', type: 'evm', chainId: 33111,
    nativeSymbol: 'APE', coingeckoId: 'apecoin',
    rpcUrl: (cfg) => alchemyRpcUrl('apechain-curtis', cfg),
    explorerTx: 'https://curtis.explorer.caldera.xyz/tx',
    color: '#0066FF', colorRgb: '0, 102, 255', alchemyNetwork: 'apechain-curtis'
  },
  {
    id: 'robinhood', name: 'Robinhood Chain Testnet', type: 'evm', chainId: 46630,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('robinhood-testnet', cfg),
    explorerTx: 'https://explorer.testnet.chain.robinhood.com/tx',
    color: '#00C805', colorRgb: '0, 200, 5', alchemyNetwork: 'robinhood-testnet'
  },
  {
    id: 'ronin', name: 'Ronin Saigon', type: 'evm', chainId: 2021,
    nativeSymbol: 'RON', coingeckoId: 'ronin',
    rpcUrl: (cfg) => alchemyRpcUrl('ronin-saigon', cfg),
    explorerTx: 'https://saigon-app.roninchain.com/tx',
    color: '#1273EA', colorRgb: '18, 115, 234', alchemyNetwork: 'ronin-saigon'
  },
  {
    id: 'soneium', name: 'Soneium Minato', type: 'evm', chainId: 1946,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('soneium-minato', cfg),
    explorerTx: 'https://soneium-minato.blockscout.com/tx',
    color: '#5B5EA6', colorRgb: '91, 94, 166', alchemyNetwork: 'soneium-minato',
    blockscoutUrl: 'https://soneium-minato.blockscout.com'
  },
  {
    id: 'worldchain', name: 'World Chain Sepolia', type: 'evm', chainId: 4801,
    nativeSymbol: 'WLD', coingeckoId: 'worldcoin-wld',
    rpcUrl: (cfg) => alchemyRpcUrl('worldchain-sepolia', cfg),
    explorerTx: 'https://worldchain-sepolia.explorer.alchemy.com/tx',
    color: '#1A1B1F', colorRgb: '90, 100, 200', alchemyNetwork: 'worldchain-sepolia'
  },
  {
    id: 'zora', name: 'Zora Sepolia', type: 'evm', chainId: 999999999,
    nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    rpcUrl: (cfg) => alchemyRpcUrl('zora-sepolia', cfg),
    explorerTx: 'https://sepolia.explorer.zora.energy/tx',
    color: '#2B5DF0', colorRgb: '43, 93, 240', alchemyNetwork: 'zora-sepolia'
  },
  {
    id: 'hyperevm', name: 'HyperEVM Testnet', type: 'evm', chainId: 998,
    nativeSymbol: 'HYPE', coingeckoId: 'hyperliquid',
    rpcUrl: () => 'https://rpc.hyperliquid-testnet.xyz/evm',
    explorerTx: 'https://testnet.purrsec.com/tx',
    color: '#00BF7D', colorRgb: '0, 191, 125'
  }
]

export const TESTNET_NON_EVM_CHAINS: ChainDef[] = [
  {
    id: 'solana', name: 'Solana Devnet', type: 'solana',
    nativeSymbol: 'SOL', coingeckoId: 'solana',
    // Devnet is served keyless by the canonical public RPC (no Helius route needed).
    rpcUrl: () => 'https://api.devnet.solana.com',
    explorerTx: 'https://solscan.io/tx',   // append ?cluster=devnet at link time
    color: '#9945FF', colorRgb: '153, 69, 255'
  },
  {
    id: 'cardano', name: 'Cardano Preprod', type: 'cardano',
    nativeSymbol: 'ADA', coingeckoId: 'cardano',
    // Blockfrost keys are network-scoped (mainnet key ≠ preprod), so testnet reads
    // go through keyless Koios preprod instead (see activeKoiosUrl / balance-fetcher).
    rpcUrl: () => 'https://preprod.koios.rest/api/v1',
    explorerTx: 'https://preprod.cardanoscan.io/transaction',
    color: '#2A7DEA', colorRgb: '42, 125, 234'
  },
  {
    id: 'bitcoin', name: 'Bitcoin Testnet3', type: 'bitcoin',
    nativeSymbol: 'BTC', coingeckoId: 'bitcoin',
    rpcUrl: () => 'https://mempool.space/testnet/api',
    explorerTx: 'https://mempool.space/testnet/tx',
    color: '#F7931A', colorRgb: '247, 147, 26'
  },
  {
    id: 'bitcoin-testnet4', name: 'Bitcoin Testnet4', type: 'bitcoin',
    nativeSymbol: 'BTC', coingeckoId: 'bitcoin',
    rpcUrl: () => 'https://mempool.space/testnet4/api',
    explorerTx: 'https://mempool.space/testnet4/tx',
    color: '#F7931A', colorRgb: '247, 147, 26'
  },
  {
    id: 'tron', name: 'Tron Shasta', type: 'tron',
    nativeSymbol: 'TRX', coingeckoId: 'tron',
    // Shasta is served keyless by TronGrid (no Alchemy/Worker route needed).
    rpcUrl: () => 'https://api.shasta.trongrid.io',
    explorerTx: 'https://shasta.tronscan.org/#/transaction',
    color: '#EB0029', colorRgb: '235, 0, 41'
  },
  {
    id: 'midnight', name: 'Midnight Preprod', type: 'midnight',
    nativeSymbol: 'NIGHT', coingeckoId: 'midnight-3',
    rpcUrl: () => 'https://rpc.preprod.midnight.network',
    // No confirmed public Preprod block explorer yet — left blank rather than
    // guessed; unused by anything today (see midnight-send.ts's own explorer
    // URL handling, which already returns '' for preprod sends).
    explorerTx: '',
    color: '#7C3AED', colorRgb: '124, 58, 237'
  }
]

export const TESTNET_ALL_CHAINS: ChainDef[] = [...TESTNET_EVM_CHAINS, ...TESTNET_NON_EVM_CHAINS]

export const TESTNET_CHAIN_MAP: Record<string, ChainDef> = Object.fromEntries(
  TESTNET_ALL_CHAINS.map(c => [c.id, c])
)

// Keyless public testnet RPC fallbacks (same failover role as PUBLIC_RPCS). Also
// the working path for Alchemy-slug chains until the Worker's ALCHEMY_NETWORKS
// allowlist is extended with the testnet slugs and redeployed.
export const TESTNET_PUBLIC_RPCS: Record<string, string[]> = {
  ethereum:   ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
  arbitrum:   ['https://sepolia-rollup.arbitrum.io/rpc'],
  optimism:   ['https://sepolia.optimism.io'],
  base:       ['https://sepolia.base.org'],
  polygon:    ['https://rpc-amoy.polygon.technology'],
  avalanche:  ['https://api.avax-test.network/ext/bc/C/rpc'],
  blast:      ['https://sepolia.blast.io'],
  gnosis:     ['https://rpc.chiadochain.net'],
  monad:      ['https://testnet-rpc.monad.xyz'],
  abstract:   ['https://api.testnet.abs.xyz'],
  apechain:   ['https://curtis.rpc.caldera.xyz/http'],
  robinhood:  ['https://rpc.testnet.chain.robinhood.com'],
  ronin:      ['https://saigon-testnet.roninchain.com/rpc'],
  soneium:    ['https://rpc.minato.soneium.org'],
  worldchain: ['https://worldchain-sepolia.g.alchemy.com/public'],
  zora:       ['https://sepolia.rpc.zora.energy'],
  hyperevm:   ['https://rpc.hyperliquid-testnet.xyz/evm'],
}

export const TESTNET_SOLANA_RPCS: string[] = [
  'https://api.devnet.solana.com',
]

// Esplora bases per Bitcoin network (blockstream.info serves testnet3 only).
export const TESTNET_BITCOIN_ESPLORA: string[] = [
  'https://mempool.space/testnet/api',
  'https://blockstream.info/testnet/api',
]
export const TESTNET4_BITCOIN_ESPLORA: string[] = [
  'https://mempool.space/testnet4/api',
]

export const TESTNET_KOIOS_URL = 'https://preprod.koios.rest/api/v1'

// Sepolia — the reset/default EVM chain for the dApp browser in testnet mode.
export const TESTNET_DEFAULT_EVM_CHAIN_ID = 11155111

// ─── Custom chains (user-added EVM networks) ──────────────────────────────────
// MetaMask-style manual adds, persisted in config.customChains. Mainnet mode
// only — Testnet Mode swaps the whole set and Privacy Mode is a filter, so both
// hide them. White is the placeholder accent until a chain is supported
// natively with its real brand color.

export const CUSTOM_CHAIN_COLOR = '#FFFFFF'
export const CUSTOM_CHAIN_COLOR_RGB = '255, 255, 255'

export function customChainDefs(cfg: WalletConfig): ChainDef[] {
  const builtinIds = new Set(EVM_CHAINS.map(c => c.chainId))
  return (cfg.customChains ?? [])
    .filter(c => !builtinIds.has(c.chainId))   // never shadow a built-in chain
    .map((c: CustomChain): ChainDef => ({
      id: c.id,
      name: c.name,
      type: 'evm',
      chainId: c.chainId,
      nativeSymbol: c.nativeSymbol,
      coingeckoId: '',                          // unknown token → no USD price
      rpcUrl: () => c.rpcUrl,
      explorerTx: c.explorerTx,
      color: CUSTOM_CHAIN_COLOR,
      colorRgb: CUSTOM_CHAIN_COLOR_RGB
    }))
}

// ─── Mode-aware selectors ─────────────────────────────────────────────────────
// Every consumer that needs the active network set goes through these with a
// freshly-loaded WalletConfig, so flipping `testnetMode` takes effect on the
// next IPC call without restarts.

export const isTestnet = (cfg: WalletConfig): boolean => !!cfg.testnetMode

// Privacy Mode — mutually exclusive with Testnet Mode (the set-mode handlers turn
// the other one off), but isPrivacy still guards on !testnetMode as defense in
// depth against a hand-edited config.json carrying both flags.
export const isPrivacy = (cfg: WalletConfig): boolean => !!cfg.privacyMode && !cfg.testnetMode

// Midnight has no manual network switcher — it rides the two existing global
// modes instead: Testnet Mode -> Preprod, Privacy Mode -> Mainnet. Null means
// neither mode is on, so Midnight isn't shown at all (unchanged from before).
export function midnightNetworkFor(cfg: WalletConfig): 'mainnet' | 'preprod' | null {
  if (isTestnet(cfg)) return 'preprod'
  if (isPrivacy(cfg)) return 'mainnet'
  return null
}

export function activeEvmChains(cfg: WalletConfig): ChainDef[] {
  // Privacy Mode does not alter the EVM set — the dApp browser keeps working on
  // EVM networks; only portfolio surfaces switch to PRIVACY_CHAINS.
  return isTestnet(cfg) ? TESTNET_EVM_CHAINS : [...EVM_CHAINS, ...customChainDefs(cfg)]
}

export function activeChains(cfg: WalletConfig): ChainDef[] {
  if (isPrivacy(cfg)) return PRIVACY_CHAINS
  return isTestnet(cfg) ? TESTNET_ALL_CHAINS : [...ALL_CHAINS, ...customChainDefs(cfg)]
}

export function activeChainMap(cfg: WalletConfig): Record<string, ChainDef> {
  if (isPrivacy(cfg)) return PRIVACY_CHAIN_MAP
  if (isTestnet(cfg)) return TESTNET_CHAIN_MAP
  const custom = customChainDefs(cfg)
  return custom.length === 0
    ? CHAIN_MAP
    : { ...CHAIN_MAP, ...Object.fromEntries(custom.map(c => [c.id, c])) }
}

export function activePublicRpcs(cfg: WalletConfig): Record<string, string[]> {
  return isTestnet(cfg) ? TESTNET_PUBLIC_RPCS : PUBLIC_RPCS
}

export function activeSolanaRpcs(cfg: WalletConfig): string[] {
  return isTestnet(cfg) ? TESTNET_SOLANA_RPCS : SOLANA_RPCS
}

/** Esplora bases for a bitcoin-family chain id ('bitcoin' | 'bitcoin-testnet4'). */
export function esploraBases(chainId: string, cfg: WalletConfig): string[] {
  if (!isTestnet(cfg)) return BITCOIN_ESPLORA
  return chainId === 'bitcoin-testnet4' ? TESTNET4_BITCOIN_ESPLORA : TESTNET_BITCOIN_ESPLORA
}

export function activeKoiosUrl(cfg: WalletConfig): string {
  return isTestnet(cfg) ? TESTNET_KOIOS_URL : KOIOS_URL
}

export function defaultDappChainId(cfg: WalletConfig): number {
  return isTestnet(cfg) ? TESTNET_DEFAULT_EVM_CHAIN_ID : 1
}
