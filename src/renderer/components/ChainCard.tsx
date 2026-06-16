import { useState } from 'react'
import type { ChainBalance } from '../types/wallet'

interface ChainMeta {
  name: string
  networks: string    // sub-label
  color: string
  colorRgb: string
}

const CHAIN_META: Record<string, ChainMeta> = {
  evm: {
    name: 'EVM',
    networks: 'Ethereum · Monad · Abstract',
    color: '#627EEA',
    colorRgb: '98, 126, 234'
  },
  solana: {
    name: 'Solana',
    networks: 'Mainnet',
    color: '#9945FF',
    colorRgb: '153, 69, 255'
  },
  cardano: {
    name: 'Cardano',
    networks: 'Mainnet',
    color: '#2A7DEA',
    colorRgb: '42, 125, 234'
  }
}

interface Props {
  chain: 'evm' | 'solana' | 'cardano'
  balance: ChainBalance | null
  address: string | null
  loading?: boolean
}

export function ChainCard({ chain, balance, address, loading }: Props) {
  const [copied, setCopied] = useState(false)
  const meta = CHAIN_META[chain]

  const truncate = (addr: string) => `${addr.slice(0, 8)}…${addr.slice(-6)}`

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
      {/* Header row */}
      <div className="chain-header">
        <div className="chain-info">
          <div className="chain-dot" />
          <div>
            <div className="chain-name">{meta.name}</div>
            <div className="chain-networks">{meta.networks}</div>
          </div>
        </div>

        {/* Balance */}
        <div className="chain-balance">
          {loading ? (
            <div style={{ width: 60, height: 18, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
          ) : balance?.error ? (
            <div className="chain-error">Error</div>
          ) : (
            <>
              <div className="chain-amount">
                {balance?.native ?? '—'} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{balance?.symbol}</span>
              </div>
              {balance?.usdValue && (
                <div className="chain-usd">{balance.usdValue}</div>
              )}
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
          {chain === 'cardano' ? 'Cardano library not installed' : 'No address'}
        </div>
      )}

      {/* Token count */}
      {!loading && balance && !balance.error && balance.tokenCount > 0 && (
        <div className="chain-token-count">
          <span className="token-badge">{balance.tokenCount} token{balance.tokenCount !== 1 ? 's' : ''}</span>
          <span>in wallet</span>
        </div>
      )}

      {/* Error detail — only shown when we have an address so it's a real API/network error,
           not the CSL-missing case (already shown in the address row above) */}
      {balance?.error && !loading && address && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {balance.error.startsWith('Blockfrost')
            ? balance.error
            : balance.error.includes('fetch')
              ? 'Network error — check connection'
              : 'API error'}
        </div>
      )}
    </div>
  )
}