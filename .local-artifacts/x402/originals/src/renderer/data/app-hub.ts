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
  "totalApps": 432,
  "totalChains": 19,
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
      "id": "bitcoin",
      "label": "Bitcoin"
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
      "count": 54
    },
    {
      "name": "DEX",
      "short": "DEX",
      "count": 47
    },
    {
      "name": "Gaming",
      "short": "Gaming",
      "count": 53
    },
    {
      "name": "Launchpad",
      "short": "Launchpad",
      "count": 7
    },
    {
      "name": "Meme",
      "short": "Meme",
      "count": 6
    },
    {
      "name": "NFT Marketplace",
      "short": "NFT",
      "count": 36
    },
    {
      "name": "Portfolio & Analytics",
      "short": "Portfolio",
      "count": 31
    },
    {
      "name": "Perps & Prediction Markets",
      "short": "Prediction",
      "count": 23
    },
    {
      "name": "Wallet",
      "short": "Wallet",
      "count": 23
    },
    {
      "name": "AI",
      "short": "AI",
      "count": 10
    },
    {
      "name": "Stablecoins",
      "short": "Stable",
      "count": 4
    },
    {
      "name": "Identity",
      "short": "Identity",
      "count": 22
    },
    {
      "name": "Minting Services",
      "short": "Minting",
      "count": 9
    },
    {
      "name": "Social",
      "short": "Social",
      "count": 25
    },
    {
      "name": "Payments",
      "short": "Payments",
      "count": 27
    },
    {
      "name": "Real World Assets",
      "short": "RWA",
      "count": 36
    }
  ],
  "chainStats": [
    {
      "id": "abstract",
      "count": 58
    },
    {
      "id": "apechain",
      "count": 12
    },
    {
      "id": "arbitrum",
      "count": 72
    },
    {
      "id": "avalanche",
      "count": 56
    },
    {
      "id": "base",
      "count": 77
    },
    {
      "id": "bitcoin",
      "count": 9
    },
    {
      "id": "blast",
      "count": 38
    },
    {
      "id": "cardano",
      "count": 229
    },
    {
      "id": "ethereum",
      "count": 114
    },
    {
      "id": "gnosis",
      "count": 36
    },
    {
      "id": "hype",
      "count": 9
    },
    {
      "id": "monad",
      "count": 37
    },
    {
      "id": "optimism",
      "count": 68
    },
    {
      "id": "polygon",
      "count": 74
    },
    {
      "id": "ronin",
      "count": 14
    },
    {
      "id": "solana",
      "count": 76
    },
    {
      "id": "soneium",
      "count": 12
    },
    {
      "id": "worldchain",
      "count": 11
    },
    {
      "id": "zora",
      "count": 21
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
      "description": "An intents-based cross-chain bridge for fast, low-cost transfers between Ethereum and its layer-2s.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "A cross-chain communication network connecting blockchains for asset transfers and interoperable dApps.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A bridge aggregator that finds the best route to move assets across chains.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A cross-chain interoperability protocol for bridging tokens and messages between blockchains.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A secure cross-chain bridge for porting tokens between major blockchains.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A high-speed cross-chain bridge and messaging protocol for transferring assets and data.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A clearing layer that nets and settles cross-chain liquidity for bridges and solvers.",
      "chainCount": 10,
      "coverage": 53
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
      "description": "A bridge for moving tokens quickly across Ethereum and its rollup networks.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "An omnichain interoperability protocol enabling messaging and apps across many blockchains.",
      "chainCount": 17,
      "coverage": 89
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
      "description": "A cross-chain bridge and DEX aggregator that routes swaps and transfers across chains.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A decentralized cross-rollup bridge for low-cost transfers between Ethereum layer-2s.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A cross-chain bridge for fast, low-fee transfers across layer-2 networks.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "An instant, low-cost bridging and cross-chain execution protocol.",
      "chainCount": 18,
      "coverage": 95
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
      "description": "A LayerZero-based bridge for transferring native assets across chains with unified liquidity.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A cross-chain DEX and bridge for swapping tokens across any supported network.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A cross-chain bridge and AMM for transferring assets and stablecoins between blockchains.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A decentralized cross-chain liquidity network for swapping native assets without wrapping.",
      "chainCount": 18,
      "coverage": 95
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
      "description": "Wanchain's cross-chain bridge connecting Ethereum, Cardano, and other blockchains.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A cross-chain messaging protocol connecting Solana, Ethereum, and many other networks.",
      "chainCount": 11,
      "coverage": 58
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
      "favicon": "https://aave.com/images/icon-aave-app.png",
      "description": "A leading decentralized lending protocol for borrowing and earning yield on crypto assets.",
      "chainCount": 7,
      "coverage": 37
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
      "coverage": 5
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
      "description": "A self-repaying loan protocol where deposited collateral pays off debt through yield.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "An algorithmic money market protocol for lending and borrowing crypto assets.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "A yield platform that boosts rewards for Curve liquidity providers and stakers.",
      "chainCount": 3,
      "coverage": 16
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
      "coverage": 11
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
      "description": "A decentralized exchange for perpetual futures trading.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An Ethereum restaking protocol that secures new services with staked ETH.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A leveraged yield-farming protocol on Solana.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized stablecoin and DeFi protocol ecosystem.",
      "chainCount": 4,
      "coverage": 21
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
      "description": "A decentralized perpetual and spot exchange with low-slippage leveraged trading.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A Solana protocol for borrowing against crypto collateral and minting stablecoins.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano protocol for minting synthetic assets that track real-world prices.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DeFi management platform for handling positions across lending protocols.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "A Solana liquid-staking protocol and MEV infrastructure provider.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana protocol for automated liquidity, lending, and leveraged yield strategies.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano protocol for permissionless lending and borrowing.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A liquid-staking protocol that issues tradable tokens for staked assets.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "A decentralized borrowing protocol issuing an interest-free stablecoin against ETH.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano lending and borrowing market for earning interest and taking loans.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "The protocol behind the DAI stablecoin, backed by on-chain collateral.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana decentralized exchange for margin trading and lending.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana lending protocol for borrowing and earning on deposits.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized lending protocol optimizing rates with peer-to-peer matching and isolated markets.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A decentralized insurance alternative covering smart-contract and protocol risks.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano yield-optimization and structured-products protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "pendle",
      "name": "Pendle",
      "website": "https://www.pendle.finance/",
      "category": "DeFi",
      "chains": [
        "ethereum",
        "monad",
        "optimism",
        "hype",
        "base",
        "arbitrum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pendle.finance&sz=64",
      "description": "A yield-trading protocol that allows users to tokenize and trade future yield, enhancing capital efficiency across multiple ecosystems as shown in image_15e6be.png.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "A protocol for automated options-based structured products and yield vaults.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A decentralized Ethereum staking protocol with the rETH liquid-staking token.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana liquidity layer and infrastructure for liquid-staking tokens.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana lending and borrowing protocol.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A MakerDAO-aligned lending market for borrowing and saving with DAI.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A derivatives liquidity protocol for trading synthetic assets and perpetuals.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A Solana yield-aggregation and leveraged-farming protocol.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A yield-aggregation protocol that automates DeFi strategies across vaults.",
      "chainCount": 5,
      "coverage": 26
    },
    {
      "id": "fluidtokens",
      "name": "FluidTokens",
      "website": "https://fluidtokens.com",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=fluidtokens.com&sz=64",
      "description": "An NFT-DeFi bridge on Cardano enabling users to borrow liquidity against NFT collateral or earn yield by providing loans backed by digital assets.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "genius-yield",
      "name": "Genius Yield",
      "website": "https://www.geniusyield.co",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=geniusyield.co&sz=64",
      "description": "An all-in-one DeFi platform on Cardano combining a concentrated liquidity DEX with an AI-powered automated yield optimizer.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DEX aggregator that finds the best swap rates across decentralized exchanges.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A ve(3,3) decentralized exchange and liquidity hub on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized exchange running its entire AMM in a single smart contract.",
      "chainCount": 4,
      "coverage": 21
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
      "description": "An automated market maker with customizable multi-token liquidity pools.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "An on-chain liquidity protocol with single-sided staking.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An OlympusDAO-style reserve-currency DeFi protocol using bonding and staking, on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana concentrated-liquidity decentralized exchange.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized exchange optimized for low-slippage stablecoin and pegged-asset swaps.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A Cardano DEX aggregator routing trades for the best token prices.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana decentralized exchange for perpetual futures and spot trading.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "gravity",
      "name": "Gravity",
      "website": "https://gravitydex.app/",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gravitydex.app&sz=64",
      "description": "A decentralized exchange built on the Cardano blockchain, facilitating secure token swapping and liquidity provision.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "fomo",
      "name": "fomo",
      "website": "https://fomo.family/",
      "category": "DeFi",
      "chains": [
        "solana",
        "base",
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=fomo.family&sz=64",
      "description": "A social-first crypto trading app that enables cross-chain trading, real-time social signals, and unified balance management across multiple blockchains.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A multi-chain swap and bridge aggregator powered by LiFi.",
      "chainCount": 10,
      "coverage": 53
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
      "description": "Solana's leading swap aggregator for the best token prices across DEXs.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DeFi platform on Abstract offering DEX swaps, lending, and yield as a liquidity hub.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DEX aggregator and liquidity protocol for optimized multi-chain swaps.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A decentralized exchange on Avalanche and beyond, formerly Trader Joe.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "A Solana proactive market-maker DEX using oracle-based pricing.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An Ethereum layer-2 zkRollup for low-cost token trading and payments.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized options trading protocol.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A user-friendly DEX aggregator powered by 0x for best-price swaps.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A Solana liquidity protocol with dynamic and concentrated-liquidity pools.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano multi-pool decentralized exchange with yield farming.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DEX aggregator that optimizes complex multi-token swap routes.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A Solana on-chain central limit order book DEX.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DEX and CEX aggregator for best-price swaps across many chains.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A user-friendly Solana decentralized exchange with concentrated liquidity.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-chain decentralized exchange with swaps, farms, and yield.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "The first ERC-404 project, blending ERC-20 liquidity with NFT fractionalization, on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A DEX aggregator delivering optimized swap prices across chains.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "A Solana automated market maker and liquidity provider.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Uniswap V3-based decentralized exchange on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano automated market maker decentralized exchange.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-chain decentralized exchange for swaps, farming, and lending.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "The leading decentralized exchange protocol for swapping ERC-20 tokens.",
      "chainCount": 10,
      "coverage": 53
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
      "description": "A Cardano DeFi hub with a DEX and auto-harvesting yield vaults.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano automated market maker DEX with staking rewards.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana decentralized exchange for perpetual futures and options.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cswap-dex",
      "name": "CSWAP DEX",
      "website": "https://www.cswap.info",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cswap.info&sz=64",
      "description": "A progressive DEX for the Cardano ecosystem merging next-generation DEX capabilities with NFTfi.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "muesliswap",
      "name": "MuesliSwap",
      "website": "https://ada.muesliswap.com",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=muesliswap.com&sz=64",
      "description": "A live and operating DEX on Cardano based on a research-driven order book protocol tailored for Cardano's UTxO model.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "splash",
      "name": "Splash",
      "website": "https://splash.trade",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=splash.trade&sz=64",
      "description": "A decentralized exchange on Cardano by Spectrum Labs featuring concentrated liquidity and efficient on-chain order matching.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A chess game that blends traditional chess with magical spell-based mechanics.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana free-to-play tactical RPG with NFT creatures called Nefties.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A monster-battling and breeding game where players collect and battle Axies.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "An on-chain mining game on Abstract inspired by Bitcoin, where NFT miners earn $BIG.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "description": "An experimental on-chain MMO with PvP, PvE, skilling, and trading in a medieval world.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A pirate MMORPG with multiplayer naval ship combat, looting, and a player-crafted economy.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A fast-paced Wolf Game arcade title on Abstract where players dig caves for treasure and rewards.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A virtual world where users own land, build experiences, and trade NFTs.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A gamified, farming-themed interface for DeFi activities on Solana.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A browser strategy game blending poker, trading, and diplomacy in 20-minute matches on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A browser-based first-person shooter with Solana-based rewards and NFTs.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Web3 gaming platform and publisher of blockchain games.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana move-to-earn game where players evolve digital pets through activity.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A fast, reflex-based Web3 baseball game on Abstract by YGG Play and Delabs.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A browser RPG on Abstract with dungeon runs, pet racing, and a player-driven marketplace.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A free-to-play trading card game with player-owned NFT cards.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An open-world RPG and auto-battler with collectible creatures called Illuvials.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multiplayer action brawler where players battle as warrior cats from the Khuga universe.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "description": "A first-person word-puzzle exploration game, an early title on the Witty platform.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A roguelite dungeon-crawler game from the Onchain Heroes universe.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A chaotic Web3 multiplayer kart-racing game on Abstract with NFT kart parts.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A build-and-play gaming metaverse where creators make and monetize games.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A connected on-chain game universe whose flagship title is the roguelite Maze of Gains.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A competitive on-chain multiplayer game on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A skill-based 1v1 minigame battler from Pudgy Penguins.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A cozy mobile simulation game by PlayEmber where players grow a penguin island.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multiplayer world in The Plooshies universe for exploring, decorating, and mining resources.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A casual stacking game and the first title in The Plooshies universe on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A casual memory card-matching game on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An office-themed social-deduction bluffing game with on-chain ETH prize pools on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An arcade of fully on-chain games from the studio behind Pirate Nation.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A browser social game set in the Pudgy Penguins universe on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A satirical strategy game on Abstract where players bake cookies and 'rug' rivals for ETH.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A top-down pixel-art RPG on Abstract with real-time combat, crafting, and a player economy.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 11
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
      "description": "A global fantasy sports game with officially licensed NFT player cards.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A retro-style monster-collecting MMORPG where players catch, raise, and battle creatures.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana space-exploration grand-strategy game and metaverse.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A move-to-earn lifestyle app rewarding users for walking and running.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "Zynga's Web3 gaming world built around the Oddie NFT characters.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A free-to-play browser multiplayer FPS shooter, launching on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A virtual world where players build, own, and monetize gaming experiences.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A survivors-style action game on Abstract where players fight enemy waves and upgrade abilities.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A live trivia game where players answer questions to compete for prizes.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An 80s-style dungeon-crawler battle royale on Abstract with fast matches and instant payouts.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "The official Pudgy Penguins trading card game, digital and physical, built on Abstract.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Minesweeper-inspired skill-based puzzle game on Abstract with collectible anime characters.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A gaming guild and DAO that invests in and scholarships NFT game assets.",
      "chainCount": 2,
      "coverage": 11
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
      "coverage": 5
    },
    {
      "id": "blitz-tcg",
      "name": "Blitz TCG",
      "website": "https://blitztcg.com",
      "category": "Gaming",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=blitztcg.com&sz=64",
      "description": "A competitive blockchain-based trading card game on Cardano where players own their cards as NFTs and participate in player-governed tournaments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cornucopias",
      "name": "Cornucopias",
      "website": "https://cornucopias.io",
      "category": "Gaming",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cornucopias.io&sz=64",
      "description": "A massive Play-To-Earn Cardano blockchain-based game set in a vibrant metaverse where players can own land, build, and earn through gameplay.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "description": "A token-launch and meme-trading platform where creators launch tokens and earn fees.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
    },
    {
      "id": "coinecta-finance",
      "name": "Coinecta Finance",
      "website": "https://coinecta.fi",
      "category": "Launchpad",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=coinecta.fi&sz=64",
      "description": "A next-generation token launch platform on Cardano connecting innovative blockchain projects with early supporters through transparent and fair launches.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 16
    },
    {
      "id": "hosky-token",
      "name": "Hosky Token",
      "website": "https://hosky.io",
      "category": "Meme",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hosky.io&sz=64",
      "description": "The premiere low-quality meme token on the Cardano ecosystem, embracing its own absurdity as a community-driven cultural experiment.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "abstract-global-wallet",
      "name": "Abstract Global Wallet",
      "website": "https://portal.abs.xyz/",
      "category": "Wallet",
      "chains": [
        "abstract"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=abs.xyz&sz=128",
      "description": "A cross-application smart contract wallet powering the Abstract ecosystem, utilizing native account abstraction to allow users to sign up via familiar methods like email, social accounts, and passkeys.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-chain crypto wallet for Solana and Ethereum with xNFT support.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "A self-custodial wallet for crypto and NFTs across multiple chains.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A feature-rich Cardano wallet for staking, dApps, and asset management.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-asset desktop and mobile wallet with a built-in exchange.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A Cardano and multi-chain wallet for DeFi and dApp access.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "IOG's light wallet for Cardano with staking and dApp connectivity.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "magicmoney-wallet",
      "name": "MagicMoney Wallet",
      "website": "https://github.com/M2AF/Magic-Money-Wallet",
      "category": "Wallet",
      "chains": [
        "abstract",
        "apechain",
        "arbitrum",
        "avalanche",
        "base",
        "bitcoin",
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
      "featured": true,
      "favicon": "https://raw.githubusercontent.com/M2AF/Magic-Money-Wallet/main/resources/icon.png",
      "description": "A self-custody multi-chain wallet for desktop, Chrome, and Android with dApp connectivity, swaps, and a built-in private browser.",
      "chainCount": 19,
      "coverage": 100
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
      "description": "The widely-used self-custodial wallet for Ethereum and EVM networks.",
      "chainCount": 15,
      "coverage": 79
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
      "description": "A browser-based Cardano wallet for dApps and staking.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A popular multi-chain wallet for Solana, Ethereum, and more.",
      "chainCount": 6,
      "coverage": 32
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
      "description": "A security-focused EVM wallet with clear transaction previews.",
      "chainCount": 12,
      "coverage": 63
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
      "description": "A friendly Ethereum wallet for tokens, NFTs, and DeFi.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A smart-contract multisig wallet for securing digital assets, formerly Gnosis Safe.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A multi-chain mobile wallet for crypto and NFTs.",
      "chainCount": 10,
      "coverage": 53
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
      "description": "A mobile-first Cardano wallet for staking and dApps.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-chain wallet for crypto, NFTs, and cross-chain swaps, formerly XDEFI.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A light Cardano wallet by Emurgo for staking and transactions.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "begin-wallet",
      "name": "Begin Wallet",
      "website": "https://begin.is",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=begin.is&sz=64",
      "description": "A next-generation Cardano wallet designed to bring users into the new era of finance with a clean, modern interface and full DeFi integration.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "daedalus-wallet",
      "name": "Daedalus Wallet",
      "website": "https://daedaluswallet.io",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=daedaluswallet.io&sz=64",
      "description": "The official open-source full-node desktop wallet for Cardano, built by IOG to grow with the Cardano blockchain.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "gamechanger-wallet",
      "name": "GameChanger Wallet",
      "website": "https://gamechanger.finance",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gamechanger.finance&sz=64",
      "description": "A web-based Cardano wallet with native NFT and token features, designed for developers and users exploring on-chain scripting and dApp interactions.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nufi-wallet",
      "name": "NuFi",
      "website": "https://nu.fi",
      "category": "Wallet",
      "chains": [
        "cardano",
        "solana",
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nu.fi&sz=64",
      "description": "A non-custodial multi-chain wallet supporting staking on Cardano and other PoS blockchains with hardware wallet integration.",
      "chainCount": 3,
      "coverage": 16
    },
    {
      "id": "typhon-wallet",
      "name": "Typhon Wallet",
      "website": "https://typhonwallet.io",
      "category": "Wallet",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=typhonwallet.io&sz=64",
      "description": "A blazing fast, feature-rich, and secure Cardano web and browser extension wallet with full dApp support and multi-account management.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An NFT launchpad on Abstract for creating and minting NFT collections.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "gamma",
      "name": "Gamma",
      "website": "https://gamma.io/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gamma.io&sz=64",
      "description": "A leading Bitcoin NFT marketplace featuring a trustless Ordinals marketplace built on Bitcoin Layer-1, including a no-code launchpad and API infrastructure.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "okx-nft",
      "name": "OKX NFT Marketplace",
      "website": "https://www.okx.com/web3/marketplace/nft",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=okx.com&sz=64",
      "description": "An aggregator marketplace supporting Bitcoin Ordinals with bulk buying features, zero listing fees, and rigorous creator verification.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "unisat",
      "name": "Unisat",
      "website": "https://unisat.io/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=unisat.io&sz=64",
      "description": "A decentralized application for creating, trading, and managing Bitcoin Ordinals, with support for over 1,500 collections.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ordzaar",
      "name": "Ordzaar",
      "website": "https://ordzaar.com/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ordzaar.com&sz=64",
      "description": "A creator-friendly, fully on-chain Bitcoin Ordinals launchpad and marketplace that does not charge platform fees.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ordinals-market",
      "name": "Ordinals Market",
      "website": "https://ordinals.market/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ordinals.market&sz=64",
      "description": "A user-friendly marketplace for browsing, buying, and selling digital artifacts, featuring bulk buying and verified listings.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ordinals-wallet",
      "name": "Ordinals Wallet",
      "website": "https://ordinalswallet.com/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ordinalswallet.com&sz=64",
      "description": "A community-funded marketplace dedicated to buying and selling Bitcoin Ordinals.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "description": "A pro-focused NFT marketplace and aggregator for active traders.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A Web3 marketplace for buying and owning ebooks and audiobooks as NFTs.",
      "chainCount": 4,
      "coverage": 21
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
      "description": "A collectible-commerce marketplace on Abstract for digital collectibles redeemable for physical goods.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A multi-chain NFT marketplace and aggregator.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A Solana marketplace for fine and generative digital art.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A curated marketplace for digital art and NFTs.",
      "chainCount": 2,
      "coverage": 11
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
      "description": "A Solana NFT marketplace and aggregator.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "The leading Cardano NFT marketplace.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A community-first NFT marketplace that rewards traders.",
      "chainCount": 2,
      "coverage": 11
    },
    {
      "id": "magic-eden",
      "name": "Magic Eden",
      "website": "https://magiceden.io",
      "category": "NFT Marketplace",
      "chains": [
        "solana",
        "ethereum",
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=magiceden.io&sz=64",
      "description": "A leading multi-chain NFT marketplace spanning Solana, Ethereum, and Bitcoin.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A multichain NFT trading terminal and analytics platform for professional traders.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano NFT minting platform and infrastructure provider.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "The largest general NFT marketplace across many blockchains.",
      "chainCount": 10,
      "coverage": 53
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
      "description": "A multi-chain NFT marketplace and creator platform.",
      "chainCount": 4,
      "coverage": 21
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
      "description": "An artist-first NFT launchpad and marketplace where creators self-deploy collections.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "VanEck's NFT platform with a 'Lock & Key' shared-custody vault model.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "satflow",
      "name": "Sat Flow",
      "website": "https://www.satflow.com/",
      "category": "NFT Marketplace",
      "chains": [
        "bitcoin"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=satflow.com&sz=64",
      "description": "A specialized marketplace for Bitcoin Ordinals, enabling the discovery, buying, and selling of digital artifacts inscribed directly on the Bitcoin blockchain.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana NFT marketplace.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A curated marketplace for single-edition digital artworks.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Solana NFT marketplace and aggregator built for pro traders.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized Ethereum NFT marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "crashr",
      "name": "Crashr",
      "website": "https://crashr.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=crashr.io&sz=64",
      "description": "A Cardano marketplace platform that empowers users and communities through NFT trading, raffles, and community voting mechanics.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "dropspot",
      "name": "Dropspot",
      "website": "https://dropspot.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dropspot.io&sz=64",
      "description": "A launchpad for creators and a marketplace for collectors on Cardano, welcoming artists globally to mint, list, and trade NFTs.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "jamonbread",
      "name": "JamOnBread",
      "website": "https://jamonbread.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=jamonbread.io&sz=64",
      "description": "A user-friendly, fast, and decentralized Cardano NFT marketplace offering a revolutionary smart contract solution for digital collectibles.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A platform for creating and managing on-chain DAOs.",
      "chainCount": 3,
      "coverage": 16
    },
    {
      "id": "bendingai",
      "name": "BendingAI",
      "website": "https://bending.ai/market",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bending.ai&sz=64",
      "description": "A data-driven platform on Cardano providing advanced market analytics and portfolio tracking tools to monitor ecosystem trends.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A portfolio tracker for crypto and DeFi across wallets and exchanges.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A directory and analytics platform for dApps across blockchains.",
      "chainCount": 12,
      "coverage": 63
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
      "description": "A DeFi portfolio tracker and Web3 dashboard for EVM chains.",
      "chainCount": 11,
      "coverage": 58
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
      "description": "The leading open analytics dashboard for DeFi TVL and metrics.",
      "chainCount": 18,
      "coverage": 95
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
      "description": "A soulbound vault yield protocol on Abstract with capped emissions and token burns.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A real-time charting and analytics tool for on-chain token trading.",
      "chainCount": 14,
      "coverage": 74
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
      "description": "A messaging and notifications protocol for Solana wallets and apps.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A platform for querying and visualizing on-chain blockchain data.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "The primary block explorer and analytics platform for Ethereum.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 11
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
      "description": "A decentralized social network protocol.",
      "chainCount": 3,
      "coverage": 16
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
      "description": "A real-time DEX and token analytics platform by CoinGecko.",
      "chainCount": 13,
      "coverage": 68
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
      "description": "A platform for funding open-source and public-goods projects via grants.",
      "chainCount": 3,
      "coverage": 16
    },
    {
      "id": "konnektr",
      "name": "Konnektr",
      "website": "https://konnektr.net/",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=konnektr.net&sz=64",
      "description": "An open-source developer toolset and SDK for PostgreSQL/Apache AGE, providing graph database capabilities and integration libraries for C# and .NET environments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "mizutools",
      "name": "MizuTools",
      "website": "https://mizutools.xyz/",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=mizutools.xyz&sz=64",
      "description": "A comprehensive analytics and portfolio tracking platform designed to provide insights into the Cardano ecosystem and asset performance.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A decentralized social graph for building Web3 social apps.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A non-custodial Solana trading terminal and wallet with momentum scans and social trading.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "An on-chain analytics platform with wallet labels and smart-money insights.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A multi-chain portfolio tracker and management dashboard.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "An oracle network delivering real-time market price data on-chain.",
      "chainCount": 8,
      "coverage": 42
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
      "description": "A DAO governance platform for creating and managing organizations on Solana.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A gasless off-chain voting platform for DAO governance.",
      "chainCount": 5,
      "coverage": 26
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
      "description": "A Solana multisig and smart-account platform for teams and treasuries.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A Cardano market-data and portfolio analytics platform.",
      "chainCount": 1,
      "coverage": 5
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
      "description": "A platform for fundamental financial metrics on crypto protocols.",
      "chainCount": 7,
      "coverage": 37
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
      "description": "A DeFi portfolio dashboard for tracking and managing positions across chains.",
      "chainCount": 9,
      "coverage": 47
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
      "description": "A Web3 wallet and portfolio manager for DeFi and NFTs.",
      "chainCount": 7,
      "coverage": 37
    },
    {
      "id": "cardanoscan",
      "name": "CardanoScan",
      "website": "https://cardanoscan.io",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardanoscan.io&sz=64",
      "description": "A feature-rich blockchain explorer and analytics platform for Cardano, providing transaction tracking, stake pool data, and on-chain analytics.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cexplorer",
      "name": "cexplorer.io",
      "website": "https://cexplorer.io",
      "category": "Portfolio & Analytics",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cexplorer.io&sz=64",
      "description": "A comprehensive Cardano blockchain explorer offering rich data on transactions, blocks, stake pools, and native assets.",
      "chainCount": 1,
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 21
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
      "coverage": 16
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
      "coverage": 5
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
      "coverage": 5
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
      "coverage": 5
    },
    {
      "id": "perpl",
      "name": "Perpl",
      "website": "https://app.perpl.xyz",
      "category": "Perps & Prediction Markets",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=perpl.xyz&sz=64",
      "description": "A decentralized perpetual exchange built on Monad, focusing on high-speed trading and efficient capital utilization for various market pairs.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "bodega-market",
      "name": "Bodega Market",
      "website": "https://www.bodegacardano.org",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bodegacardano.org&sz=64",
      "description": "An open-source prediction market platform on Cardano enabling users to trade on the outcomes of real-world events.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "phoenix",
      "name": "Phoenix",
      "website": "https://phoenix.trade",
      "category": "Perps & Prediction Markets",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=phoenix.trade&sz=128",
      "description": "A Solana on-chain limit order book decentralized exchange.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "foreon-network",
      "name": "Foreon Network",
      "website": "https://foreon.network",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=foreon.network&sz=64",
      "description": "A decentralized prediction protocol on Cardano allowing users to create and participate in binary outcome markets.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "astarter",
      "name": "Astarter",
      "website": "https://astarter.io",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=astarter.io&sz=64",
      "description": "Decentralized AI compute node network.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "bitte",
      "name": "Bitte",
      "website": "https://www.bitte.ai/",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bitte.ai&sz=64",
      "description": "No-code AI agent builder.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "chakra-agents",
      "name": "Chakra Agents",
      "website": "https://chakra-ai.io",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=chakra-ai.io&sz=64",
      "description": "Launchpad for autonomous AI agents.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "farmroll",
      "name": "Farmroll",
      "website": "https://farmroll.io/",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=farmroll.io&sz=64",
      "description": "Quest rewards platform with AI agents.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nucast-ai",
      "name": "Nucast AI",
      "website": "https://ai.nucast.io",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ai.nucast.io&sz=64",
      "description": "Wallet-aware AI chat layer.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "quorina",
      "name": "Quorina",
      "website": "https://quorina.com",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=quorina.com&sz=64",
      "description": "Wallet-gated generative AI tools.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "sokosumi",
      "name": "Sokosumi",
      "website": "https://sokosumi.com/",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sokosumi.com&sz=64",
      "description": "Professional AI marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "spidex-ai",
      "name": "Spidex AI",
      "website": "https://app.spidex.ag",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=app.spidex.ag&sz=64",
      "description": "Chat-based crypto trading assistant.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "artificial-superintelligence-alliance",
      "name": "Superintelligence Alliance",
      "website": "https://superintelligence.io/",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=superintelligence.io&sz=64",
      "description": "AI alliance under one token.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "sync-ai",
      "name": "Sync AI",
      "website": "https://www.syncai.network/",
      "category": "AI",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=syncai.network&sz=64",
      "description": "Chat-based on-chain control panel.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "djed",
      "name": "Djed",
      "website": "https://djed.xyz/",
      "category": "Stablecoins",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=djed.xyz&sz=64",
      "description": "Overcollateralized stablecoin pegged to dollars.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "usda",
      "name": "USDA",
      "website": "https://www.anzens.com",
      "category": "Stablecoins",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=anzens.com&sz=64",
      "description": "Fully reserved fiat-backed stablecoin.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "usdc",
      "name": "USDC",
      "website": "https://www.circle.com/xreserve",
      "category": "Stablecoins",
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
      "favicon": "https://www.google.com/s2/favicons?domain=circle.com&sz=64",
      "description": "Interoperable dollar-backed stablecoin.",
      "chainCount": 18,
      "coverage": 95
    },
    {
      "id": "usdm",
      "name": "USDM",
      "website": "https://moneta.global/",
      "category": "Stablecoins",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=moneta.global&sz=64",
      "description": "Regulated fiat-backed stablecoin.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ens",
      "name": "ENS",
      "website": "https://ens.domains",
      "category": "Identity",
      "chains": [
        "ethereum"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ens.domains&sz=128",
      "description": "The Ethereum Name Service for human-readable .eth wallet and website names.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "sns",
      "name": "Solana Name Service",
      "website": "https://www.sns.id/",
      "category": "Identity",
      "chains": [
        "solana"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sns.id&sz=64",
      "description": "Solana's domain name service for human-readable .sol wallet addresses.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "unstoppable-domains",
      "name": "Unstoppable Domains",
      "website": "https://unstoppabledomains.com",
      "category": "Identity",
      "chains": [
        "ethereum",
        "polygon"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=unstoppabledomains.com&sz=64",
      "description": "NFT-based Web3 domains for crypto payments and decentralized login, like .crypto and .nft.",
      "chainCount": 2,
      "coverage": 11
    },
    {
      "id": "adahandle",
      "name": "ADA Handle",
      "website": "https://handle.me/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=handle.me&sz=64",
      "description": "NFT-backed human-readable wallet handles.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "bikeid",
      "name": "BikeID",
      "website": "https://bikeid.org/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=bikeid.org&sz=64",
      "description": "Digital identity tags for bicycles.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "blocktrust",
      "name": "Blocktrust",
      "website": "https://www.blocktrust.dev",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=blocktrust.dev&sz=64",
      "description": "Decentralized identity solutions.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "commitproof",
      "name": "CommitProof",
      "website": "https://commitproof.com",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=commitproof.com&sz=64",
      "description": "Timestamp text or files on-chain.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "commonlands",
      "name": "Commonlands",
      "website": "https://www.commonlands.org/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=commonlands.org&sz=64",
      "description": "Land titling and credit for the unbanked.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "echocert",
      "name": "EchoCert",
      "website": "https://echocert.echoforgellc.tech",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=echocert.echoforgellc.tech&sz=64",
      "description": "Issue verifiable digital certificates.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "echodash",
      "name": "EchoDash",
      "website": "https://echodash.echoforgellc.tech",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=echodash.echoforgellc.tech&sz=64",
      "description": "Wallet-connected ecosystem profile dashboard.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "echouploader",
      "name": "EchoUploader",
      "website": "https://uploader.echoforgellc.tech/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=uploader.echoforgellc.tech&sz=64",
      "description": "On-chain proof of file authorship.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "encoins",
      "name": "Encoins",
      "website": "https://www.encoins.io/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=encoins.io&sz=64",
      "description": "Private value transfer tokens.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "entry",
      "name": "ENTRY",
      "website": "https://www.entry.network/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=entry.network&sz=64",
      "description": "Compliance-native blockchain layer.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "hyperledger-identus",
      "name": "Hyperledger Identus",
      "website": "https://hyperledger-identus.github.io/docs",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hyperledger-identus.github.io&sz=64",
      "description": "Self-sovereign identity platform with credentials.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nabu-vpn",
      "name": "NABU VPN",
      "website": "https://nabuvpn.com",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nabuvpn.com&sz=64",
      "description": "Wallet-based VPN with no signup.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nmkr-identity",
      "name": "NMKR Identity",
      "website": "https://identity.nmkr.io/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=identity.nmkr.io&sz=64",
      "description": "Verifiable project identity for tokens.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nuauth",
      "name": "NuAuth",
      "website": "https://nuauth.nucast.io/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nuauth.nucast.io&sz=64",
      "description": "Content authentication protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "proofspace-no-code-ssi-platform",
      "name": "ProofSpace",
      "website": "https://www.proofspace.id/",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=proofspace.id&sz=64",
      "description": "No-code verifiable credentials platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "shinid-no-code-identity-verification",
      "name": "Shin ID",
      "website": "https://shinid.com",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=shinid.com&sz=64",
      "description": "No-code verifiable credential builder.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "uverify",
      "name": "UVerify",
      "website": "https://uverify.io",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=uverify.io&sz=64",
      "description": "Blockchain document verification platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vault3",
      "name": "VAULT3",
      "website": "https://vault3.io",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vault3.io&sz=64",
      "description": "Token-gated file sharing platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "veridian-identity",
      "name": "Veridian Identity",
      "website": "https://www.veridian.id",
      "category": "Identity",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=veridian.id&sz=64",
      "description": "KERI-based self-sovereign identity wallet.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "anvil-minting",
      "name": "Anvil Minting",
      "website": "https://ada-anvil.io/",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ada-anvil.io&sz=64",
      "description": "Hosted minting platform for brands.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardahub-minting",
      "name": "Cardahub Minting",
      "website": "https://cardahub.io/minting",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardahub.io&sz=64",
      "description": "In-browser NFT minting tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-studio-app",
      "name": "Cardano Studio",
      "website": "https://www.cardano-studio.app/",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardano-studio.app&sz=64",
      "description": "Self-custody NFT minting in browser.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-tools-io-mint",
      "name": "Cardano-Tools.io",
      "website": "https://cardano-tools.io",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardano-tools.io&sz=64",
      "description": "Free open-source NFT minting tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cnftlab-party",
      "name": "CNFTlab Party",
      "website": "https://www.cnftlab.party/",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cnftlab.party&sz=64",
      "description": "Anonymous NFT minting DApp.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nft-forge",
      "name": "NFT Forge",
      "website": "https://nft-forge.wingriders.com/",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nft-forge.wingriders.com&sz=64",
      "description": "Free bulk NFT minting tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "rewrx",
      "name": "rewrx",
      "website": "https://rewrx.org/",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rewrx.org&sz=64",
      "description": "No-code token and NFT minting suite.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "wild-tangz",
      "name": "Wild Tangz",
      "website": "https://www.wildtangz.com",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wildtangz.com&sz=64",
      "description": "Open-source NFT minting toolkit.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "xforge",
      "name": "XFORGE",
      "website": "https://www.xforge.studio",
      "category": "Minting Services",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=xforge.studio&sz=64",
      "description": "No-code NFT minting platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "adalink",
      "name": "AdaLink",
      "website": "https://www.adalink.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=adalink.io&sz=64",
      "description": "Affiliate marketing platform paying creators.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "andamio",
      "name": "Andamio",
      "website": "https://www.andamio.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=andamio.io&sz=64",
      "description": "Education and collaboration DApp.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "arp-radio",
      "name": "Arp Radio",
      "website": "https://arpradio.media/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=arpradio.media&sz=64",
      "description": "Music token player and minter.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "atrium",
      "name": "Atrium",
      "website": "https://atrium.io/education",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=atrium.io&sz=64",
      "description": "Beginner crypto and staking lessons.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "booksocial",
      "name": "BookSocial",
      "website": "https://www.booksocialapp.com/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=booksocialapp.com&sz=64",
      "description": "AI book podcast generator.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-xp",
      "name": "Cardano XP",
      "website": "https://www.cardano-xp.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardano-xp.io&sz=64",
      "description": "On-chain contribution reputation.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cryptonaut-id",
      "name": "Cryptonaut",
      "website": "https://cryptonaut.id",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cryptonaut.id&sz=64",
      "description": "Cryptocurrency community social platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "doba-protocol",
      "name": "Doba Protocol",
      "website": "https://www.doba.world/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=doba.world&sz=64",
      "description": "Music NFT royalty protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "dred",
      "name": "DRED",
      "website": "https://cardano-after-dark.github.io/dred/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardano-after-dark.github.io&sz=64",
      "description": "Real-time messaging network for DApps.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "finbyte-network",
      "name": "Finbyte Network",
      "website": "https://www.finbyte.network",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=finbyte.network&sz=64",
      "description": "Cardano-native social forum.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "joiz",
      "name": "JOIZ",
      "website": "https://joiz.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=joiz.io&sz=64",
      "description": "Private messenger, no phone needed.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "matotam",
      "name": "Matotam",
      "website": "https://www.matotam.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=matotam.io&sz=64",
      "description": "On-chain NFT messaging app.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "mindplex",
      "name": "Mindplex",
      "website": "https://mindplex.ai",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=mindplex.ai&sz=64",
      "description": "Member-driven futurist media platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nucast",
      "name": "Nucast",
      "website": "https://www.nucast.io/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nucast.io&sz=64",
      "description": "NFT-based video streaming service.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "olympus-insights",
      "name": "Olympus Insights",
      "website": "https://oli4education.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=oli4education.io&sz=64",
      "description": "AI-driven blockchain academy.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "psyence-lab",
      "name": "Psyence Lab",
      "website": "https://www.psyencelab.media/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=psyencelab.media&sz=64",
      "description": "Record, master, and tokenize music.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "raiders-guild",
      "name": "Raiders Guild",
      "website": "https://app.raidersguild.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=app.raidersguild.io&sz=64",
      "description": "Reward-based social engagement platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "reach-your-people",
      "name": "Reach your People",
      "website": "https://www.ryp.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ryp.io&sz=64",
      "description": "Project updates routed to your inbox.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "sick-city",
      "name": "Sick City",
      "website": "https://sickcityxyz.wordpress.com/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sickcityxyz.wordpress.com&sz=64",
      "description": "Music NFT minting for independent artists.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "smartplaces",
      "name": "SmartPlaces",
      "website": "https://www.smart-places.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=smart-places.io&sz=64",
      "description": "Geolocation social rewards.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "songmarketcap",
      "name": "Song Market Cap",
      "website": "https://www.songmarketcap.com/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=songmarketcap.com&sz=64",
      "description": "Creates limited edition NFT songs.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "stuff-io",
      "name": "Stuff.io",
      "website": "https://stuff.io/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=stuff.io&sz=64",
      "description": "Buy and own digital media.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "sync-land",
      "name": "Sync Land",
      "website": "https://www.sync.land/",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=sync.land&sz=64",
      "description": "P2P music licensing.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vyra-io",
      "name": "VYRA",
      "website": "https://vyra.io",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vyra.io&sz=64",
      "description": "Privacy-focused social network.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "wisdom-courses",
      "name": "Wisdom Courses",
      "website": "https://wisdom.courses",
      "category": "Social",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=wisdom.courses&sz=64",
      "description": "Learn-to-earn educational portal.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "adadrops-tool",
      "name": "Adadrop",
      "website": "https://adadrop.app",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=adadrop.app&sz=64",
      "description": "Open-source airdrop tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "adamatic",
      "name": "AdaMatic",
      "website": "https://adamatic.xyz",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=adamatic.xyz&sz=64",
      "description": "Automated recurring on-chain payments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "adaseal-vending-machine",
      "name": "AdaSeal Vending Machine",
      "website": "https://vm.adaseal.eu",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vm.adaseal.eu&sz=64",
      "description": "Cardano token vending machine.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "aquarium",
      "name": "Aquarium",
      "website": "https://aquarium.fluidtokens.com",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aquarium.fluidtokens.com&sz=64",
      "description": "Pay network fees with any token.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-card",
      "name": "Cardano Card",
      "website": "https://cardanocard.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardanocard.io&sz=64",
      "description": "Crypto debit card for everyday spending.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-foundation-reeve",
      "name": "Cardano Foundation Reeve",
      "website": "https://cardanofoundation.org/reeve",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardanofoundation.org&sz=64",
      "description": "Verifiable accounting for organizations.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano402",
      "name": "cardano402",
      "website": "https://cardano402.com/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardano402.com&sz=64",
      "description": "Pay-per-request payment gateway.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "claimpaign",
      "name": "Claimpaign",
      "website": "https://claimpaign.com",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=claimpaign.com&sz=64",
      "description": "Event QR claim tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "clanity-rewards",
      "name": "Clanity Rewards",
      "website": "https://clanity.com",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=clanity.com&sz=64",
      "description": "Shared rewards token for local shops.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "dotare",
      "name": "Dotare",
      "website": "https://www.dotare.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dotare.io&sz=64",
      "description": "Endowment-funded basic income.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "dripdropz",
      "name": "DripDropz",
      "website": "https://dripdropz.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dripdropz.io&sz=64",
      "description": "Per-epoch token claims for delegators.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ekival",
      "name": "Ekival",
      "website": "https://ekival.com/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ekival.com&sz=64",
      "description": "Beta peer-to-peer crypto-cash transfers.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "feesaswap",
      "name": "FeesaSwap",
      "website": "https://www.feesaswap.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=feesaswap.io&sz=64",
      "description": "Pay network fees with any token.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "gero-card",
      "name": "Gero Card",
      "website": "https://gerowallet.io/gero-card/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gerowallet.io&sz=64",
      "description": "Spend ADA in euros anywhere.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "iagon-ledgerflow",
      "name": "Iagon LedgerFlow",
      "website": "https://docs.iagon.com/products/ledgerflow",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=docs.iagon.com&sz=64",
      "description": "Group approvals for crypto payments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "linkberry",
      "name": "Linkberry",
      "website": "https://linkberry.info/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=linkberry.info&sz=64",
      "description": "Token rewards for ADA stakers.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nmkr-pay",
      "name": "NMKR Pay",
      "website": "https://docs.nmkr.io/nmkr-studio/set-up-sales/nmkr-pay",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=docs.nmkr.io&sz=64",
      "description": "Checkout for token sales.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nucast-subscriptions",
      "name": "Nucast Subscriptions",
      "website": "https://subscription.nucast.io/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=subscription.nucast.io&sz=64",
      "description": "Recurring crypto subscriptions for creators.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nula",
      "name": "Nula",
      "website": "https://nula.stream",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nula.stream&sz=64",
      "description": "In-development token streaming protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "onboard-ninja",
      "name": "Onboard Ninja",
      "website": "https://www.onboard.ninja",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=onboard.ninja&sz=64",
      "description": "Event airdrop platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "payada",
      "name": "PayADA",
      "website": "https://payada.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=payada.io&sz=64",
      "description": "Checkout links for accepting crypto payments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "poolperks",
      "name": "PoolPerks",
      "website": "https://poolperks.io",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=poolperks.io&sz=64",
      "description": "Staking NFT rewards.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "revuto",
      "name": "Revuto",
      "website": "https://revuto.com/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=revuto.com&sz=64",
      "description": "Control subscriptions, earn cashback.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "stablepay",
      "name": "StablePay",
      "website": "https://stablepay.stability.nexus/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=stablepay.stability.nexus&sz=64",
      "description": "Open-source crypto payment widget.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "tosidrop",
      "name": "TosiDrop",
      "website": "https://tosidrop.me",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=tosidrop.me&sz=64",
      "description": "Comprehensive token distribution platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vendano",
      "name": "Vendano",
      "website": "https://vendano.net",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vendano.net&sz=64",
      "description": "Send ADA by phone or email.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "veralidity",
      "name": "Veralidity",
      "website": "https://veralidity.com/",
      "category": "Payments",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=veralidity.com&sz=64",
      "description": "Crypto checkout for Magento stores.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "5am-earth",
      "name": "5am.earth",
      "website": "https://5am.earth",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=5am.earth&sz=64",
      "description": "Farmer-owned agricultural data infrastructure.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ango-real-estate-nft",
      "name": "ANGO Real Estate NFT",
      "website": "https://ango.jp",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=ango.jp&sz=64",
      "description": "Membership NFTs for Japanese stays.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "archax",
      "name": "Archax",
      "website": "https://archax.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=archax.com&sz=64",
      "description": "Regulated real-world asset platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "asset-dao",
      "name": "Asset DAO",
      "website": "https://re-assetdao.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=re-assetdao.com&sz=64",
      "description": "Japanese property tokenization DAO.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "atomico3",
      "name": "Atomico3",
      "website": "https://www.atomico3.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=atomico3.io&sz=64",
      "description": "Tokenized lithium reserves.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "crop-connect",
      "name": "CropConnect",
      "website": "https://www.cropconnect.xyz",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cropconnect.xyz&sz=64",
      "description": "Agricultural supply tracking.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cswap-nft-marketplace",
      "name": "CSwap NFT Marketplace",
      "website": "https://app.cswap.fi",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=app.cswap.fi&sz=64",
      "description": "RWA marketplace with liquidity pools.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "digift-platform",
      "name": "DigiFT Platform",
      "website": "https://digift.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=digift.io&sz=64",
      "description": "MAS-licensed RWA exchange.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "empowa",
      "name": "Empowa",
      "website": "https://empowa.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=empowa.io&sz=64",
      "description": "Cardano housing development marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "filecoin",
      "name": "Filecoin",
      "website": "https://filecoin.io",
      "category": "Real World Assets",
      "chains": [
        "cardano",
        "ethereum",
        "polygon",
        "avalanche"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=filecoin.io&sz=64",
      "description": "Verifiable data storage.",
      "chainCount": 4,
      "coverage": 21
    },
    {
      "id": "finest-investments",
      "name": "Finest Investments",
      "website": "https://www.finest.investments",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=finest.investments&sz=64",
      "description": "BaFin-compliant real-world asset platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "haus-protocol",
      "name": "Haus",
      "website": "https://www.haus.com/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=haus.com&sz=64",
      "description": "Real-world asset management protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "iagon",
      "name": "Iagon",
      "website": "https://iagon.com/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=iagon.com&sz=64",
      "description": "Decentralized storage and computing.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "kinka-gold",
      "name": "Kinka Gold",
      "website": "https://kinka-gold.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=kinka-gold.com&sz=64",
      "description": "Physical gold backed digital tokens.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "l4va",
      "name": "L4VA",
      "website": "https://www.l4va.com/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=l4va.com&sz=64",
      "description": "Asset fractionalization vault protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "landano",
      "name": "Landano",
      "website": "https://landano.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=landano.io&sz=64",
      "description": "Blockchain land registry.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "landhive",
      "name": "Landhive",
      "website": "https://landhive.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=landhive.io&sz=64",
      "description": "Fractional real estate investing.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "libertum",
      "name": "Libertum",
      "website": "https://www.libertum.io/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=libertum.io&sz=64",
      "description": "Tokenization platform for real-world assets.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "lw3",
      "name": "LW3",
      "website": "https://lw3.world",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=lw3.world&sz=64",
      "description": "Enterprise blockchain traceability.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nunet",
      "name": "NuNet",
      "website": "https://www.nunet.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nunet.io&sz=64",
      "description": "Rent or share spare computing power.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "open-food-chain",
      "name": "Open Food Chain",
      "website": "https://www.openfoodchain.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=openfoodchain.com&sz=64",
      "description": "Food supply traceability.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "open-litter-map",
      "name": "Open Litter Map",
      "website": "https://openlittermap.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=openlittermap.com&sz=64",
      "description": "Crowdsourced map of global litter pollution.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "originate-supply-chain-platform",
      "name": "OriginateNavio",
      "website": "https://github.com/cardano-foundation/originatenavio",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=github.com&sz=64",
      "description": "Open-source supply chain solution.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "palmyra",
      "name": "Palmyra",
      "website": "https://palmyra.app",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=palmyra.app&sz=64",
      "description": "Supply chain transparency.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "pbg",
      "name": "PBG",
      "website": "https://www.pbg.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pbg.io&sz=64",
      "description": "Tokenized fund management.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "plastiks",
      "name": "Plastiks",
      "website": "https://www.plastiks.io",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=plastiks.io&sz=64",
      "description": "Verified plastic traceability.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "re-twin",
      "name": "Re Twin",
      "website": "https://re-twin.com/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=re-twin.com&sz=64",
      "description": "Real estate documentation NFTs.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "realtoro",
      "name": "RealToro",
      "website": "https://realtoro.org",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=realtoro.org&sz=64",
      "description": "Blockchain property registry.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "reit-circles",
      "name": "Reit Circles",
      "website": "https://reitcircles.com",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=reitcircles.com&sz=64",
      "description": "Property tokenization platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "rejuve",
      "name": "Rejuve",
      "website": "https://www.rejuve.ai/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=rejuve.ai&sz=64",
      "description": "Earn tokens for sharing health data.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "stablemans",
      "name": "Stablemans",
      "website": "https://www.stablemans.com/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=stablemans.com&sz=64",
      "description": "Fractional racehorse ownership platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "terralima",
      "name": "TerraLima",
      "website": "https://terralima.co",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=terralima.co&sz=64",
      "description": "Agricultural supply platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "toto-finance",
      "name": "Toto Finance",
      "website": "https://totofinance.co/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=totofinance.co&sz=64",
      "description": "Tokenized commodity marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vola-network",
      "name": "Vola Network",
      "website": "https://vola.network/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vola.network&sz=64",
      "description": "Decentralized cloud storage and computing.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "walkers",
      "name": "Walkers",
      "website": "https://walkerscardano.xyz/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=walkerscardano.xyz&sz=64",
      "description": "Turn steps into cryptocurrency rewards.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "zengate-global",
      "name": "ZenGate Global",
      "website": "https://www.zengate.global/",
      "category": "Real World Assets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=zengate.global&sz=64",
      "description": "Global commodity trading platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "danogo-swap",
      "name": "Danogo Swap",
      "website": "https://dano.finance/swap",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dano.finance&sz=64",
      "description": "Token swaps inside a DeFi app.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "delta-defi",
      "name": "Delta DeFi",
      "website": "https://deltadefi.io",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=deltadefi.io&sz=64",
      "description": "High-frequency DEX platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "fetch-dex",
      "name": "FetchSwap",
      "website": "https://fetchswap.io",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=fetchswap.io&sz=64",
      "description": "Transparent swap price finder.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "muesliswap-aggregator",
      "name": "MuesliSwap Aggregator",
      "website": "https://v2.muesliswap.com",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=v2.muesliswap.com&sz=64",
      "description": "Cardano swap route finder.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "steelswap",
      "name": "Steelswap",
      "website": "https://steelswap.io",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=steelswap.io&sz=64",
      "description": "Multi-DEX swap price finder.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "viper-swap",
      "name": "ViperSwap Aggregator",
      "website": "https://vipercoin.io/swap",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vipercoin.io&sz=64",
      "description": "Best-route swap aggregator.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vyfi",
      "name": "VyFi",
      "website": "https://vyfi.io",
      "category": "DEX",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=vyfi.io&sz=64",
      "description": "DeFi hub with auto-harvesting vaults.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "aegis",
      "name": "Aegis",
      "website": "https://aegis.fluxpointstudios.com",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aegis.fluxpointstudios.com&sz=64",
      "description": "Automatic on-chain insurance payouts.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "akyba",
      "name": "Akyba",
      "website": "https://aikenakyba.web.app",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=aikenakyba.web.app&sz=64",
      "description": "On-chain community savings circles.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "butane",
      "name": "Butane",
      "website": "https://butane.dev/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=butane.dev&sz=64",
      "description": "Multi-collateral synthetic platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-visualisation-insights",
      "name": "Cardano Visualisation Insights",
      "website": "https://insights.cardano-visualisation.com/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=insights.cardano-visualisation.com&sz=64",
      "description": "AI token trade analysis dashboard.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "crci-review",
      "name": "CRCI",
      "website": "https://www.crci.review/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=crci.review&sz=64",
      "description": "DeFi analysis platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "crowscore",
      "name": "CrowScore",
      "website": "https://crowscore.com/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=crowscore.com&sz=64",
      "description": "Composite token scoring tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "dano-finance",
      "name": "Danogo",
      "website": "https://dano.finance",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=dano.finance&sz=64",
      "description": "Lending, borrowing, leverage, bonds.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "fida-finance",
      "name": "Fida Finance",
      "website": "https://fida.finance",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=fida.finance&sz=64",
      "description": "On-chain insurance risk marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "levvy-fi",
      "name": "Levvy Fi",
      "website": "https://levvy.fi/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=levvy.fi&sz=64",
      "description": "Peer-to-peer lending suite.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "mayz-index",
      "name": "MAYZ Protocol",
      "website": "https://mayz.io",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=mayz.io&sz=64",
      "description": "Decentralized index-fund investment platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "metera-index",
      "name": "Metera Index",
      "website": "https://www.meteraprotocol.io/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=meteraprotocol.io&sz=64",
      "description": "Tokenized index funds.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "pondora",
      "name": "Pondora",
      "website": "https://pondora.org/",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=pondora.org&sz=64",
      "description": "Self-custody trading and lending hub.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "realfi",
      "name": "RealFi",
      "website": "https://realfi.co",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=realfi.co&sz=64",
      "description": "Yield-bearing stablecoin backed by real-world assets.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "smart-contract-audit-dao",
      "name": "Smart Contract Audit DAO",
      "website": "https://www.scatdao.com",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=scatdao.com&sz=64",
      "description": "Community-governed audit collective.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "surf-lending",
      "name": "Surf Lending",
      "website": "https://surflending.org",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=surflending.org&sz=64",
      "description": "Pooled lending with one-click leverage.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "xerberus",
      "name": "Xerberus",
      "website": "https://xerberus.io",
      "category": "DeFi",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=xerberus.io&sz=64",
      "description": "DeFi protocol risk assessments.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "arkhouse-gallery",
      "name": "Arkhouse Gallery",
      "website": "https://www.arkhouse.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=arkhouse.io&sz=64",
      "description": "Curated Web3 art gallery.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "atomic-swap",
      "name": "Atomic Swap",
      "website": "https://atomic-swap.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=atomic-swap.io&sz=64",
      "description": "Peer-to-peer asset swap tool.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "flipswap",
      "name": "FlipSwap",
      "website": "https://flipswap.io",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=flipswap.io&sz=64",
      "description": "Non-custodial NFT swap marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "nftio-io",
      "name": "NFT.io",
      "website": "https://nftio.io/",
      "category": "NFT Marketplace",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=nftio.io&sz=64",
      "description": "Peer-to-peer NFT swap marketplace.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "ascend-perpetuals",
      "name": "Ascend Perpetuals",
      "website": "https://testnet.ascend.market/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=testnet.ascend.market&sz=64",
      "description": "Leveraged longs and shorts on outcomes.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cardano-casino",
      "name": "Cardano Casino",
      "website": "https://cardanocasino.com/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=cardanocasino.com&sz=64",
      "description": "NFT-based casino platform for ADA.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "danzo-casino",
      "name": "Danzo Casino",
      "website": "https://www.danzo.gg/#/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=danzo.gg&sz=64",
      "description": "Cardano meme casino.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "gaming-snek-raffle",
      "name": "Gaming-Snek Raffle",
      "website": "https://gaming-snek.com/raffle",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=gaming-snek.com&sz=64",
      "description": "Community raffle platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "hydrodrip",
      "name": "HydroDrip",
      "website": "https://hydrodrip.io/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=hydrodrip.io&sz=64",
      "description": "Token-reward and coin-flip platform.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "leverup",
      "name": "LeverUp",
      "website": "https://app.leverup.xyz/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "monad"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=leverup.xyz&sz=64",
      "description": "A decentralized leverage and prediction market platform on Monad designed for high-performance trading and speculative event outcomes.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "minute-markets",
      "name": "Minute Markets",
      "website": "https://www.minutemarkets.io/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=minutemarkets.io&sz=64",
      "description": "Short-cycle price prediction protocol.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "one-ada-fortune",
      "name": "One ADA Fortune",
      "website": "https://oneadatarot.com/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=oneadatarot.com&sz=64",
      "description": "Pay-per-reading fortune app.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "vyfi-lottery",
      "name": "VyFi Lottery",
      "website": "https://app.vyfi.io/lottery",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=app.vyfi.io&sz=64",
      "description": "Blockchain lottery system.",
      "chainCount": 1,
      "coverage": 5
    },
    {
      "id": "cpoker",
      "name": "ZKPoker",
      "website": "https://zkpoker.io/",
      "category": "Perps & Prediction Markets",
      "chains": [
        "cardano"
      ],
      "featured": false,
      "favicon": "https://www.google.com/s2/favicons?domain=zkpoker.io&sz=64",
      "description": "Real-time decentralized poker gaming platform.",
      "chainCount": 1,
      "coverage": 5
    }
  ]
}

export default APP_HUB
