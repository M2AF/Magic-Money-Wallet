import { useState } from 'react'
import type { ChainBalance, ChainHistory } from '../types/wallet'
import { TxList } from './TxList'

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 80, H = 28
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

interface ChainMeta {
  name: string
  networks: string
  color: string
  colorRgb: string
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
  abstract:   { name: 'Abstract',     networks: 'L2 · Ethereum',              color: '#6B7280', colorRgb: '107, 114, 128'  },
  apechain:   { name: 'ApeChain',     networks: 'L3 · ApeChain',              color: '#0066FF', colorRgb: '0, 102, 255'    },
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
  dogecoin:   { name: 'Dogecoin',     networks: 'Mainnet',                    color: '#C2A633', colorRgb: '194, 166, 51'   }
}

const FALLBACK_META: ChainMeta = { name: 'Unknown', networks: '', color: '#6B7280', colorRgb: '107, 114, 128' }

interface Props {
  chainId: string
  balance: ChainBalance | null
  address: string | null
  loading?: boolean
  onSend?: () => void
  history?: ChainHistory | null
}

export function ChainCard({ chainId, balance, address, loading, onSend, history }: Props) {
  const [copied, setCopied] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const meta = CHAIN_META[chainId] ?? FALLBACK_META

  const truncate = (addr: string) => addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr

  const copyAddress = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      className="chain-card"
      style={{
        ['--chain-color' as string]: meta.color,
        ['--chain-color-rgb' as string]: meta.colorRgb
      }}
    >
      {/* Header row: [name] [sparkline] [balance + USD + 24h] */}
      <div className="chain-header">
        <div className="chain-info">
          <div className="chain-dot" />
          <div>
            <div className="chain-name">{meta.name}</div>
            <div className="chain-networks">{meta.networks}</div>
          </div>
        </div>

        {/* Sparkline — centre column */}
        {!loading && !balance?.error && balance?.sparkline && balance.sparkline.length > 1 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
            <Sparkline data={balance.sparkline} color={meta.color} />
          </div>
        )}

        {/* Balance */}
        <div className="chain-balance">
          {loading ? (
            <div style={{ width: 60, height: 18, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
          ) : balance?.error === 'coming-soon' ? (
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(var(--chain-color-rgb), 0.7)', background: 'rgba(var(--chain-color-rgb), 0.1)', border: '1px solid rgba(var(--chain-color-rgb), 0.2)', borderRadius: 4, padding: '2px 7px' }}>Soon</div>
          ) : balance?.error ? (
            <div className="chain-error">Unavailable</div>
          ) : (
            <>
              <div className="chain-amount">
                {balance?.native ?? '—'} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{balance?.symbol}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="chain-usd">{balance?.usdValue ?? '$0.00'}</div>
                {balance?.priceChange24h != null && (
                  <div style={{
                    fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: balance.priceChange24h >= 0 ? '#22c55e' : '#ef4444'
                  }}>
                    {balance.priceChange24h >= 0 ? '▲' : '▼'} {Math.abs(balance.priceChange24h).toFixed(2)}%
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Address row */}
      {address ? (
        <div
          className="address-chip"
          onClick={copyAddress}
          title={address}
          style={{ cursor: 'pointer' }}
        >
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span style={{ flex: 1 }}>{truncate(address)}</span>
          {copied ? (
            <svg width="11" height="11" fill="none" stroke="#22c55e" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          )}
        </div>
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
            background: 'var(--accent-dim)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, transition: 'all var(--transition)'
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-active)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
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
