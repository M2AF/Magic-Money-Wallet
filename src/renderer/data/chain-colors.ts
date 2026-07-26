// Shared chain accent colors — kept in sync with the network cards (ChainCard CHAIN_META).
// Used by the App Hub to tint each app card with the colors of the chains it supports.

export interface ChainColor {
  /** Hex value, e.g. for gradients and dots. */
  hex: string
  /** "r, g, b" triple, for building rgba() with variable opacity. */
  rgb: string
}

export const CHAIN_COLORS: Record<string, ChainColor> = {
  abstract:   { hex: '#1FCE92', rgb: '31, 206, 146'   },
  apechain:   { hex: '#0066FF', rgb: '0, 102, 255'   },
  arbitrum:   { hex: '#28A0F0', rgb: '40, 160, 240'  },
  avalanche:  { hex: '#E84142', rgb: '232, 65, 66'   },
  base:       { hex: '#0052FF', rgb: '0, 82, 255'    },
  bitcoin:    { hex: '#F7931A', rgb: '247, 147, 26'  },
  'bitcoin-testnet4': { hex: '#F7931A', rgb: '247, 147, 26' },
  blast:      { hex: '#FCFC03', rgb: '252, 252, 3'   },
  cardano:    { hex: '#2A7DEA', rgb: '42, 125, 234'  },
  ethereum:   { hex: '#627EEA', rgb: '98, 126, 234'  },
  gnosis:     { hex: '#04795B', rgb: '4, 121, 91'    },
  hype:       { hex: '#00BF7D', rgb: '0, 191, 125'   },
  monad:      { hex: '#836EF9', rgb: '131, 110, 249' },
  optimism:   { hex: '#FF0420', rgb: '255, 4, 32'    },
  polygon:    { hex: '#8247E5', rgb: '130, 71, 229'  },
  robinhood:  { hex: '#00C805', rgb: '0, 200, 5'     },
  ronin:      { hex: '#1273EA', rgb: '18, 115, 234'  },
  solana:     { hex: '#9945FF', rgb: '153, 69, 255'  },
  soneium:    { hex: '#5B5EA6', rgb: '91, 94, 166'   },
  worldchain: { hex: '#5A64C8', rgb: '90, 100, 200'  },
  zora:       { hex: '#2B5DF0', rgb: '43, 93, 240'   },
}

export const FALLBACK_CHAIN_COLOR: ChainColor = { hex: '#6B7280', rgb: '107, 114, 128' }

export function chainColor(id: string): ChainColor {
  return CHAIN_COLORS[id] ?? FALLBACK_CHAIN_COLOR
}
