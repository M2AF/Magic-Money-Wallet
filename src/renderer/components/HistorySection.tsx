import { useState } from 'react'
import type { ChainHistory } from '../types/wallet'
import { TxList } from './TxList'
import { historyLabel } from '../../shared/history-state'

/**
 * Recent-transaction block under a portfolio card. Keeps three outcomes apart
 * (see shared/history-state.ts), and shows a provider's known gap (`coverage`)
 * so a short list is not read as complete.
 */
export function HistorySection({ history }: { history: ChainHistory | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ height: 1, background: 'var(--border)', marginBottom: 8 }} />
      {history === null ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          Loading history…
        </div>
      ) : history.error ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }} title={history.error}>{historyLabel(history)}</div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)' }}
          >
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            {historyLabel(history)}
          </button>
          {open && (
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
              <TxList records={history.records} />
              {history.coverage && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>{history.coverage}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
