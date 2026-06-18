// AUTO-GENERATED — do not edit by hand.
// Source: ChainLens_Files/app-hub-data.js
// Regenerate: node scripts/convert-apphub.js

export interface AppEntry {
  id: string
  name: string
  website: string
  category: string
  chains: string[]
  featured: boolean
  favicon: string
  description: string
  chainCount: number
  coverage: number
}

export interface ChainDef    { id: string; label: string; count?: number }
export interface CategoryDef { name: string; short: string; count: number }

export interface AppHubData {
  totalApps:   number
  totalChains: number
  chains:      ChainDef[]
  categories:  CategoryDef[]
  chainStats:  Array<{ id: string; count: number }>
  apps:        AppEntry[]
}

const APP_HUB: AppHubData = {
  "totalApps": 227,
  "totalChains": 18,
  "chains": [
    {
      "id": "abstract",
      "label": "Abstract"
    },
    {
      "id": "apechain",
      "label": "ApeChain"
    },
    {
      "id": "arbitrum",
      "label": "Arbitrum"
    },
    {
      "id": "avalanche",
      "label": "Avalanche"
    },
    {
      "id": "base",
      "label": "Base"
    },
    {
      "id": "blast",
      "label": "Blast"
    },
    {
      "id": "cardano",
      "label": "Cardano"
    },
    {
      "id": "ethereum",
      "label": "Ethereum"
    },
    {
      "id": "gnosis",
      "label": "Gnosis"
    },
    {
      "id": "hype",
      "label": "HyperLiquid"
    },
    {
      "id": "monad",
      "label": "Monad"
    },
    {
      "id": "optimism",
      "label": "Optimism"
    },
    {
      "id": "polygon",
      "label": "Polygon"
    },
    {
      "id": "ronin",
      "label": "Ronin"
    },
    {
      "id": "solana",
      "label": "Solana"
    },
    {
      "id": "soneium",
      "label": "Soneium"
    },
    {
      "id": "worldchain",
      "label": "WorldChain"
    },
    {
      "id": "zora",
      "label": "Zora"
    }
  ],
  "categories": [
    {
      "name": "Bridge / Interoperability",
      "short": "Bridge",
      "count": 19
    },
    {
      "name": "DeFi",
      "short": "DeFi",
      "count": 36
    },
    {
      "name": "DEX",
      "short": "DEX",
      "count": 37
    },
    {
      "name": "Gaming",
      "short": "Gaming",
      "count": 51
    },
    {
      "name": "Launchpad",
      "short": "Launchpad",
      "count": 6
    },
    {
      "name": "Meme",
      "short": "Meme",
      "count": 5
    },
    {
      "name": "NFT Marketplace",
      "short": "NFT",
      "count": 22
    },
    {
      "name": "Portfolio & Analytics",
      "short": "Portfolio",
      "count": 26
    },
    {
      "name": "Perps & Prediction Markets",
      "short": "Prediction",
      "count": 9
    },
    {
      "name": "Wallet",
      "short": "Wallet",
      "count": 16
    }
  ],
  "chainStats": [
    {
      "id": "abstract",
      "count": 55
    },
    {
      "id": "apechain",
      "count": 10
    },
    {
      "id": "arbitrum",
      "count": 70
    },
    {
      "id": "avalanche",
      "count": 53
    },
    {
      "id": "base",
      "count": 74
    },
    {
      "id": "blast",
      "count": 36
    },
    {
      "id": "cardano",
      "count": 37
    },
    {
      "id": "ethereum",
      "count": 108
    },
    {
      "id": "gnosis",
      "count": 34
    },
    {
      "id": "hype",
      "count": 6
    },
    {
      "id": "monad",
      "count": 31
    },
    {
      "id": "optimism",
      "count": 66
    },
    {
      "id": "polygon",
      "count": 70
    },
    {
      "id": "ronin",
      "count": 12
    },
    {
      "id": "solana",
      "count": 71
    },
    {
      "id": "soneium",
      "count": 10
    },
    {
      "id": "worldchain",
      "count": 9
    },
    {
      "id": "zora",
      "count": 19
    }
  ],
  "apps": [
    {
      "id": "across-protocol",
      "name": "Across Protocol",
      "website": "https://across.to",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=across.to&sz=64",
      "description": "Description here.",
      "chainCount": 6,
      "coverage": 33,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "axelar",
      "name": "Axelar",
      "website": "https://axelar.network",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "monad",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=axelar.network&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "bungee",
      "name": "Bungee",
      "website": "https://bungee.exchange",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bungee.exchange&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "celer-network",
      "name": "Celer Network",
      "website": "https://celer.network",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=celer.network&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "chainport",
      "name": "Chainport",
      "website": "https://chainport.io",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "cardano",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=chainport.io&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "debridge",
      "name": "deBridge",
      "website": "https://debridge.finance",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=debridge.finance&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "everclear",
      "name": "Everclear",
      "website": "https://everclear.org",
      "category": "Bridge / Interoperability",
      "chains": [
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "ronin",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=connext.network&sz=128",
      "description": "Description here.",
      "chainCount": 10,
      "coverage": 56,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "hop-protocol",
      "name": "Hop Protocol",
      "website": "https://hop.exchange",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hop.exchange&sz=128",
      "description": "Description here.",
      "chainCount": 6,
      "coverage": 33,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "layerzero",
      "name": "LayerZero",
      "website": "https://layerzero.network",
      "category": "Bridge / Interoperability",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "monad",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=layerzero.network&sz=64",
      "description": "Description here.",
      "chainCount": 17,
      "coverage": 94,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lifi",
      "name": "LiFi",
      "website": "https://li.fi",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=li.fi&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "orbiter-finance",
      "name": "Orbiter Finance",
      "website": "https://orbiter.finance",
      "category": "Bridge / Interoperability",
      "chains": [
        "abstract",
        "arbitrum",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "soneium",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=orbiter.finance&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "owlto-finance",
      "name": "Owlto Finance",
      "website": "https://owlto.finance",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "soneium",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=owlto.finance&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "relay",
      "name": "Relay",
      "website": "https://relay.link",
      "category": "Bridge / Interoperability",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "hype",
        "monad",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=relay.link&sz=64",
      "description": "Description here.",
      "chainCount": 18,
      "coverage": 100,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "stargate-finance",
      "name": "Stargate Finance",
      "website": "https://stargate.finance",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=stargate.finance&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "symbiosis-finance",
      "name": "Symbiosis Finance",
      "website": "https://symbiosis.finance",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "ronin",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=symbiosis.finance&sz=128",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "synapse",
      "name": "Synapse",
      "website": "https://synapseprotocol.com",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=synapseprotocol.com&sz=128",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "thorchain",
      "name": "Thorchain",
      "website": "https://thorchain.org",
      "category": "Bridge / Interoperability",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "hype",
        "monad",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=thorchain.org&sz=128",
      "description": "Description here.",
      "chainCount": 18,
      "coverage": 100,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "wanbridge",
      "name": "WanBridge",
      "website": "https://wanchain.org",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wanchain.org&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "wormhole",
      "name": "Wormhole",
      "website": "https://wormhole.com",
      "category": "Bridge / Interoperability",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "monad",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wormhole.com&sz=64",
      "description": "Description here.",
      "chainCount": 11,
      "coverage": 61,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "aave",
      "name": "Aave",
      "website": "https://aave.com",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aave.com&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "aerodrome",
      "name": "Aerodrome",
      "website": "https://aerodrome.finance/",
      "category": "DeFi",
      "chains": [
        "base"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aerodrome.finance&sz=128",
      "description": "The central liquidity hub and primary decentralized exchange (DEX) on the Base network, utilizing a ve(3,3) tokenomics model to incentivize deep liquidity for token swaps.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "The central liquidity hub and primary decentralized exchange (DEX) on the Base network, utilizing a ve(3,3) tokenomics model to incentivize deep liquidity for token swaps."
      }
    },
    {
      "id": "alchemix",
      "name": "Alchemix",
      "website": "https://alchemix.fi",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=alchemix.fi&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "compound",
      "name": "Compound",
      "website": "https://compound.finance",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=compound.finance&sz=64",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "convex-finance",
      "name": "Convex Finance",
      "website": "https://convexfinance.com",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=convexfinance.com&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "curvance",
      "name": "Curvance",
      "website": "https://app.curvance.com/",
      "category": "DeFi",
      "chains": [
        "monad",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=curvance.com&sz=128",
      "description": "An omnichain money market and liquidity management protocol that enables users to collateralize yield-bearing assets, leverage positions, and auto-compound rewards through a simplified, one-click interface.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "An omnichain money market and liquidity management protocol that enables users to collateralize yield-bearing assets, leverage positions, and auto-compound rewards through a simplified, one-click interface."
      }
    },
    {
      "id": "dydx",
      "name": "dYdX",
      "website": "https://dydx.exchange",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dydx.exchange&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "eigenlayer",
      "name": "EigenLayer",
      "website": "https://eigenlayer.xyz",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=eigenlayer.xyz&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ens",
      "name": "ENS",
      "website": "https://ens.domains",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ens.domains&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "francium",
      "name": "Francium",
      "website": "https://francium.io",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=francium.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "frax-finance",
      "name": "Frax Finance",
      "website": "https://frax.finance",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=frax.finance&sz=64",
      "description": "Description here.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gmx",
      "name": "GMX",
      "website": "https://gmx.io",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "avalanche"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gmx.io&sz=64",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "hubble-protocol",
      "name": "Hubble Protocol",
      "website": "https://hubbleprotocol.io",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hubbleprotocol.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "indigo-protocol",
      "name": "Indigo Protocol",
      "website": "https://indigoprotocol.io",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=indigoprotocol.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "instadapp",
      "name": "InstaDapp",
      "website": "https://instadapp.io",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=instadapp.io&sz=128",
      "description": "Description here.",
      "chainCount": 6,
      "coverage": 33,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "jito",
      "name": "Jito",
      "website": "https://jito.network",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=jito.network&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "kamino-finance",
      "name": "Kamino Finance",
      "website": "https://kamino.finance",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kamino.finance&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lenfi",
      "name": "Lenfi",
      "website": "https://lenfi.io",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lenfi.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lido",
      "name": "Lido",
      "website": "https://lido.fi",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lido.fi&sz=128",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "liquity",
      "name": "Liquity",
      "website": "https://liquity.org",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=liquity.org&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "liqwid-finance",
      "name": "Liqwid Finance",
      "website": "https://liqwid.finance",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=liqwid.finance&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "makerdao",
      "name": "MakerDAO",
      "website": "https://makerdao.com",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=makerdao.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "mango-markets",
      "name": "Mango Markets",
      "website": "https://mango.markets",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=mango.markets&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "marginfi",
      "name": "Marginfi",
      "website": "https://marginfi.com",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=marginfi.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "morpho",
      "name": "Morpho",
      "website": "https://morpho.org",
      "category": "DeFi",
      "chains": [
        "base",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=morpho.org&sz=64",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "nexus-mutual",
      "name": "Nexus Mutual",
      "website": "https://nexusmutual.io",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nexusmutual.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "optim-finance",
      "name": "Optim Finance",
      "website": "https://optim.finance",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=optim.finance&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pendle",
      "name": "Pendle",
      "website": "https://pendle.finance",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pendle.finance&sz=64",
      "description": "Description here.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ribbon-finance",
      "name": "Ribbon Finance",
      "website": "https://ribbon.finance",
      "category": "DeFi",
      "chains": [
        "avalanche",
        "ethereum",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ribbon.finance&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "rocket-pool",
      "name": "Rocket Pool",
      "website": "https://rocketpool.net",
      "category": "DeFi",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rocketpool.net&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sanctum",
      "name": "Sanctum",
      "website": "https://sanctum.so",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sanctum.so&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "solend",
      "name": "Solend",
      "website": "https://solend.fi",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=solend.fi&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "spark-protocol",
      "name": "Spark Protocol",
      "website": "https://spark.fi",
      "category": "DeFi",
      "chains": [
        "ethereum",
        "gnosis"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=spark.fi&sz=64",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "synthetix",
      "name": "Synthetix",
      "website": "https://synthetix.io",
      "category": "DeFi",
      "chains": [
        "base",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=synthetix.io&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "tulip-protocol",
      "name": "Tulip Protocol",
      "website": "https://tulip.garden",
      "category": "DeFi",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=tulip.garden&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "yearn-finance",
      "name": "Yearn Finance",
      "website": "https://yearn.fi",
      "category": "DeFi",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=yearn.fi&sz=64",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "1inch-network",
      "name": "1inch Network",
      "website": "https://1inch.io",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=1inch.io&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "aborean-finance",
      "name": "Aborean Finance",
      "website": "https://aborean.finance",
      "category": "DEX",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aborean.finance&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ambient",
      "name": "Ambient",
      "website": "https://ambient.finance",
      "category": "DEX",
      "chains": [
        "base",
        "blast",
        "ethereum",
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ambient.finance&sz=64",
      "description": "Description here.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "balancer",
      "name": "Balancer",
      "website": "https://balancer.fi",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "monad",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=balancer.fi&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "bancor",
      "name": "Bancor",
      "website": "https://bancor.network",
      "category": "DEX",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bancor.network&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "blue-protocol",
      "name": "BLUE Protocol",
      "website": "https://gblue.xyz",
      "category": "DEX",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gblue.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "crema-finance",
      "name": "Crema Finance",
      "website": "https://crema.finance",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=crema.finance&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "curve-finance",
      "name": "Curve Finance",
      "website": "https://curve.fi",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "monad",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=curve.fi&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dexhunter",
      "name": "DexHunter",
      "website": "https://dexhunter.io",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dexhunter.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "drift-protocol",
      "name": "Drift Protocol",
      "website": "https://drift.trade",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=drift.trade&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "jumper-exchange",
      "name": "Jumper Exchange",
      "website": "https://jumper.exchange",
      "category": "DEX",
      "chains": [
        "abstract",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=jumper.exchange&sz=64",
      "description": "Description here.",
      "chainCount": 10,
      "coverage": 56,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "jupiter",
      "name": "Jupiter",
      "website": "https://jup.ag",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=jup.ag&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "kona",
      "name": "Kona",
      "website": "https://app.kona.surf",
      "category": "DEX",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=app.kona.surf&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "kyberswap",
      "name": "KyberSwap",
      "website": "https://kyberswap.com",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "monad",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kyberswap.com&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lfj-trader-joe",
      "name": "LFJ (Trader Joe)",
      "website": "https://lfj.gg",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lfj.gg&sz=64",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lifinity",
      "name": "Lifinity",
      "website": "https://lifinity.io",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lifinity.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "loopring",
      "name": "Loopring",
      "website": "https://loopring.org",
      "category": "DEX",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=loopring.org&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lyra",
      "name": "Lyra",
      "website": "https://lyra.finance",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lyra.finance&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "matcha",
      "name": "Matcha",
      "website": "https://matcha.xyz",
      "category": "DEX",
      "chains": [
        "abstract",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "monad",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=matcha.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "meteora",
      "name": "Meteora",
      "website": "https://meteora.ag",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=meteora.ag&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "minswap",
      "name": "Minswap",
      "website": "https://minswap.org",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=minswap.org&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "odos",
      "name": "Odos",
      "website": "https://odos.xyz",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=odos.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "openbook",
      "name": "OpenBook",
      "website": "https://openbook-dex.com",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=openbook-dex.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "openocean",
      "name": "OpenOcean",
      "website": "https://openocean.finance",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=openocean.finance&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "orca",
      "name": "Orca",
      "website": "https://orca.so",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=orca.so&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pancakeswap",
      "name": "PancakeSwap",
      "website": "https://pancakeswap.finance",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "monad",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pancakeswap.finance&sz=64",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pandora-swap",
      "name": "Pandora Swap",
      "website": "https://pandora.fun",
      "category": "DEX",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://abs.xyz/imagetransform/width=100,format=webp/https%3A%2F%2Fabstract-portal-metadata-prod.s3.amazonaws.com%2F7d15d15e-a70a-4c73-9e3e-1f1288233317.png",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "paraswap",
      "name": "Paraswap",
      "website": "https://paraswap.io",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=paraswap.io&sz=64",
      "description": "Description here.",
      "chainCount": 6,
      "coverage": 33,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "phoenix",
      "name": "Phoenix",
      "website": "https://phoenix.trade",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=phoenix.trade&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "raydium",
      "name": "Raydium",
      "website": "https://raydium.io",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=raydium.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sakura-swap",
      "name": "Sakura Swap",
      "website": "https://sakuraswap.com",
      "category": "DEX",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sakuraswap.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sundaeswap",
      "name": "SundaeSwap",
      "website": "https://sundaeswap.finance",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sundaeswap.finance&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sushiswap",
      "name": "SushiSwap",
      "website": "https://sushi.com",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sushi.com&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "uniswap",
      "name": "Uniswap",
      "website": "https://uniswap.org",
      "category": "DEX",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "monad",
        "optimism",
        "polygon",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=uniswap.org&sz=64",
      "description": "Description here.",
      "chainCount": 10,
      "coverage": 56,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "vyfinance",
      "name": "VyFinance",
      "website": "https://vyfi.org",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vyfi.org&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "wingriders",
      "name": "WingRiders",
      "website": "https://wingriders.com",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wingriders.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "zeta-markets",
      "name": "Zeta Markets",
      "website": "https://zeta.markets",
      "category": "DEX",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=zeta.markets&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "anichess",
      "name": "Anichess",
      "website": "https://anichess.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=anichess.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "aurory",
      "name": "Aurory",
      "website": "https://aurory.io",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aurory.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "axie-infinity",
      "name": "Axie Infinity",
      "website": "https://axieinfinity.com",
      "category": "Gaming",
      "chains": [
        "ethereum",
        "ronin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=axieinfinity.com&sz=128",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "bigcoin",
      "name": "Bigcoin",
      "website": "https://bigcoin.tech",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bigcoin.tech&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "breath-of-estova",
      "name": "Breath of Estova",
      "website": "https://breathofestova.com/",
      "category": "Gaming",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=breathofestova.com&sz=128",
      "description": "A 2D top-down MMORPG built on the Monad network featuring play-to-earn mechanics, real-time action combat, and a player-driven economy.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A 2D top-down MMORPG built on the Monad network featuring play-to-earn mechanics, real-time action combat, and a player-driven economy."
      }
    },
    {
      "id": "cambria",
      "name": "Cambria",
      "website": "https://cambria.gg",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cambria.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "captain-company",
      "name": "Captain & Company",
      "website": "https://capnco.gg",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=capnco.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "caves-dig-dash",
      "name": "Caves: Dig & Dash",
      "website": "https://caves.wolf.game",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=caves.wolf.game&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "decentraland",
      "name": "Decentraland",
      "website": "https://decentraland.org",
      "category": "Gaming",
      "chains": [
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=decentraland.org&sz=128",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "defi-land",
      "name": "DeFi Land",
      "website": "https://defiland.app",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=defiland.app&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "duper",
      "name": "Duper",
      "website": "https://duper.gg",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=duper.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ev.io",
      "name": "Ev.io",
      "website": "https://ev.io",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ev.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gala-games",
      "name": "Gala Games",
      "website": "https://gala.com",
      "category": "Gaming",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gala.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "genopets",
      "name": "Genopets",
      "website": "https://genopets.me",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=genopets.me&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gigachadbat",
      "name": "GIGACHADBAT",
      "website": "https://gigachadbat.fun",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gigachadbat.fun&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gigaverse",
      "name": "Gigaverse",
      "website": "https://gigaverse.io",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gigaverse.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gods-unchained",
      "name": "Gods Unchained",
      "website": "https://godsunchained.com",
      "category": "Gaming",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=godsunchained.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "illuvium",
      "name": "Illuvium",
      "website": "https://illuvium.io",
      "category": "Gaming",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=illuvium.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "khuga-bash",
      "name": "Khuga Bash",
      "website": "https://portal.khuga.io",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=portal.khuga.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "kintara",
      "name": "Kintara",
      "website": "https://kintara.gg/",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kintara.gg&sz=128",
      "description": "A browser-based isometric massively multiplayer online (MMO) game where players gather resources, battle monsters, and trade on the Solana blockchain.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A browser-based isometric massively multiplayer online (MMO) game where players gather resources, battle monsters, and trade on the Solana blockchain."
      }
    },
    {
      "id": "lingo",
      "name": "Lingo",
      "website": "https://witty.game",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=witty.game&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "maze-of-gains",
      "name": "Maze of Gains",
      "website": "https://playmog.xyz",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=playmog.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "moody-madness",
      "name": "Moody Madness",
      "website": "https://moodymadness.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=moodymadness.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "nifty-island",
      "name": "Nifty Island",
      "website": "https://niftyisland.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=niftyisland.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "onchain-heroes",
      "name": "Onchain Heroes",
      "website": "https://onchainheroes.xyz",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=onchainheroes.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pangu-clash",
      "name": "Pangu Clash",
      "website": "https://panguclash.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=panguclash.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pengu-clash",
      "name": "Pengu Clash",
      "website": "https://penguclash.io",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=penguclash.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "penguin-life",
      "name": "Penguin Life",
      "website": "https://penguinlife.playember.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=penguinlife.playember.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "plooshy-island",
      "name": "Plooshy Island",
      "website": "https://http://island.theplooshies.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=http://island.theplooshies.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "plooshy-pile-up",
      "name": "Plooshy Pile Up",
      "website": "https://pileup.theplooshies.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pileup.theplooshies.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "polar-pair-up",
      "name": "Polar Pair-Up",
      "website": "https://polarpairup.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=polarpairup.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "promotion-royale",
      "name": "Promotion Royale",
      "website": "https://play.promotionroyale.gg",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=play.promotionroyale.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "proof-of-play-arcade",
      "name": "Proof of Play Arcade",
      "website": "https://proofofplay.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=proofofplay.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pudgy-world",
      "name": "Pudgy World",
      "website": "https://pudgyworld.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pudgyworld.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "rugpull-bakery",
      "name": "Rugpull Bakery",
      "website": "https://rugpullbakery.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rugpullbakery.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ruyui-roots-of-embervault",
      "name": "Ruyui: Roots of Embervault",
      "website": "https://embervault.ruyui.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=embervault.ruyui.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sappy-seals",
      "name": "Sappy Seals",
      "website": "https://sappyseals.io",
      "category": "Gaming",
      "chains": [
        "ethereum",
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sappyseals.io&sz=64",
      "description": "Iconic Ethereum NFT collection and community hub.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Iconic Ethereum NFT collection and community hub."
      }
    },
    {
      "id": "sorare",
      "name": "Sorare",
      "website": "https://sorare.com",
      "category": "Gaming",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sorare.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "spellborne",
      "name": "Spellborne",
      "website": "https://spellborne.gg",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=spellborne.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "star-atlas",
      "name": "Star Atlas",
      "website": "https://staratlas.com",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=staratlas.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "stepn",
      "name": "STEPN",
      "website": "https://stepn.com",
      "category": "Gaming",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=stepn.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "sugartown",
      "name": "Sugartown",
      "website": "https://sugar.town",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sugar.town&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "supertripland",
      "name": "SuperTripLand",
      "website": "https://supertripland.com",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=supertripland.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "the-sandbox",
      "name": "The Sandbox",
      "website": "https://sandbox.game",
      "category": "Gaming",
      "chains": [
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sandbox.game&sz=128",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "tollan-universe",
      "name": "Tollan Universe",
      "website": "https://hub.tollan.io",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hub.tollan.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "trivia-rush",
      "name": "Trivia Rush",
      "website": "https://triviarush.fun",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=triviarush.fun&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "unchained",
      "name": "Unchained",
      "website": "https://unchained.game",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=unchained.game&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "vibes-tcg",
      "name": "Vibes TCG",
      "website": "https://vibes.game",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vibes.game&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "waifu-sweeper",
      "name": "Waifu Sweeper",
      "website": "https://waifusweeper.fun",
      "category": "Gaming",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=waifusweeper.fun&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "yield-guild-games",
      "name": "Yield Guild Games",
      "website": "https://yieldguild.io",
      "category": "Gaming",
      "chains": [
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=yieldguild.io&sz=128",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "otherside",
      "name": "Otherside",
      "website": "https://www.otherside.xyz/",
      "category": "Gaming",
      "chains": [
        "apechain"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=otherside.xyz&sz=128",
      "description": "A gamified, interoperable metaverse and metaRPG by Yuga Labs, featuring multiplayer social spaces, NFT-linked ownership, and user-created worlds on ApeChain.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A gamified, interoperable metaverse and metaRPG by Yuga Labs, featuring multiplayer social spaces, NFT-linked ownership, and user-created worlds on ApeChain."
      }
    },
    {
      "id": "build-anything",
      "name": "Build Anything",
      "website": "https://buildanything.so/",
      "category": "Launchpad",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=buildanything.so&sz=128",
      "description": "An AI-powered development platform and educational curriculum focused on helping creators build, ship, and launch applications on the Monad network.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "An AI-powered development platform and educational curriculum focused on helping creators build, ship, and launch applications on the Monad network."
      }
    },
    {
      "id": "chog-fun",
      "name": "Chog.Fun",
      "website": "https://www.chog.fun/",
      "category": "Launchpad",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=chog.fun&sz=128",
      "description": "A community-focused launchpad and platform for meme tokens and cultural projects within the Monad ecosystem, centered around the Chog mascot.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A community-focused launchpad and platform for meme tokens and cultural projects within the Monad ecosystem, centered around the Chog mascot."
      }
    },
    {
      "id": "moonit",
      "name": "Moonit",
      "website": "https://abstract.moon.it",
      "category": "Launchpad",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=abstract.moon.it&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "snek-fun",
      "name": "snek.fun",
      "website": "https://snek.fun/",
      "category": "Launchpad",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=snek.fun&sz=64",
      "description": "A fair-launch memecoin launchpad on the Cardano blockchain with built-in liquidity protection and token instant-creation mechanics.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A fair-launch memecoin launchpad on the Cardano blockchain with built-in liquidity protection and token instant-creation mechanics."
      }
    },
    {
      "id": "nad-fun",
      "name": "nad.fun",
      "website": "https://nad.fun",
      "category": "Launchpad",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nad.fun&sz=64",
      "description": "Memecoin launchpad platform.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Memecoin launchpad platform."
      }
    },
    {
      "id": "pump-fun",
      "name": "pump.fun",
      "website": "https://pump.fun",
      "category": "Launchpad",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pump.fun&sz=64",
      "description": "Memecoin launchpad platform.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Memecoin launchpad platform."
      }
    },
    {
      "id": "bob-monad",
      "name": "Bob Monad",
      "website": "https://bobmonad.com",
      "category": "Meme",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bobmonad.com&sz=128",
      "description": "Launchpad platform on Monad coming soon.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Launchpad platform on Monad coming soon."
      }
    },
    {
      "id": "emonad",
      "name": "Emonad",
      "website": "https://emonad.lol",
      "category": "Meme",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=emonad.lol&sz=64",
      "description": "I lost it all on day one.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "I lost it all on day one."
      }
    },
    {
      "id": "snek",
      "name": "Snek",
      "website": "https://snek.com",
      "category": "Meme",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=snek.com&sz=64",
      "description": "The premier culture and community-driven memecoin asset native to the Cardano blockchain ecosystem.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "The premier culture and community-driven memecoin asset native to the Cardano blockchain ecosystem."
      }
    },
    {
      "id": "chog",
      "name": "Chog",
      "website": "https://www.chog.xyz/",
      "category": "Meme",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=chog.xyz&sz=128",
      "description": "A community-driven meme project native to the Monad ecosystem.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A community-driven meme project native to the Monad ecosystem."
      }
    },
    {
      "id": "iqlabs",
      "name": "IQLabs",
      "website": "https://iqlabs.dev",
      "category": "Meme",
      "chains": [
        "ethereum",
        "monad",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=iqlabs.dev&sz=64",
      "description": "IQLabs is a inscription platform that seeks build the blockchain internet through inscribing immutable data to blockchains.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "IQLabs is a inscription platform that seeks build the blockchain internet through inscribing immutable data to blockchains."
      }
    },
    {
      "id": "backpack-wallet",
      "name": "Backpack Wallet",
      "website": "https://backpack.app",
      "category": "Wallet",
      "chains": [
        "base",
        "ethereum",
        "monad",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=backpack.app&sz=64",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "coinbase-wallet",
      "name": "Coinbase Wallet",
      "website": "https://coinbase.com/wallet",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=coinbase.com&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "eternl",
      "name": "Eternl",
      "website": "https://eternl.io",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=eternl.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "exodus",
      "name": "Exodus",
      "website": "https://exodus.com",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=exodus.com&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "flint-wallet",
      "name": "Flint Wallet",
      "website": "https://flint-wallet.io",
      "category": "Wallet",
      "chains": [
        "cardano",
        "ethereum",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=flint-wallet.io&sz=64",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lace",
      "name": "Lace",
      "website": "https://lace.io",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lace.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "metamask",
      "name": "MetaMask",
      "website": "https://metamask.io",
      "category": "Wallet",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "hype",
        "monad",
        "optimism",
        "polygon",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=metamask.io&sz=64",
      "description": "Description here.",
      "chainCount": 15,
      "coverage": 83,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "nami-wallet",
      "name": "Nami Wallet",
      "website": "https://namiwallet.io",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=namiwallet.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "phantom",
      "name": "Phantom",
      "website": "https://phantom.app",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=phantom.app&sz=64",
      "description": "Description here.",
      "chainCount": 6,
      "coverage": 33,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "rabby-wallet",
      "name": "Rabby Wallet",
      "website": "https://rabby.io",
      "category": "Wallet",
      "chains": [
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rabby.io&sz=64",
      "description": "Description here.",
      "chainCount": 12,
      "coverage": 67,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "rainbow-wallet",
      "name": "Rainbow Wallet",
      "website": "https://rainbow.me",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rainbow.me&sz=64",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "safe",
      "name": "Safe",
      "website": "https://safe.global",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=safe.global&sz=128",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "trust-wallet",
      "name": "Trust Wallet",
      "website": "https://trustwallet.com",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=trustwallet.com&sz=64",
      "description": "Description here.",
      "chainCount": 10,
      "coverage": 56,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "vespr",
      "name": "Vespr",
      "website": "https://vespr.xyz",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vespr.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "xdefi-ctrl-wallet",
      "name": "XDEFI / Ctrl Wallet",
      "website": "https://ctrl.xyz",
      "category": "Wallet",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ctrl.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "yoroi-wallet",
      "name": "Yoroi Wallet",
      "website": "https://yoroi-wallet.com",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=yoroi-wallet.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "blever",
      "name": "Blever",
      "website": "https://blever.xyz",
      "category": "NFT Marketplace",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=blever.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "wayup",
      "name": "WayUp",
      "website": "https://www.wayup.io/",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wayup.io&sz=64",
      "description": "A specialized NFT marketplace and minting platform running natively on the Cardano blockchain infrastructure.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A specialized NFT marketplace and minting platform running natively on the Cardano blockchain infrastructure."
      }
    },
    {
      "id": "blur",
      "name": "Blur",
      "website": "https://blur.io",
      "category": "NFT Marketplace",
      "chains": [
        "base",
        "blast",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=blur.io&sz=64",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "book-io",
      "name": "Book.io",
      "website": "https://book.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano",
        "ethereum",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=book.io&sz=64",
      "description": "Description here.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dyli",
      "name": "DYLI",
      "website": "https://dyli.io",
      "category": "NFT Marketplace",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dyli.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "element-market",
      "name": "Element Market",
      "website": "https://element.market",
      "category": "NFT Marketplace",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "solana",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=element.market&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "exchange.art",
      "name": "Exchange.art",
      "website": "https://exchange.art",
      "category": "NFT Marketplace",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=exchange.art&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "foundation",
      "name": "Foundation",
      "website": "https://foundation.app",
      "category": "NFT Marketplace",
      "chains": [
        "base",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=foundation.app&sz=128",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "hyperspace",
      "name": "Hyperspace",
      "website": "https://hyperspace.xyz",
      "category": "NFT Marketplace",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hyperspace.xyz&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "jpg-store",
      "name": "JPG Store",
      "website": "https://jpg.store",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=jpg.store&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "looksrare",
      "name": "LooksRare",
      "website": "https://looksrare.org",
      "category": "NFT Marketplace",
      "chains": [
        "base",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=looksrare.org&sz=64",
      "description": "Description here.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "magic-eden",
      "name": "Magic Eden",
      "website": "https://magiceden.io",
      "category": "NFT Marketplace",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=magiceden.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "mintify",
      "name": "Mintify",
      "website": "https://mintify.xyz",
      "category": "NFT Marketplace",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=mintify.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "nmkr",
      "name": "NMKR",
      "website": "https://nmkr.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nmkr.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "opensea",
      "name": "OpenSea",
      "website": "https://opensea.io",
      "category": "NFT Marketplace",
      "chains": [
        "abstract",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "optimism",
        "polygon",
        "solana",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=opensea.io&sz=64",
      "description": "Description here.",
      "chainCount": 10,
      "coverage": 56,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "rarible",
      "name": "Rarible",
      "website": "https://rarible.com",
      "category": "NFT Marketplace",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rarible.com&sz=128",
      "description": "Description here.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "scatter",
      "name": "Scatter",
      "website": "https://scatter.art",
      "category": "NFT Marketplace",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=scatter.art&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "segmint",
      "name": "SegMint",
      "website": "https://segmint.io",
      "category": "NFT Marketplace",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=segmint.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "solanart",
      "name": "Solanart",
      "website": "https://solanart.io",
      "category": "NFT Marketplace",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=solanart.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "superrare",
      "name": "SuperRare",
      "website": "https://superrare.com",
      "category": "NFT Marketplace",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=superrare.com&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "tensor",
      "name": "Tensor",
      "website": "https://tensor.trade",
      "category": "NFT Marketplace",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=tensor.trade&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "x2y2",
      "name": "X2Y2",
      "website": "https://x2y2.io",
      "category": "NFT Marketplace",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=x2y2.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "aragon",
      "name": "Aragon",
      "website": "https://aragon.org",
      "category": "Portfolio & Analytics",
      "chains": [
        "base",
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aragon.org&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "coinstats",
      "name": "CoinStats",
      "website": "https://coinstats.app",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=coinstats.app&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dappradar",
      "name": "DappRadar",
      "website": "https://dappradar.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dappradar.com&sz=64",
      "description": "Description here.",
      "chainCount": 12,
      "coverage": 67,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "debank",
      "name": "DeBank",
      "website": "https://debank.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "ronin",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=debank.com&sz=64",
      "description": "Description here.",
      "chainCount": 11,
      "coverage": 61,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "defillama",
      "name": "DefiLlama",
      "website": "https://defillama.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "cardano",
        "ethereum",
        "gnosis",
        "hype",
        "monad",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=defillama.com&sz=64",
      "description": "Description here.",
      "chainCount": 18,
      "coverage": 100,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "depth-protocol",
      "name": "DEPTH Protocol",
      "website": "https://depthsoul.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=depthsoul.com&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dexscreener",
      "name": "Dexscreener",
      "website": "https://dexscreener.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "worldchain",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dexscreener.com&sz=64",
      "description": "Description here.",
      "chainCount": 14,
      "coverage": 78,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dialect",
      "name": "Dialect",
      "website": "https://dialect.to",
      "category": "Portfolio & Analytics",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dialect.to&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "dune-analytics",
      "name": "Dune Analytics",
      "website": "https://dune.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dune.com&sz=128",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "etherscan",
      "name": "Etherscan",
      "website": "https://etherscan.io",
      "category": "Portfolio & Analytics",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=etherscan.io&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "ethos-network",
      "name": "Ethos Network",
      "website": "https://app.ethos.network/",
      "category": "Portfolio & Analytics",
      "chains": [
        "base",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ethos.network&sz=128",
      "description": "A decentralized credibility protocol that uses on-chain reputation scores, reviews, and vouching mechanisms to foster trust and accountability within the Web3 ecosystem.",
      "chainCount": 2,
      "coverage": 11,
      "categoryMeta": {
        "description": "A decentralized credibility protocol that uses on-chain reputation scores, reviews, and vouching mechanisms to foster trust and accountability within the Web3 ecosystem."
      }
    },
    {
      "id": "farcaster",
      "name": "Farcaster",
      "website": "https://farcaster.xyz",
      "category": "Portfolio & Analytics",
      "chains": [
        "base",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=farcaster.xyz&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "geckoterminal",
      "name": "GeckoTerminal",
      "website": "https://geckoterminal.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "ronin",
        "solana",
        "soneium",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=geckoterminal.com&sz=64",
      "description": "Description here.",
      "chainCount": 13,
      "coverage": 72,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "gitcoin",
      "name": "Gitcoin",
      "website": "https://gitcoin.co",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "ethereum",
        "optimism"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gitcoin.co&sz=128",
      "description": "Description here.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lens-protocol",
      "name": "Lens Protocol",
      "website": "https://lens.xyz",
      "category": "Portfolio & Analytics",
      "chains": [
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lens.xyz&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "lute",
      "name": "Lute",
      "website": "https://lute.gg",
      "category": "Portfolio & Analytics",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lute.gg&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "nansen",
      "name": "Nansen",
      "website": "https://nansen.ai",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "ronin",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nansen.ai&sz=128",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pulsar-finance",
      "name": "Pulsar Finance",
      "website": "https://pulsar.finance",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "cardano",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pulsar.finance&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "pyth-network",
      "name": "Pyth Network",
      "website": "https://pyth.network",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "monad",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pyth.network&sz=128",
      "description": "Description here.",
      "chainCount": 8,
      "coverage": 44,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "realms",
      "name": "Realms",
      "website": "https://realms.today",
      "category": "Portfolio & Analytics",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=realms.today&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "snapshot",
      "name": "Snapshot",
      "website": "https://snapshot.org",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "base",
        "ethereum",
        "optimism",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=snapshot.org&sz=128",
      "description": "Description here.",
      "chainCount": 5,
      "coverage": 28,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "squads",
      "name": "Squads",
      "website": "https://squads.so",
      "category": "Portfolio & Analytics",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=squads.so&sz=128",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "taptools",
      "name": "TapTools",
      "website": "https://taptools.io",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=taptools.io&sz=64",
      "description": "Description here.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "token-terminal",
      "name": "Token Terminal",
      "website": "https://tokenterminal.com",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=tokenterminal.com&sz=128",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "zapper",
      "name": "Zapper",
      "website": "https://zapper.xyz",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "blast",
        "ethereum",
        "gnosis",
        "optimism",
        "polygon",
        "zora"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=zapper.xyz&sz=64",
      "description": "Description here.",
      "chainCount": 9,
      "coverage": 50,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "zerion",
      "name": "Zerion",
      "website": "https://zerion.io",
      "category": "Portfolio & Analytics",
      "chains": [
        "arbitrum",
        "avalanche",
        "base",
        "ethereum",
        "optimism",
        "polygon",
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=zerion.io&sz=128",
      "description": "Description here.",
      "chainCount": 7,
      "coverage": 39,
      "categoryMeta": {
        "description": "Description here."
      }
    },
    {
      "id": "atlas",
      "name": "Atlas",
      "website": "https://www.atlasdefi.org/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=atlasdefi.org&sz=128",
      "description": "A privacy-focused yield tokenization protocol on Cardano that enables users to split yield-bearing assets into tradable Principal Tokens (PT) and Yield Tokens (YT).",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A privacy-focused yield tokenization protocol on Cardano that enables users to split yield-bearing assets into tradable Principal Tokens (PT) and Yield Tokens (YT)."
      }
    },
    {
      "id": "bean",
      "name": "Bean",
      "website": "https://bean.exchange/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bean.exchange&sz=128",
      "description": "A high-performance hybrid decentralized exchange on Monad featuring DLMM spot trading and perpetual futures with integrated privacy-preserving order execution.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A high-performance hybrid decentralized exchange on Monad featuring DLMM spot trading and perpetual futures with integrated privacy-preserving order execution."
      }
    },
    {
      "id": "crsh-market",
      "name": "CRSH Market",
      "website": "https://app.crshmarket.com/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=crshmarket.com&sz=128",
      "description": "A decentralized trading platform on Monad focusing on perpetuals and prediction markets, enabling high-efficiency derivative trading.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A decentralized trading platform on Monad focusing on perpetuals and prediction markets, enabling high-efficiency derivative trading."
      }
    },
    {
      "id": "kizzy",
      "name": "Kizzy",
      "website": "https://app.kizzy.io/home",
      "category": "Perps & Prediction Markets",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kizzy.io&sz=128",
      "description": "A social media betting platform on Monad that allows users to place real-money wagers on influencer content performance, including engagement metrics like views, likes, and follower growth.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A social media betting platform on Monad that allows users to place real-money wagers on influencer content performance, including engagement metrics like views, likes, and follower growth."
      }
    },
    {
      "id": "polymarket",
      "name": "Polymarket",
      "website": "https://polymarket.com/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "polygon",
        "ethereum",
        "solana",
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=polymarket.com&sz=64",
      "description": "A leading decentralized prediction market platform allowing users to trade on real-world event outcomes using stablecoins.",
      "chainCount": 4,
      "coverage": 22,
      "categoryMeta": {
        "description": "A leading decentralized prediction market platform allowing users to trade on real-world event outcomes using stablecoins."
      }
    },
    {
      "id": "kalshi",
      "name": "Kalshi",
      "website": "https://kalshi.com/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "ethereum",
        "solana",
        "hype"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kalshi.com&sz=64",
      "description": "A CFTC-regulated prediction market exchange for trading contracts on real-world events and economic indicators.",
      "chainCount": 3,
      "coverage": 17,
      "categoryMeta": {
        "description": "A CFTC-regulated prediction market exchange for trading contracts on real-world events and economic indicators."
      }
    },
    {
      "id": "ascend",
      "name": "Ascend",
      "website": "https://www.ascend.market/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ascend.market&sz=64",
      "description": "A decentralized prediction and perpetual market protocol built natively on the Cardano blockchain.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A decentralized prediction and perpetual market protocol built natively on the Cardano blockchain."
      }
    },
    {
      "id": "strike",
      "name": "Strike",
      "website": "https://www.strikefinance.org/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=strikefinance.org&sz=64",
      "description": "A comprehensive decentralized platform on Cardano offering perpetual futures and prediction market capabilities.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "A comprehensive decentralized platform on Cardano offering perpetual futures and prediction market capabilities."
      }
    },
    {
      "id": "hyperfoundation",
      "name": "Hype",
      "website": "https://hyperfoundation.org/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "hype"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hyperfoundation.org&sz=64",
      "description": "The non-profit foundation stewarding the Hyperliquid network, a high-performance L1 blockchain purpose-built for decentralized financial exchange.",
      "chainCount": 1,
      "coverage": 6,
      "categoryMeta": {
        "description": "The non-profit foundation stewarding the Hyperliquid network, a high-performance L1 blockchain purpose-built for decentralized financial exchange."
      }
    }
  ]
}

export default APP_HUB
