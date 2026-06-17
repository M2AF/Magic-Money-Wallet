import type { TxRecord } from '../types/wallet'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000)          return 'just now'
  if (diff < 3_600_000)       return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)      return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000)  return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function truncate(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s
}

interface Props {
  records: TxRecord[]
}

export function TxList({ records }: Props) {
  if (records.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
        No transactions yet
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {records.map(tx => {
        const isIn  = tx.direction === 'in'
        const isOut = tx.direction === 'out'
        const color = isIn ? 'var(--success)' : isOut ? 'var(--error)' : 'var(--text-muted)'
        const arrow = isIn ? '↓' : isOut ? '↑' : '↔'

        return (
          <div
            key={tx.hash}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 10px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 'var(--radius-sm)',
              borderLeft: `2px solid ${color}`,
              fontSize: 11
            }}
          >
            {/* Direction */}
            <span style={{ color, fontWeight: 700, fontFamily: 'var(--font-mono)', minWidth: 10, flexShrink: 0 }}>
              {arrow}
            </span>

            {/* Amount */}
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tx.amount ? `${tx.amount} ${tx.symbol}` : tx.symbol}
            </span>

            {/* Counterparty */}
            {tx.counterparty && (
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {truncate(tx.counterparty)}
              </span>
            )}

            {/* Time */}
            <span style={{ color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {timeAgo(tx.timestamp)}
            </span>

            {/* Explorer link */}
            <button
              type="button"
              title={`View on explorer: ${tx.hash}`}
              onClick={() => window.open(tx.explorerUrl)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--accent)', opacity: 0.6, display: 'flex', alignItems: 'center',
                flexShrink: 0
              }}
            >
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
