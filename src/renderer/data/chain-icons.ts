// Chain logomarks shown in the Networks tab (and anywhere else a chain needs a
// glyph). Bundled as 48px WebP so the dashboard renders them offline and no
// third party sees which chains a user holds.
//
// Regenerate with: node scripts/fetch-chain-icons.mjs
//
// Chains missing from this map (midnight, user-added custom networks) fall back
// to the glowing colour dot in ChainCard.
import abstract from '../assets/chains/abstract.webp'
import apechain from '../assets/chains/apechain.webp'
import arbitrum from '../assets/chains/arbitrum.webp'
import avalanche from '../assets/chains/avalanche.webp'
import base from '../assets/chains/base.webp'
import bitcoin from '../assets/chains/bitcoin.webp'
import blast from '../assets/chains/blast.webp'
import cardano from '../assets/chains/cardano.webp'
import dogecoin from '../assets/chains/dogecoin.webp'
import ethereum from '../assets/chains/ethereum.webp'
import gnosis from '../assets/chains/gnosis.webp'
import hyperevm from '../assets/chains/hyperevm.webp'
import monad from '../assets/chains/monad.webp'
import monero from '../assets/chains/monero.webp'
import optimism from '../assets/chains/optimism.webp'
import polkadot from '../assets/chains/polkadot.webp'
import polygon from '../assets/chains/polygon.webp'
import robinhood from '../assets/chains/robinhood.webp'
import ronin from '../assets/chains/ronin.webp'
import solana from '../assets/chains/solana.webp'
import soneium from '../assets/chains/soneium.webp'
import tron from '../assets/chains/tron.webp'
import worldchain from '../assets/chains/worldchain.webp'
import zcash from '../assets/chains/zcash.webp'
import zora from '../assets/chains/zora.webp'

export const CHAIN_ICONS: Record<string, string> = {
  abstract, apechain, arbitrum, avalanche, base, bitcoin, blast, cardano,
  dogecoin, ethereum, gnosis, hyperevm, monad, monero, optimism, polkadot,
  polygon, robinhood, ronin, solana, soneium, tron, worldchain, zcash, zora,
  // Testnet Mode's second Bitcoin row shares the mainnet mark.
  'bitcoin-testnet4': bitcoin
}
