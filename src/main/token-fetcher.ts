import type { WalletConfig } from './secure-store'
import { deriveAgwAddress } from './agw'

export interface WalletToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  balance: string
  usdValue: string | null
  nativeEquivalent: string | null
  nativeSymbol: string
  logoUri: string | null
  chain: string
  chainLabel: string
  chainColor: string
  source?: 'agw'   // present when the asset lives in the Abstract Global Wallet (smart account)
}

export interface TokensResult {
  tokens: WalletToken[]
  fetchedAt: number
  error: string | null
}

export interface NftTrait {
  trait_type: string
  value: string
}

export interface WalletCollectible {
  id: string
  name: string
  description: string | null
  image: string | null
  animationUrl: string | null
  collectionName: string | null
  chain: string
  chainLabel: string
  chainColor: string
  tokenId: string
  contractAddress: string
  contractType: string
  traits: NftTrait[]
  source?: 'agw'   // present when the NFT lives in the Abstract Global Wallet (smart account)
}

export interface CollectiblesResult {
  items: WalletCollectible[]
  fetchedAt: number
  error: string | null
  chainResults: Record<string, { count: number; error: string | null }>
}

// All EVM chains with Alchemy token support
const TOKEN_CHAINS = [
  { id: 'ethereum',   label: 'Ethereum',   network: 'eth-mainnet',       color: '#627EEA' },
  { id: 'arbitrum',   label: 'Arbitrum',   network: 'arb-mainnet',       color: '#28A0F0' },
  { id: 'base',       label: 'Base',       network: 'base-mainnet',      color: '#0052FF' },
  { id: 'polygon',    label: 'Polygon',    network: 'polygon-mainnet',   color: '#8247E5' },
  { id: 'optimism',   label: 'Optimism',   network: 'opt-mainnet',       color: '#FF0420' },
  { id: 'avalanche',  label: 'Avalanche',  network: 'avax-mainnet',      color: '#E84142' },
  { id: 'blast',      label: 'Blast',      network: 'blast-mainnet',     color: '#FCFC03' },
  { id: 'gnosis',     label: 'Gnosis',     network: 'gnosis-mainnet',    color: '#04795B' },
  { id: 'abstract',   label: 'Abstract',   network: 'abstract-mainnet',  color: '#6B7280' },
  { id: 'apechain',   label: 'ApeChain',   network: 'apechain-mainnet',  color: '#0066FF' },
  { id: 'ronin',      label: 'Ronin',      network: 'ronin-mainnet',     color: '#1273EA' },
  { id: 'soneium',    label: 'Soneium',    network: 'soneium-mainnet',   color: '#5B5EA6' },
  { id: 'worldchain', label: 'WorldChain', network: 'worldchain-mainnet',color: '#5A64C8' },
  { id: 'zora',       label: 'Zora',       network: 'zora-mainnet',      color: '#2B5DF0' },
]

// eth, arb, base, polygon, optimism + abstract (Alchemy supports NFTs on abstract-mainnet)
const NFT_CHAINS = [
  ...TOKEN_CHAINS.slice(0, 5),
  TOKEN_CHAINS.find(c => c.id === 'abstract')!,
].filter(Boolean)

// CoinGecko ID for each chain's native token
const NATIVE_CG: Record<string, string> = {
  ethereum: 'ethereum',    arbitrum: 'ethereum',    optimism: 'ethereum',
  base: 'ethereum',        blast: 'ethereum',       abstract: 'ethereum',
  soneium: 'ethereum',     worldchain: 'ethereum',  zora: 'ethereum',
  polygon: 'matic-network', avalanche: 'avalanche-2',
  gnosis: 'xdai',          apechain: 'apecoin',     ronin: 'ronin',
  monad: 'monad',
  solana: 'solana',        cardano: 'cardano',
}

// Native token symbol per chain
const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',  arbitrum: 'ETH',  optimism: 'ETH', base: 'ETH',
  blast: 'ETH',     abstract: 'ETH',  soneium: 'ETH',  worldchain: 'ETH', zora: 'ETH',
  polygon: 'POL',   avalanche: 'AVAX', gnosis: 'xDAI',
  apechain: 'APE',  ronin: 'RON',     monad: 'MON',
  solana: 'SOL',    cardano: 'ADA',
}

// DexScreener chain IDs
const DS_CHAIN: Record<string, string> = {
  ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base',
  polygon: 'polygon',   avalanche: 'avalanche', blast: 'blast',    gnosis: 'gnosis',
  abstract: 'abstract', apechain: 'apechain',   ronin: 'ronin',    soneium: 'soneium',
  worldchain: 'worldchain', zora: 'zora',       monad: 'monad',    solana: 'solana',
}

// DefiLlama Coins API chain slugs — free, no key. Used to backfill prices for
// chains where DexScreener coverage is thin (notably Monad, which is new).
const LLAMA_CHAIN: Record<string, string> = {
  monad: 'monad',
}

const NATIVE_ADDR = '0x0000000000000000000000000000000000000000'

// TrustWallet chain slugs for logo fallback
const TW_CHAIN: Record<string, string> = {
  ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base',
  polygon: 'polygon', avalanche: 'avalanche', gnosis: 'xdai', ronin: 'ronin',
  apechain: 'apechain',
}

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

function rpcUrl(network: string, key: string) {
  return `https://${network}.g.alchemy.com/v2/${key}`
}
function nftUrl(network: string, key: string) {
  return `https://${network}.g.alchemy.com/nft/v3/${key}`
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice(7)}`
  if (url.startsWith('ar://'))   return `https://arweave.net/${url.slice(5)}`
  return url
}

function trustWalletUrl(chain: string, address: string): string | null {
  const tw = TW_CHAIN[chain]
  if (!tw) return null
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/assets/${address}/logo.png`
}

function humanBalance(hexBalance: string, decimals: number): string {
  const raw = BigInt(hexBalance)
  if (raw === 0n) return '0'
  const d = Math.min(decimals, 18)
  const divisor = 10n ** BigInt(d)
  const intPart = raw / divisor
  const fracPart = raw % divisor
  const frac = Number(fracPart) / 10 ** d
  const total = Number(intPart) + frac
  return formatNum(total)
}

function humanBalanceDecimal(raw: number, decimals: number): string {
  return formatNum(raw / 10 ** decimals)
}

function formatNum(total: number): string {
  if (total === 0) return '0'
  if (total >= 1000) return total.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (total >= 1)    return total.toFixed(4).replace(/\.?0+$/, '')
  if (total >= 0.0001) return total.toPrecision(4)
  return total.toExponential(2)
}

function parseBalance(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0
}

// ─── DexScreener price + image fetch ─────────────────────────────────────────

interface DsResult {
  priceUsd: number
  imageUrl: string | null
}

async function fetchDexScreenerChain(
  chainId: string,
  addresses: string[]
): Promise<Map<string, DsResult>> {
  const dsChain = DS_CHAIN[chainId]
  const out = new Map<string, DsResult>()
  if (!dsChain || addresses.length === 0) return out

  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30).join(',')
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`, {
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) continue
      const json = await res.json() as {
        pairs?: Array<{
          chainId: string
          priceUsd?: string
          baseToken: { address: string }
          info?: { imageUrl?: string }
          liquidity?: { usd?: number }
        }>
      }
      for (const pair of json.pairs ?? []) {
        if (pair.chainId !== dsChain) continue
        const addr = pair.baseToken.address.toLowerCase()
        const price = parseFloat(pair.priceUsd ?? '0') || 0
        const liq   = pair.liquidity?.usd ?? 0
        const existing = out.get(addr)
        if (!existing || liq > (existing as DsResult & { liq?: number }).liq!) {
          out.set(addr, { priceUsd: price, imageUrl: normalizeImageUrl(pair.info?.imageUrl ?? null) })
        }
      }
    } catch { /* skip chunk */ }
  }
  return out
}

// ─── DefiLlama price fallback (batched) ──────────────────────────────────────
// Mirrors ChainLens: when DexScreener can't price a token (common on Monad),
// query DefiLlama's free Coins API. One request covers many tokens:
//   https://coins.llama.fi/prices/current/monad:0xabc,monad:0xdef
async function fetchLlamaPrices(chainId: string, addresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const slug = LLAMA_CHAIN[chainId]
  if (!slug || addresses.length === 0) return out

  for (let i = 0; i < addresses.length; i += 50) {
    const ids = addresses.slice(i, i + 50).map(a => `${slug}:${a}`).join(',')
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`, {
        signal: AbortSignal.timeout(8_000)
      })
      if (!res.ok) continue
      const json = await res.json() as { coins?: Record<string, { price?: number }> }
      for (const [k, v] of Object.entries(json.coins ?? {})) {
        const addr = k.split(':')[1]?.toLowerCase()
        if (addr && v?.price) out.set(addr, v.price)
      }
    } catch { /* skip chunk */ }
  }
  return out
}

async function fetchNativePrices(chainIds: string[]): Promise<Record<string, number>> {
  const cgIds = [...new Set(chainIds.map(c => NATIVE_CG[c]).filter(Boolean))]
  if (cgIds.length === 0) return {}
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return {}
    const json = await res.json() as Record<string, { usd: number }>
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.usd ?? 0]))
  } catch { return {} }
}

// ─── EVM token fetch ──────────────────────────────────────────────────────────

async function fetchTokensForChain(
  address: string,
  chain: typeof TOKEN_CHAINS[0],
  key: string
): Promise<WalletToken[]> {
  const url = rpcUrl(chain.network, key)
  try {
    const balRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [address, 'erc20'] }),
      signal: AbortSignal.timeout(12_000)
    })
    if (!balRes.ok) return []

    const balJson = await balRes.json() as {
      result?: { tokenBalances?: Array<{ contractAddress: string; tokenBalance: string }> }
    }
    const nonZero = (balJson.result?.tokenBalances ?? [])
      .filter(t => t.tokenBalance !== ZERO && BigInt(t.tokenBalance) > 0n)
      .slice(0, 100)
    if (nonZero.length === 0) return []

    const metaPayload = nonZero.map((t, i) => ({
      jsonrpc: '2.0', id: i + 1,
      method: 'alchemy_getTokenMetadata',
      params: [t.contractAddress]
    }))
    const metaRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
      signal: AbortSignal.timeout(15_000)
    })
    const metaJson: Array<{ result?: { name: string | null; symbol: string | null; decimals: number | null; logo: string | null } }> =
      metaRes.ok ? await metaRes.json() : []

    return nonZero.map((t, i) => {
      const meta = (Array.isArray(metaJson) ? metaJson[i]?.result : null) ?? {}
      const decimals = meta.decimals ?? 18
      const balance  = humanBalance(t.tokenBalance, decimals)
      const alchemyLogo = normalizeImageUrl((meta as { logo?: string | null }).logo ?? null)
      const twLogo = trustWalletUrl(chain.id, t.contractAddress)
      return {
        contractAddress: t.contractAddress,
        name:     meta.name   ?? 'Unknown Token',
        symbol:   meta.symbol ?? '???',
        decimals,
        balance,
        usdValue: null,
        nativeEquivalent: null,
        nativeSymbol: NATIVE_SYMBOL[chain.id] ?? 'ETH',
        logoUri: alchemyLogo ?? twLogo,
        chain:      chain.id,
        chainLabel: chain.label,
        chainColor: chain.color
      }
    }).filter(t => t.symbol !== '???')
  } catch {
    return []
  }
}

// ─── Solana SPL tokens via Helius DAS API ─────────────────────────────────────

interface HeliusFungibleItem {
  id: string
  interface: string
  content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } }
  token_info?: { balance?: number; decimals?: number; symbol?: string }
}

async function fetchSolanaTokens(address: string, heliusKey: string): Promise<WalletToken[]> {
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'spl-tokens', method: 'getAssetsByOwner',
        params: { ownerAddress: address, page: 1, limit: 200, displayOptions: { showFungible: true, showNativeBalance: false } }
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return []

    const json = await res.json() as { result?: { items?: HeliusFungibleItem[] } }
    return (json.result?.items ?? [])
      .filter(item => (item.interface === 'FungibleToken' || item.interface === 'FungibleAsset') && (item.token_info?.balance ?? 0) > 0)
      .map(item => {
        const decimals = item.token_info?.decimals ?? 0
        const balance  = item.token_info?.balance ?? 0
        const symbol   = item.token_info?.symbol ?? item.content?.metadata?.symbol ?? '???'
        const name     = item.content?.metadata?.name ?? symbol
        return {
          contractAddress: item.id,
          name, symbol, decimals,
          balance: humanBalanceDecimal(balance, decimals),
          usdValue: null,
          nativeEquivalent: null,
          nativeSymbol: 'SOL',
          logoUri: normalizeImageUrl(item.content?.links?.image ?? null),
          chain: 'solana', chainLabel: 'Solana', chainColor: '#9945FF'
        }
      })
      .filter(t => t.symbol !== '???')
  } catch { return [] }
}

// ─── Solana NFTs via Helius DAS API ───────────────────────────────────────────

interface HeliusNftItem {
  id: string
  interface: string
  content?: {
    metadata?: { name?: string; description?: string; attributes?: Array<{ trait_type?: string; value?: unknown }> }
    links?: { image?: string; animation_url?: string }
    files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>
  }
  grouping?: Array<{ group_key: string; group_value: string; collection_metadata?: { name?: string } }>
  compression?: { compressed?: boolean }
}

async function fetchSolanaNFTs(address: string, heliusKey: string): Promise<WalletCollectible[]> {
  if (!address) return []
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'sol-nfts', method: 'getAssetsByOwner',
        params: {
          ownerAddress: address, page: 1, limit: 1000,
          displayOptions: { showFungible: false, showCollectionMetadata: true }
        }
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) {
      console.error(`[NFT] Solana Helius HTTP ${res.status}`)
      return []
    }

    const json = await res.json() as { result?: { items?: HeliusNftItem[] } }
    const items = (json.result?.items ?? [])
      .filter(item => item.interface !== 'FungibleToken' && item.interface !== 'FungibleAsset')

    console.log(`[NFT] Solana: found ${items.length} NFTs via Helius`)

    return items.map(item => {
      const meta = item.content?.metadata ?? {}
      const collection = item.grouping?.find(g => g.group_key === 'collection')
      const imageFile = item.content?.files?.find(f => f.mime?.startsWith('image/'))
      const animFile  = item.content?.files?.find(f => f.mime?.startsWith('video/') || f.mime?.startsWith('model/'))
      const image = normalizeImageUrl(
        item.content?.links?.image ?? imageFile?.cdn_uri ?? imageFile?.uri ?? null
      )
      const animationUrl = normalizeImageUrl(
        item.content?.links?.animation_url ?? animFile?.cdn_uri ?? animFile?.uri ?? null
      )
      return {
        id: `solana:${item.id}`,
        name: meta.name ?? 'Unnamed',
        description: meta.description ?? null,
        image,
        animationUrl,
        collectionName: collection?.collection_metadata?.name ?? null,
        chain: 'solana', chainLabel: 'Solana', chainColor: '#9945FF',
        tokenId: item.id,
        contractAddress: collection?.group_value ?? item.id,
        contractType: item.compression?.compressed ? 'cNFT' : 'NFT',
        traits: (Array.isArray(meta.attributes) ? meta.attributes : [])
          .filter(a => a.trait_type != null && a.value != null)
          .map(a => ({ trait_type: String(a.trait_type), value: String(a.value) }))
      } satisfies WalletCollectible
    })
  } catch (e) {
    console.error('[NFT] Solana Helius fetch failed:', e)
    return []
  }
}

// ─── Cardano native assets via Blockfrost ────────────────────────────────────

async function fetchCardanoTokens(address: string, blockfrostKey: string): Promise<WalletToken[]> {
  if (!address) return []
  try {
    const addrRes = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
      headers: { project_id: blockfrostKey },
      signal: AbortSignal.timeout(12_000)
    })
    if (!addrRes.ok) return []

    const addrJson = await addrRes.json() as { amount?: Array<{ unit: string; quantity: string }> }
    // quantity === 1 means NFT (CIP-25) — exclude from tokens, handled by fetchCardanoNFTs
    const nativeAssets = (addrJson.amount ?? []).filter(a => a.unit !== 'lovelace' && parseInt(a.quantity) !== 1).slice(0, 30)
    if (nativeAssets.length === 0) return []

    const assets = await Promise.all(
      nativeAssets.slice(0, 20).map(async (a): Promise<WalletToken | null> => {
        try {
          const meta = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/assets/${a.unit}`, {
            headers: { project_id: blockfrostKey },
            signal: AbortSignal.timeout(8_000)
          })
          const mj = meta.ok ? await meta.json() as {
            asset_name: string | null
            onchain_metadata?: { name?: string; image?: string } | null
            metadata?: { name?: string; logo?: string } | null
          } : {}

          const rawName = mj.onchain_metadata?.name ?? mj.metadata?.name ?? mj.asset_name ?? null
          const name    = rawName ? decodeAssetName(rawName) : a.unit.slice(0, 8) + '…'
          const logo    = mj.onchain_metadata?.image
            ? normalizeImageUrl(mj.onchain_metadata.image as string)
            : mj.metadata?.logo
              ? `data:image/png;base64,${mj.metadata.logo}`
              : null

          return {
            contractAddress: a.unit,
            name, symbol: name.length <= 10 ? name : name.slice(0, 8) + '…',
            decimals: 0,
            balance: parseInt(a.quantity).toLocaleString('en-US'),
            usdValue: null, nativeEquivalent: null, nativeSymbol: 'ADA',
            logoUri: logo,
            chain: 'cardano', chainLabel: 'Cardano', chainColor: '#2A7DEA'
          }
        } catch { return null }
      })
    )
    return assets.filter((a): a is WalletToken => a !== null)
  } catch { return [] }
}

function decodeAssetName(raw: string): string {
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) {
    try {
      const decoded = Buffer.from(raw, 'hex').toString('utf8')
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded
    } catch { /* fallback */ }
  }
  return raw
}

// ─── Price enrichment ─────────────────────────────────────────────────────────

async function enrichWithPrices(tokens: WalletToken[]): Promise<WalletToken[]> {
  if (tokens.length === 0) return tokens

  const chains = [...new Set(tokens.map(t => t.chain))]

  // CoinGecko native prices (one call)
  const cgIds = [...new Set(chains.map(c => NATIVE_CG[c]).filter(Boolean))]
  let cgPrices: Record<string, number> = {}
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) }
    )
    if (r.ok) {
      const j = await r.json() as Record<string, { usd: number }>
      cgPrices = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.usd ?? 0]))
    }
  } catch { /* use 0 */ }

  const getNativePrice = (chainId: string) => {
    const cgId = NATIVE_CG[chainId]
    return cgId ? (cgPrices[cgId] ?? 0) : 0
  }

  // DexScreener per chain (parallel)
  const dsPrices = new Map<string, DsResult>() // key: `chainId:address`
  await Promise.all(
    chains.map(async chainId => {
      const chainTokens = tokens.filter(t => t.chain === chainId)
      const addrs = chainTokens.map(t => t.contractAddress)
      const results = await fetchDexScreenerChain(chainId, addrs)
      for (const [addr, res] of results) {
        dsPrices.set(`${chainId}:${addr}`, res)
      }
    })
  )

  // DefiLlama backfill for chains with thin DexScreener coverage (Monad).
  // Only query ERC-20s (skip the native placeholder) still missing a price.
  await Promise.all(
    chains.filter(c => LLAMA_CHAIN[c]).map(async chainId => {
      const missing = tokens
        .filter(t => t.chain === chainId
          && t.contractAddress.toLowerCase() !== NATIVE_ADDR
          && !(dsPrices.get(`${chainId}:${t.contractAddress.toLowerCase()}`)?.priceUsd))
        .map(t => t.contractAddress)
      const llama = await fetchLlamaPrices(chainId, missing)
      for (const [addr, price] of llama) {
        const k = `${chainId}:${addr}`
        const existing = dsPrices.get(k)
        dsPrices.set(k, { priceUsd: price, imageUrl: existing?.imageUrl ?? null })
      }
    })
  )

  return tokens.map(t => {
    const key = `${t.chain}:${t.contractAddress.toLowerCase()}`
    const ds = dsPrices.get(key)
    const nativePriceUsd = getNativePrice(t.chain)
    // Native coins (0x0 placeholder) aren't on DexScreener — price them off the
    // chain's native CoinGecko price instead.
    const isNative = t.contractAddress.toLowerCase() === NATIVE_ADDR
    const tokenPriceUsd = isNative ? nativePriceUsd : (ds?.priceUsd ?? 0)

    const balNum  = parseBalance(t.balance)
    const totalUsd  = balNum * tokenPriceUsd
    const nativeEq  = nativePriceUsd > 0 ? totalUsd / nativePriceUsd : 0
    const sym = NATIVE_SYMBOL[t.chain] ?? ''

    return {
      ...t,
      usdValue: `$${totalUsd.toFixed(2)}`,
      nativeEquivalent: `${nativeEq.toFixed(4)} ${sym}`,
      // Prefer existing Alchemy logo, fall back to DexScreener image
      logoUri: t.logoUri ?? normalizeImageUrl(ds?.imageUrl ?? null),
    }
  })
}

// ─── Monad tokens via direct RPC ─────────────────────────────────────────────

const MONAD_RPC = 'https://rpc.monad.xyz'
const MONAD_CHAIN = { id: 'monad', label: 'Monad', color: '#836EF9' }

const KNOWN_MONAD_TOKENS = [
  { address: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', name: 'Wrapped MON',  symbol: 'WMON',  decimals: 18 },
  { address: '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242', name: 'Wrapped ETH',  symbol: 'WETH',  decimals: 18 },
  { address: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', name: 'USDT0',         symbol: 'USDT0', decimals: 6  },
  { address: '0x81a224f8a62f52bde942dbf23a56df77a10b7777', name: 'emonad',        symbol: 'EMO',   decimals: 18 },
  { address: '0xcf5a6076cfa32686c0df13abada2b40dec133f1d', name: 'shMON',         symbol: 'shMON', decimals: 18 },
  { address: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', name: 'Staked MON',    symbol: 'sMON',  decimals: 18 },
  { address: '0x01bff41798a0bcf287b996046ca68b395dbc1071', name: 'Tether Gold',   symbol: 'XAUt0', decimals: 6  },
] as const

async function monadRpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(MONAD_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000)
  })
  const json = await res.json() as { result?: unknown }
  return json.result
}

async function fetchMonadTokens(address: string): Promise<WalletToken[]> {
  const tokens: WalletToken[] = []
  try {
    // Native MON
    const balHex = await monadRpcCall('eth_getBalance', [address, 'latest']) as string | null
    if (balHex && balHex !== '0x0') {
      const mon = Number(BigInt(balHex)) / 1e18
      if (mon > 0) {
        tokens.push({
          contractAddress: '0x0000000000000000000000000000000000000000',
          name: 'Monad', symbol: 'MON', decimals: 18,
          balance: mon.toFixed(4),
          usdValue: null, nativeEquivalent: null, nativeSymbol: 'MON',
          logoUri: 'https://assets.coingecko.com/coins/images/54540/small/monad.png',
          chain: 'monad', chainLabel: 'Monad', chainColor: '#836EF9'
        })
      }
    }

    // Known ERC-20 tokens — balanceOf selector 0x70a08231
    const paddedAddr = address.toLowerCase().replace('0x', '').padStart(64, '0')
    const balOfData = `0x70a08231${paddedAddr}`

    const results = await Promise.all(
      KNOWN_MONAD_TOKENS.map(t =>
        monadRpcCall('eth_call', [{ to: t.address, data: balOfData }, 'latest'])
          .then(hex => ({ t, hex: hex as string | null }))
          .catch(() => ({ t, hex: null }))
      )
    )

    for (const { t, hex } of results) {
      if (!hex || hex === '0x' || hex === '0x' + '0'.repeat(64)) continue
      const raw = BigInt(hex)
      if (raw === 0n) continue
      const bal = Number(raw) / Math.pow(10, t.decimals)
      if (bal < 0.000001) continue
      tokens.push({
        contractAddress: t.address,
        name: t.name, symbol: t.symbol, decimals: t.decimals,
        balance: bal.toLocaleString('en-US', { maximumFractionDigits: 6 }),
        usdValue: null, nativeEquivalent: null, nativeSymbol: 'MON',
        // Leave null — TrustWallet has no Monad assets. enrichWithPrices fills
        // this from the token's DexScreener image (same source ChainLens uses).
        logoUri: null,
        chain: 'monad', chainLabel: 'Monad', chainColor: '#836EF9'
      })
    }
  } catch (e) {
    console.error('[Monad] token fetch error:', e)
  }
  return tokens
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AllAddresses {
  evm: string
  solana?: string
  cardano?: string
  agw?: string   // resolved Abstract Global Wallet (override ?? auto-derive); null/absent = derive
}

export async function fetchAllTokens(
  addresses: AllAddresses,
  config: WalletConfig
): Promise<TokensResult> {
  try {
    // Use the caller-resolved AGW (override ?? auto-derive); fall back to deriving
    // here for callers that don't pass one.
    const agwAddressPromise = addresses.agw
      ? Promise.resolve(addresses.agw)
      : deriveAgwAddress(addresses.evm)

    const [evmResults, solanaTokens, cardanoTokens, monadTokens, agwAddress] = await Promise.all([
      Promise.all(TOKEN_CHAINS.map(chain => fetchTokensForChain(addresses.evm, chain, config.alchemyKey))),
      addresses.solana  ? fetchSolanaTokens(addresses.solana,   config.heliusKey)      : Promise.resolve([] as WalletToken[]),
      addresses.cardano ? fetchCardanoTokens(addresses.cardano, config.blockfrostKey)  : Promise.resolve([] as WalletToken[]),
      fetchMonadTokens(addresses.evm),
      agwAddressPromise,
    ])

    // Fetch Abstract tokens from AGW smart account if address differs from EOA,
    // tagging each so the UI can badge it as living in the smart wallet.
    const abstractChainCfg = TOKEN_CHAINS.find(c => c.id === 'abstract')!
    const agwTokens = (agwAddress && agwAddress.toLowerCase() !== addresses.evm.toLowerCase() && abstractChainCfg)
      ? (await fetchTokensForChain(agwAddress, abstractChainCfg, config.alchemyKey)).map(t => ({ ...t, source: 'agw' as const }))
      : []

    const raw = [...evmResults.flat(), ...agwTokens, ...solanaTokens, ...cardanoTokens, ...monadTokens]
    const tokens = await enrichWithPrices(raw)
    tokens.sort((a, b) => {
      const ua = parseFloat(a.usdValue?.replace('$', '') ?? '0') || 0
      const ub = parseFloat(b.usdValue?.replace('$', '') ?? '0') || 0
      return ub - ua || a.symbol.localeCompare(b.symbol)
    })
    return { tokens, fetchedAt: Date.now(), error: null }
  } catch (e) {
    return { tokens: [], fetchedAt: Date.now(), error: String(e) }
  }
}

// ─── Cardano NFT fetch ───────────────────────────────────────────────────────

function resolveCardanoImage(meta: Record<string, unknown>): string | null {
  const onchain = (meta.onchain_metadata ?? {}) as Record<string, unknown>
  const registry = (meta.metadata ?? {}) as Record<string, unknown>
  const candidates = [
    onchain.image, onchain.logo, onchain.icon,
    registry.logo, registry.url,
  ]
  for (let img of candidates) {
    if (!img) continue
    if (Array.isArray(img)) img = img.join('')
    if (typeof img !== 'string') continue
    img = img.trim()
    if (!img) continue
    if (img.startsWith('data:'))  return img
    if (img.startsWith('ipfs://')) return `https://dweb.link/ipfs/${img.slice(7)}`
    if (img.startsWith('http'))   return img
    if (img.length >= 46)         return `https://dweb.link/ipfs/${img}` // raw IPFS hash
  }
  return null
}

async function fetchCardanoNFTs(
  address: string,
  blockfrostKey: string
): Promise<WalletCollectible[]> {
  if (!address) return []
  const headers = { project_id: blockfrostKey }
  try {
    const addrRes = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
      headers,
      signal: AbortSignal.timeout(12_000)
    })
    if (!addrRes.ok) return []

    const addrData = await addrRes.json() as {
      stake_address?: string
      amount?: Array<{ unit: string; quantity: string }>
    }

    // Collect assets from stake account (more complete) + direct address amount
    let assets: Array<{ unit: string; quantity: string }> = []

    if (addrData.stake_address) {
      try {
        const stakeRes = await fetch(
          `https://cardano-mainnet.blockfrost.io/api/v0/accounts/${addrData.stake_address}/addresses/assets?count=100`,
          { headers, signal: AbortSignal.timeout(12_000) }
        )
        if (stakeRes.ok) {
          assets = await stakeRes.json() as Array<{ unit: string; quantity: string }>
        }
      } catch { /* fall through to direct */ }
    }

    // Merge direct address assets not already in stake list
    const stakeUnits = new Set(assets.map(a => a.unit))
    for (const a of addrData.amount ?? []) {
      if (a.unit !== 'lovelace' && !stakeUnits.has(a.unit)) {
        assets.push(a)
      }
    }

    // Filter to NFTs: quantity === 1
    const nftAssets = assets.filter(a => parseInt(a.quantity) === 1)
    if (nftAssets.length === 0) return []

    console.log(`[NFT] Cardano: found ${nftAssets.length} potential NFT assets`)

    const results = await Promise.all(
      nftAssets.slice(0, 50).map(async (a): Promise<WalletCollectible | null> => {
        try {
          const metaRes = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/assets/${a.unit}`, {
            headers,
            signal: AbortSignal.timeout(8_000)
          })
          if (!metaRes.ok) return null
          const meta = await metaRes.json() as Record<string, unknown>

          const onchain = (meta.onchain_metadata ?? {}) as Record<string, unknown>
          const registry = (meta.metadata ?? {}) as Record<string, unknown>

          let name = onchain.name ?? registry.name ?? null
          if (Array.isArray(name)) name = name.join('')
          if (typeof name !== 'string' || !name) {
            // Decode hex asset_name
            const hexName = (meta.asset_name as string | null) ?? ''
            try {
              const decoded = Buffer.from(hexName, 'hex').toString('utf8')
              name = /^[\x20-\x7E]+$/.test(decoded) ? decoded : hexName.slice(0, 16)
            } catch {
              name = hexName.slice(0, 16) || a.unit.slice(56, 72)
            }
          }

          const collection = (onchain.collection ?? onchain.project ?? registry.name ?? null) as string | null
          const image = resolveCardanoImage(meta)

          // Traits from CIP-25 attributes or top-level keys
          const rawAttrs = onchain.attributes ?? onchain.traits ?? null
          const traits: Array<{ trait_type: string; value: string }> = []
          if (rawAttrs && typeof rawAttrs === 'object' && !Array.isArray(rawAttrs)) {
            for (const [k, v] of Object.entries(rawAttrs as Record<string, unknown>)) {
              if (v != null) traits.push({ trait_type: k, value: String(v) })
            }
          } else if (Array.isArray(rawAttrs)) {
            for (const a of rawAttrs) {
              if (a && typeof a === 'object' && 'trait_type' in a && 'value' in a) {
                traits.push({ trait_type: String(a.trait_type), value: String(a.value) })
              }
            }
          }

          return {
            id: `cardano:${a.unit}`,
            name: String(name),
            description: (onchain.description as string | null) ?? null,
            image,
            animationUrl: null,
            collectionName: collection ? String(collection) : null,
            chain: 'cardano',
            chainLabel: 'Cardano',
            chainColor: '#2A7DEA',
            tokenId: a.unit.slice(56),
            contractAddress: a.unit.slice(0, 56),
            contractType: 'CIP25',
            traits
          }
        } catch { return null }
      })
    )

    const nfts = results.filter((n): n is WalletCollectible => n !== null)
    console.log(`[NFT] Cardano: returning ${nfts.length} NFTs`)
    return nfts
  } catch { return [] }
}

// ─── NFT fetch ────────────────────────────────────────────────────────────────

interface ChainNftResult {
  chain: typeof NFT_CHAINS[0]
  items: WalletCollectible[]
  error: string | null
}

async function fetchNftsForChain(
  address: string,
  chain: typeof NFT_CHAINS[0],
  key: string
): Promise<ChainNftResult> {
  const base = nftUrl(chain.network, key)
  const url = `${base}/getNFTsForOwner?owner=${address}&withMetadata=true`
  console.log(`[NFT] Fetching ${chain.label}: ${url.replace(key, '***')}`)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const msg = `HTTP ${res.status}: ${body.slice(0, 200)}`
      console.error(`[NFT] ${chain.label} error: ${msg}`)
      return { chain, items: [], error: msg }
    }

    const json = await res.json() as {
      ownedNfts?: Array<{
        tokenId: string
        contract: { address: string; name: string | null; tokenType: string }
        name: string | null
        description: string | null
        image?: { cachedUrl: string | null; thumbnailUrl: string | null; originalUrl: string | null; pngUrl: string | null }
        collection?: { name: string | null }
        raw?: { metadata?: { attributes?: Array<{ trait_type?: string; value?: unknown }>; animation_url?: string } }
      }>
      error?: string
    }

    if (json.error) {
      console.error(`[NFT] ${chain.label} API error: ${json.error}`)
      return { chain, items: [], error: json.error }
    }

    const items = (json.ownedNfts ?? []).map(nft => ({
      id: `${chain.id}:${nft.contract.address}:${nft.tokenId}`,
      name: nft.name ?? `#${nft.tokenId}`,
      description: nft.description ?? null,
      image: normalizeImageUrl(nft.image?.cachedUrl ?? nft.image?.pngUrl ?? nft.image?.thumbnailUrl ?? nft.image?.originalUrl ?? null),
      animationUrl: nft.raw?.metadata?.animation_url ? normalizeImageUrl(nft.raw.metadata.animation_url) : null,
      collectionName: nft.collection?.name ?? nft.contract.name ?? null,
      chain: chain.id, chainLabel: chain.label, chainColor: chain.color,
      tokenId: nft.tokenId,
      contractAddress: nft.contract.address,
      contractType: nft.contract.tokenType,
      // Spam/malformed NFTs sometimes return `attributes` as an object or string
      // instead of an array. Guard with Array.isArray — without it, .filter throws
      // and the whole chain's .map aborts, dropping every NFT on that chain.
      traits: (Array.isArray(nft.raw?.metadata?.attributes) ? nft.raw!.metadata!.attributes! : [])
        .filter(a => a.trait_type != null && a.value != null)
        .map(a => ({ trait_type: String(a.trait_type), value: String(a.value) }))
    }))

    console.log(`[NFT] ${chain.label}: found ${items.length} NFTs`)
    return { chain, items, error: null }
  } catch (e) {
    const msg = String(e)
    console.error(`[NFT] ${chain.label} exception: ${msg}`)
    return { chain, items: [], error: msg }
  }
}

// ─── Monad NFTs via Blockscout v2 ────────────────────────────────────────────

async function fetchMonadNFTs(address: string, moralisKey: string): Promise<WalletCollectible[]> {
  // chain=0x8f is Monad mainnet (chainId 143)
  const url = `https://deep-index.moralis.io/api/v2.2/${address}/nft?chain=0x8f&format=decimal&media_items=true`
  console.log(`[NFT] Monad Moralis: fetching NFTs for ${address.slice(0, 10)}…`)
  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': moralisKey },
      signal: AbortSignal.timeout(15_000)
    })
    console.log(`[NFT] Monad Moralis HTTP ${res.status}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[NFT] Monad Moralis error: ${body.slice(0, 200)}`)
      return []
    }

    const data = await res.json() as {
      result?: Array<{
        token_address: string
        token_id: string
        name: string | null
        normalized_metadata?: { name?: string; description?: string; image?: string; attributes?: unknown[] } | null
        media?: { media_collection?: { medium?: { url?: string } }; original_media_url?: string } | null
      }>
    }

    const items = data.result ?? []
    console.log(`[NFT] Monad: found ${items.length} NFTs via Moralis`)

    return items.map(nft => {
      const meta = nft.normalized_metadata ?? {}
      const rawImage = nft.media?.media_collection?.medium?.url
        ?? nft.media?.original_media_url
        ?? meta.image
        ?? null
      const attrs = Array.isArray(meta.attributes) ? meta.attributes : []
      return {
        id: `monad:${nft.token_address}:${nft.token_id}`,
        name: meta.name ?? nft.name ?? `#${nft.token_id}`,
        description: meta.description ?? null,
        image: normalizeImageUrl(rawImage ?? null),
        animationUrl: null,
        collectionName: nft.name ?? null,
        chain: 'monad',
        chainLabel: 'Monad',
        chainColor: '#836EF9',
        tokenId: nft.token_id,
        contractAddress: nft.token_address,
        contractType: 'ERC-721',
        traits: attrs
          .filter((a): a is Record<string, unknown> => a != null && typeof a === 'object')
          .filter(a => a['trait_type'] != null && a['value'] != null)
          .map(a => ({ trait_type: String(a['trait_type']), value: String(a['value']) }))
      } satisfies WalletCollectible
    })
  } catch (e) {
    console.error('[NFT] Monad Moralis fetch failed:', e)
    return []
  }
}

export async function fetchAllCollectibles(
  evmAddress: string,
  cardanoAddress: string | undefined,
  config: WalletConfig,
  solanaAddress?: string,
  agw?: string
): Promise<CollectiblesResult> {
  console.log(`[NFT] fetchAllCollectibles — EVM: ${evmAddress}, Solana: ${solanaAddress ?? 'none'}, Cardano: ${cardanoAddress ?? 'none'}`)
  try {
    // Use the caller-resolved AGW (override ?? auto-derive); fall back to deriving.
    const agwAddress = agw ?? await deriveAgwAddress(evmAddress)
    const abstractChainCfg = NFT_CHAINS.find(c => c.id === 'abstract')!

    const [evmResults, solanaNfts, cardanoNfts, agwAbstractNfts, monadNfts] = await Promise.all([
      Promise.all(NFT_CHAINS.map(chain => fetchNftsForChain(evmAddress, chain, config.alchemyKey))),
      solanaAddress  ? fetchSolanaNFTs(solanaAddress, config.heliusKey)       : Promise.resolve([] as WalletCollectible[]),
      cardanoAddress ? fetchCardanoNFTs(cardanoAddress, config.blockfrostKey) : Promise.resolve([] as WalletCollectible[]),
      (agwAddress && agwAddress.toLowerCase() !== evmAddress.toLowerCase() && abstractChainCfg)
        ? fetchNftsForChain(agwAddress, abstractChainCfg, config.alchemyKey).then(r => r.items.map(n => ({ ...n, source: 'agw' as const })))
        : Promise.resolve([] as WalletCollectible[]),
      fetchMonadNFTs(evmAddress, config.moralisKey),
    ])

    const items = [...evmResults.flatMap(r => r.items), ...agwAbstractNfts, ...monadNfts, ...solanaNfts, ...cardanoNfts]
    const chainResults: Record<string, { count: number; error: string | null }> = {}
    for (const r of evmResults) {
      chainResults[r.chain.id] = { count: r.items.length, error: r.error }
    }
    chainResults['monad']   = { count: monadNfts.length,  error: null }
    if (solanaAddress) {
      chainResults['solana'] = { count: solanaNfts.length, error: null }
    }
    if (cardanoAddress) {
      chainResults['cardano'] = { count: cardanoNfts.length, error: null }
    }

    console.log(`[NFT] Total NFTs found: ${items.length}`)
    return { items, fetchedAt: Date.now(), error: null, chainResults }
  } catch (e) {
    return { items: [], fetchedAt: Date.now(), error: String(e), chainResults: {} }
  }
}
