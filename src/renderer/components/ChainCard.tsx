import { useState } from 'react'
import type { ChainBalance, ChainHistory } from '../types/wallet'
import { CHAIN_ICONS } from '../data/chain-icons'
import { TxList } from './TxList'
import { useDisplayCurrency } from '../lib/currency'

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 300, H = 50
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 2) - 1}`)
    .join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
    </svg>
  )
}

/**
 * Chain logomark. Bundled brand marks come from CHAIN_ICONS; custom (user-added)
 * networks can supply their explorer's favicon via `iconUrl`. Anything without
 * an icon — or whose icon fails to load — keeps the original glowing dot, so the
 * row never renders a broken image.
 */
function ChainLogo({ chainId, iconUrl }: { chainId: string; iconUrl?: string }) {
  const [failed, setFailed] = useState(false)
  const src = CHAIN_ICONS[chainId] ?? iconUrl
  if (!src || failed) return <div className="chain-dot" />
  return (
    <img
      className="chain-logo"
      src={src}
      alt=""
      width={26}
      height={26}
      onError={() => setFailed(true)}
    />
  )
}

export interface ChainMeta {
  name: string
  networks: string
  color: string
  colorRgb: string
  /** Custom networks only — favicon of the chain's explorer, if it has one. */
  iconUrl?: string
}

const CHAIN_META: Record<string, ChainMeta> = {
  ethereum:   { name: 'Ethereum',     networks: 'Mainnet',                    color: '#627EEA', colorRgb: '98, 126, 234'   },
  arbitrum:   { name: 'Arbitrum One', networks: 'L2 · Ethereum',              color: '#28A0F0', colorRgb: '40, 160, 240'   },
  optimism:   { name: 'Optimism',     networks: 'L2 · Ethereum',              color: '#FF0420', colorRgb: '255, 4, 32'     },
  base:       { name: 'Base',         networks: 'L2 · Ethereum',              color: '#0052FF', colorRgb: '0, 82, 255'     },
  polygon:    { name: 'Polygon',      networks: 'L2 · Proof of Stake',        color: '#8247E5', colorRgb: '130, 71, 229'   },
  avalanche:  { name: 'Avalanche',    networks: 'C-Chain',                    color: '#E84142', colorRgb: '232, 65, 66'    },
  blast:      { name: 'Blast',        networks: 'L2 · Ethereum',              color: '#FCFC03', colorRgb: '252, 252, 3'    },
  gnosis:     { name: 'Gnosis',       networks: 'Mainnet',                    color: '#04795B', colorRgb: '4, 121, 91'     },
  monad:      { name: 'Monad',        networks: 'Mainnet',                    color: '#836EF9', colorRgb: '131, 110, 249'  },
  abstract:   { name: 'Abstract',     networks: 'L2 · Ethereum',              color: '#1FCE92', colorRgb: '31, 206, 146'   },
  apechain:   { name: 'ApeChain',     networks: 'L3 · ApeChain',              color: '#0066FF', colorRgb: '0, 102, 255'    },
  robinhood:  { name: 'Robinhood',    networks: 'L2 · Ethereum',              color: '#00C805', colorRgb: '0, 200, 5'      },
  ronin:      { name: 'Ronin',        networks: 'Mainnet',                    color: '#1273EA', colorRgb: '18, 115, 234'   },
  soneium:    { name: 'Soneium',      networks: 'L2 · Ethereum',              color: '#5B5EA6', colorRgb: '91, 94, 166'    },
  worldchain: { name: 'WorldChain',   networks: 'L2 · Ethereum',              color: '#5A64C8', colorRgb: '90, 100, 200'   },
  zora:       { name: 'Zora',         networks: 'L2 · Ethereum',              color: '#2B5DF0', colorRgb: '43, 93, 240'    },
  hyperevm:   { name: 'HyperEVM',     networks: 'HyperLiquid L1',             color: '#00BF7D', colorRgb: '0, 191, 125'    },
  solana:     { name: 'Solana',       networks: 'Mainnet',                    color: '#9945FF', colorRgb: '153, 69, 255'   },
  cardano:    { name: 'Cardano',      networks: 'Mainnet',                    color: '#2A7DEA', colorRgb: '42, 125, 234'   },
  bitcoin:    { name: 'Bitcoin',      networks: 'Mainnet',                    color: '#F7931A', colorRgb: '247, 147, 26'   },
  polkadot:   { name: 'Polkadot',     networks: 'Relay Chain',                color: '#E6007A', colorRgb: '230, 0, 122'    },
  tron:       { name: 'Tron',         networks: 'Mainnet',                    color: '#EB0029', colorRgb: '235, 0, 41'     },
  dogecoin:   { name: 'Dogecoin',     networks: 'Mainnet',                    color: '#C2A633', colorRgb: '194, 166, 51'   },
  // Testnet Mode only — the second Bitcoin network entry (same tb1 addresses).
  'bitcoin-testnet4': { name: 'Bitcoin', networks: 'Testnet4',                color: '#F7931A', colorRgb: '247, 147, 26'   },
  // Privacy Mode chains.
  monero:     { name: 'Monero',       networks: 'Mainnet',                    color: '#FF6600', colorRgb: '255, 102, 0'    },
  zcash:      { name: 'Zcash',        networks: 'Transparent pool',           color: '#F4B728', colorRgb: '244, 183, 40'   },
  midnight:   { name: 'Midnight',     networks: 'Mainnet',                    color: '#7C3AED', colorRgb: '124, 58, 237'   }
}

// Testnet Mode network subtitles (per chain id). Chains absent here keep their
// mainnet subtitle — but the dashboard only lists chains with a testnet anyway.
const TESTNET_NETWORKS: Record<string, string> = {
  ethereum: 'Sepolia · Testnet',   arbitrum: 'Arbitrum Sepolia',   optimism: 'OP Sepolia',
  base: 'Base Sepolia',            polygon: 'Amoy · Testnet',      avalanche: 'Fuji · Testnet',
  blast: 'Blast Sepolia',          gnosis: 'Chiado · Testnet',     monad: 'Monad Testnet',
  abstract: 'Abstract Testnet',    apechain: 'Curtis · Testnet',   robinhood: 'Robinhood Testnet', ronin: 'Saigon · Testnet',
  soneium: 'Minato · Testnet',     worldchain: 'World Chain Sepolia', zora: 'Zora Sepolia',
  hyperevm: 'HyperEVM Testnet',    solana: 'Devnet',               cardano: 'Preprod · Testnet',
  bitcoin: 'Testnet3',             'bitcoin-testnet4': 'Testnet4', tron: 'Shasta · Testnet',
  midnight: 'Preprod · Testnet',
}

const FALLBACK_META: ChainMeta = { name: 'Unknown', networks: '', color: '#6B7280', colorRgb: '107, 114, 128' }

/** Human-readable chain name, e.g. for the Networks tab search filter. */
export function getChainName(chainId: string): string {
  return (CHAIN_META[chainId] ?? FALLBACK_META).name
}

interface Props {
  chainId: string
  balance: ChainBalance | null
  address: string | null
  /** When set (e.g. Bitcoin's Native/Nested SegWit + Taproot), render a labeled list instead of one chip. */
  altAddresses?: Array<{ label: string; address: string }>
  loading?: boolean
  onSend?: () => void
  history?: ChainHistory | null
  /** Testnet Mode: swaps the network subtitle for the chain's testnet label. */
  testnet?: boolean
  /** Custom (user-added) chains have no CHAIN_META entry — pass theirs here. */
  meta?: ChainMeta
}

export function ChainCard({ chainId, balance, address, altAddresses, loading, onSend, history, testnet = false, meta: metaOverride }: Props) {
  const { fmt } = useDisplayCurrency()
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const baseMeta = metaOverride ?? CHAIN_META[chainId] ?? FALLBACK_META
  const meta = testnet ? { ...baseMeta, networks: TESTNET_NETWORKS[chainId] ?? baseMeta.networks } : baseMeta

  const truncate = (addr: string) => addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr

  const copy = async (addr: string) => {
    await navigator.clipboard.writeText(addr)
    setCopiedAddr(addr)
    setTimeout(() => setCopiedAddr(null), 1800)
  }

  const addressChip = (a: string) => (
    <div className="address-chip" onClick={() => copy(a)} title={a} style={{ cursor: 'pointer' }}>
      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span style={{ flex: 1 }}>{truncate(a)}</span>
      {copiedAddr === a ? (
        <svg width="11" height="11" fill="none" stroke="#22c55e" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </div>
  )

  return (
    <div
      className="chain-card"
      style={{
        ['--chain-color' as string]: meta.color,
        ['--chain-color-rgb' as string]: meta.colorRgb
      }}
    >
      {/* Header row: [logo + name + sparkline/24h] [balance + USD] */}
      <div className="chain-header">
        <div className="chain-info">
          <ChainLogo chainId={chainId} iconUrl={meta.iconUrl} />
          <div>
            <div className="chain-name">{meta.name}</div>
            <div className="chain-networks">{meta.networks}</div>
            {/* Sparkline sits under the network name, centred in the gap
                between the logo and the balance column. */}
            {!loading && !balance?.error && (balance?.sparkline?.length ?? 0) > 1 && (
              <div className="chain-spark-row">
                <Sparkline data={balance!.sparkline!} color={meta.color} />
              </div>
            )}
          </div>
        </div>

        {/* Balance */}
        <div className="chain-balance">
          {loading ? (
            <div style={{ width: 60, height: 18, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
          ) : balance?.error === 'coming-soon' ? (
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(var(--chain-color-rgb), 0.7)', background: 'rgba(var(--chain-color-rgb), 0.1)', border: '1px solid rgba(var(--chain-color-rgb), 0.2)', borderRadius: 4, padding: '2px 7px' }}>Soon</div>
          ) : balance?.error?.startsWith('Syncing') ? (
            // Monero view-wallet catching up — busy, not broken.
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(var(--chain-color-rgb), 0.85)', background: 'rgba(var(--chain-color-rgb), 0.1)', border: '1px solid rgba(var(--chain-color-rgb), 0.2)', borderRadius: 4, padding: '2px 7px' }}>{balance.error}</div>
          ) : balance?.error === 'receive-only' ? (
            // Monero on browser targets — address works, balance needs the
            // desktop app (or the native Android build / a future LWS).
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(var(--chain-color-rgb), 0.7)', background: 'rgba(var(--chain-color-rgb), 0.1)', border: '1px solid rgba(var(--chain-color-rgb), 0.2)', borderRadius: 4, padding: '2px 7px' }}>Receive only</div>
          ) : balance?.error ? (
            <div className="chain-error">Unavailable</div>
          ) : (
            <>
              <div className="chain-amount">
                {balance?.native ?? '—'} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{balance?.symbol}</span>
              </div>
              {/* 24h change sits to the left of the USD value. */}
              <div className="chain-price-line">
                {balance?.priceChange24h != null && (
                  <div className={`chain-change ${balance.priceChange24h >= 0 ? 'up' : 'down'}`}>
                    {balance.priceChange24h >= 0 ? '▲' : '▼'} {Math.abs(balance.priceChange24h).toFixed(2)}%
                  </div>
                )}
                <div className="chain-usd">{fmt(balance?.usdValue) ?? fmt(0)}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Address row(s) — Bitcoin shows three labeled types; every other chain shows one */}
      {altAddresses && altAddresses.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {altAddresses.filter(x => x.address).map(({ label, address: a }) => (
            <div key={a}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
              {addressChip(a)}
            </div>
          ))}
        </div>
      ) : address ? (
        addressChip(address)
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {chainId === 'cardano' ? 'Deriving address…' : 'No address'}
        </div>
      )}

      {/* Send button */}
      {onSend && !loading && address && !balance?.error && (
        <button
          type="button"
          onClick={onSend}
          style={{
            marginTop: 10, width: '100%', padding: '8px 12px',
            background: 'var(--accent-dim)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, transition: 'all var(--transition)', textAlign: 'center'
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-active)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          Send {balance?.symbol ?? ''}
        </button>
      )}

      {/* Token count */}
      {!loading && balance && !balance.error && balance.tokenCount > 0 && (
        <div className="chain-token-count">
          <span className="token-badge">{balance.tokenCount} token{balance.tokenCount !== 1 ? 's' : ''}</span>
          <span>in wallet</span>
        </div>
      )}

      {/* Error detail */}
      {balance?.error && !loading && address && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {balance.error.startsWith('Blockfrost') || balance.error.startsWith('RPC')
            ? balance.error
            : balance.error}
        </div>
      )}

      {/* Transaction history */}
      {history !== undefined && !loading && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 1, background: 'var(--border)', marginBottom: 8 }} />
          {history === null ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              Loading history…
            </div>
          ) : history.error ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>History unavailable</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setHistoryOpen(o => !o)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)' }}
              >
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transition: 'transform 0.18s', transform: historyOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                {history.records.length === 0
                  ? 'No recent transactions'
                  : `${history.records.length} recent transaction${history.records.length !== 1 ? 's' : ''}`
                }
              </button>
              {historyOpen && (
                <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                  <TxList records={history.records} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
