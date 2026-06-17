import type { WalletConfig } from './secure-store'

export interface WalletToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  balance: string
  usdValue: string | null
  logoUri: string | null
  chain: string
  chainLabel: string
  chainColor: string
}

export interface TokensResult {
  tokens: WalletToken[]
  fetchedAt: number
  error: string | null
}

export interface WalletCollectible {
  id: string
  name: string
  description: string | null
  image: string | null
  collectionName: string | null
  chain: string
  chainLabel: string
  chainColor: string
  tokenId: string
  contractAddress: string
  contractType: string
}

export interface CollectiblesResult {
  items: WalletCollectible[]
  fetchedAt: number
  error: string | null
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

const NFT_CHAINS = TOKEN_CHAINS.slice(0, 5) // eth, arb, base, polygon, optimism

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

function rpcUrl(network: string, key: string) {
  return `https://${network}.g.alchemy.com/v2/${key}`
}
function nftUrl(network: string, key: string) {
  return `https://${network}.g.alchemy.com/nft/v3/${key}`
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
  if (total >= 1000) return total.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (total >= 1)    return total.toFixed(4).replace(/\.?0+$/, '')
  if (total >= 0.0001) return total.toPrecision(4)
  return total.toExponential(2)
}

function humanBalanceDecimal(raw: number, decimals: number): string {
  const total = raw / 10 ** decimals
  if (total === 0) return '0'
  if (total >= 1000) return total.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (total >= 1)    return total.toFixed(4).replace(/\.?0+$/, '')
  if (total >= 0.0001) return total.toPrecision(4)
  return total.toExponential(2)
}

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
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'alchemy_getTokenBalances',
        params: [address, 'erc20']
      }),
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

    // Batch metadata
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
      return {
        contractAddress: t.contractAddress,
        name: meta.name ?? 'Unknown Token',
        symbol: meta.symbol ?? '???',
        decimals,
        balance: humanBalance(t.tokenBalance, decimals),
        usdValue: null,
        logoUri: (meta as { logo?: string | null }).logo ?? null,
        chain: chain.id,
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
  token_info?: { balance?: number; decimals?: number; symbol?: string; token_program?: string }
}

async function fetchSolanaTokens(
  address: string,
  heliusKey: string
): Promise<WalletToken[]> {
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'spl-tokens',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: address,
          page: 1,
          limit: 200,
          displayOptions: { showFungible: true, showNativeBalance: false }
        }
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return []

    const json = await res.json() as { result?: { items?: HeliusFungibleItem[] } }
    const items = json.result?.items ?? []

    return items
      .filter(item => item.interface === 'FungibleToken' || item.interface === 'FungibleAsset')
      .filter(item => (item.token_info?.balance ?? 0) > 0)
      .map(item => {
        const decimals = item.token_info?.decimals ?? 0
        const balance = item.token_info?.balance ?? 0
        const symbol  = item.token_info?.symbol ?? item.content?.metadata?.symbol ?? '???'
        const name    = item.content?.metadata?.name ?? symbol
        const logo    = item.content?.links?.image ?? null
        return {
          contractAddress: item.id,
          name,
          symbol,
          decimals,
          balance: humanBalanceDecimal(balance, decimals),
          usdValue: null,
          logoUri: logo,
          chain: 'solana',
          chainLabel: 'Solana',
          chainColor: '#9945FF'
        }
      })
      .filter(t => t.symbol !== '???')
  } catch {
    return []
  }
}

// ─── Cardano native assets via Blockfrost ────────────────────────────────────

interface BlockfrostAmount {
  unit: string
  quantity: string
}

interface BlockfrostAsset {
  asset: string
  quantity: string
  asset_name: string | null
  fingerprint: string
  onchain_metadata?: { name?: string; image?: string } | null
  metadata?: { name?: string; logo?: string } | null
}

async function fetchCardanoTokens(
  address: string,
  blockfrostKey: string
): Promise<WalletToken[]> {
  if (!address) return []
  try {
    const addrRes = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`, {
      headers: { project_id: blockfrostKey },
      signal: AbortSignal.timeout(12_000)
    })
    if (!addrRes.ok) return []

    const addrJson = await addrRes.json() as { amount?: BlockfrostAmount[] }
    const nativeAssets = (addrJson.amount ?? []).filter(a => a.unit !== 'lovelace').slice(0, 30)
    if (nativeAssets.length === 0) return []

    // Fetch metadata for each asset (cap at 20 to avoid rate limits)
    const assets = await Promise.all(
      nativeAssets.slice(0, 20).map(async (a): Promise<WalletToken | null> => {
        try {
          const meta = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/assets/${a.unit}`, {
            headers: { project_id: blockfrostKey },
            signal: AbortSignal.timeout(8_000)
          })
          const mj: BlockfrostAsset = meta.ok ? await meta.json() : {} as BlockfrostAsset

          const rawName = mj.onchain_metadata?.name ?? mj.metadata?.name ?? mj.asset_name ?? null
          const name    = rawName ? decodeAssetName(rawName) : a.unit.slice(0, 8) + '…'
          const symbol  = name.length <= 10 ? name : name.slice(0, 8) + '…'
          const logo    = mj.onchain_metadata?.image
            ? ipfsToHttp(mj.onchain_metadata.image as string)
            : mj.metadata?.logo
              ? `data:image/png;base64,${mj.metadata.logo}`
              : null

          return {
            contractAddress: a.unit,
            name,
            symbol,
            decimals: 0,
            balance: parseInt(a.quantity).toLocaleString('en-US'),
            usdValue: null,
            logoUri: logo,
            chain: 'cardano',
            chainLabel: 'Cardano',
            chainColor: '#2A7DEA'
          }
        } catch {
          return null
        }
      })
    )
    return assets.filter((a): a is WalletToken => a !== null)
  } catch {
    return []
  }
}

function decodeAssetName(raw: string): string {
  // Blockfrost asset names are hex-encoded
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) {
    try {
      const bytes = Buffer.from(raw, 'hex')
      const decoded = bytes.toString('utf8')
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded
    } catch { /* fallback */ }
  }
  return raw
}

function ipfsToHttp(uri: string): string {
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`
  return uri
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AllAddresses {
  evm: string
  solana?: string
  cardano?: string
}

export async function fetchAllTokens(
  addresses: AllAddresses,
  config: WalletConfig
): Promise<TokensResult> {
  try {
    const [evmResults, solanaTokens, cardanoTokens] = await Promise.all([
      Promise.all(TOKEN_CHAINS.map(chain => fetchTokensForChain(addresses.evm, chain, config.alchemyKey))),
      addresses.solana ? fetchSolanaTokens(addresses.solana, config.heliusKey) : Promise.resolve([] as WalletToken[]),
      addresses.cardano ? fetchCardanoTokens(addresses.cardano, config.blockfrostKey) : Promise.resolve([] as WalletToken[]),
    ])
    const tokens = [...evmResults.flat(), ...solanaTokens, ...cardanoTokens]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
    return { tokens, fetchedAt: Date.now(), error: null }
  } catch (e) {
    return { tokens: [], fetchedAt: Date.now(), error: String(e) }
  }
}

async function fetchNftsForChain(
  address: string,
  chain: typeof NFT_CHAINS[0],
  key: string
): Promise<WalletCollectible[]> {
  const base = nftUrl(chain.network, key)
  try {
    const res = await fetch(
      `${base}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=50&excludeFilters[]=SPAM`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) return []

    const json = await res.json() as {
      ownedNfts?: Array<{
        tokenId: string
        contract: { address: string; name: string | null; tokenType: string }
        name: string | null
        description: string | null
        image?: { cachedUrl: string | null; originalUrl: string | null }
        collection?: { name: string | null }
      }>
    }

    return (json.ownedNfts ?? []).map(nft => ({
      id: `${chain.id}:${nft.contract.address}:${nft.tokenId}`,
      name: nft.name ?? `#${nft.tokenId}`,
      description: nft.description ?? null,
      image: nft.image?.cachedUrl ?? nft.image?.originalUrl ?? null,
      collectionName: nft.collection?.name ?? nft.contract.name ?? null,
      chain: chain.id,
      chainLabel: chain.label,
      chainColor: chain.color,
      tokenId: nft.tokenId,
      contractAddress: nft.contract.address,
      contractType: nft.contract.tokenType
    }))
  } catch {
    return []
  }
}

export async function fetchAllCollectibles(
  evmAddress: string,
  config: WalletConfig
): Promise<CollectiblesResult> {
  try {
    const results = await Promise.all(
      NFT_CHAINS.map(chain => fetchNftsForChain(evmAddress, chain, config.alchemyKey))
    )
    const items = results.flat()
    return { items, fetchedAt: Date.now(), error: null }
  } catch (e) {
    return { items: [], fetchedAt: Date.now(), error: String(e) }
  }
}
