/**
 * chain-config.ts — MagicMoney Wallet Phase 4
 *
 * Single source of truth for all 18 supported networks.
 * Shared between balance-fetcher, tx-sender, and ipc-handlers.
 */

import type { WalletConfig } from './secure-store'
import { alchemyRpcUrl, heliusRpcUrl } from './api-proxy'

export interface ChainDef {
  id: string
  name: string
  type: 'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot'
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
  }
]

// ─── Combined ─────────────────────────────────────────────────────────────────

export const ALL_CHAINS: ChainDef[] = [...EVM_CHAINS, ...NON_EVM_CHAINS]

export const CHAIN_MAP: Record<string, ChainDef> = Object.fromEntries(
  ALL_CHAINS.map(c => [c.id, c])
)

export const CHAIN_ORDER: string[] = ALL_CHAINS.map(c => c.id)

// Public, keyless community RPCs — fallback for READ-ONLY native-balance calls
// when the proxy/Alchemy key is throttled or exhausted, so a balance degrades to
// a public node instead of showing "—". Never used for sends (broadcast stays on
// the proxy). Keyed by chain id; only chains whose primary RPC needs a key are listed.
export const PUBLIC_RPCS: Record<string, string[]> = {
  ethereum:   ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  arbitrum:   ['https://arb1.arbitrum.io/rpc'],
  optimism:   ['https://mainnet.optimism.io'],
  base:       ['https://mainnet.base.org'],
  polygon:    ['https://polygon-rpc.com'],
  avalanche:  ['https://api.avax.network/ext/bc/C/rpc'],
  blast:      ['https://rpc.blast.io'],
  gnosis:     ['https://rpc.gnosischain.com'],
  abstract:   ['https://api.mainnet.abs.xyz'],
  apechain:   ['https://rpc.apechain.com/http'],
  ronin:      ['https://api.roninchain.com/rpc'],
  soneium:    ['https://rpc.soneium.org'],
  worldchain: ['https://worldchain-mainnet.g.alchemy.com/public'],
  zora:       ['https://rpc.zora.energy'],
}
