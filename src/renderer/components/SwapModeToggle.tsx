/**
 * SwapModeToggle.tsx — two-segment control switching the Swap page between the
 * on-chain DEX aggregator and the off-chain SimpleSwap cross-chain exchange.
 *
 * Sits flush under the swap widget. Switching modes is the caller's cue to reset
 * all field state (amount, quote, addresses) — see SwapPage.
 */

import type { SwapMode } from '../types/swap'

interface Props {
  mode: SwapMode
  onChange: (mode: SwapMode) => void
  /** Optional one-line hint shown above the toggle (e.g. "BTC requires Cross-Chain routing"). */
  notice?: string | null
}

const seg = (active: boolean): React.CSSProperties => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  border: 'none',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#0d0d0d' : 'var(--text-muted)',
  transition: 'background 0.15s, color 0.15s',
})

export function SwapModeToggle({ mode, onChange, notice }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {notice && (
        <div style={{ fontSize: 11, color: 'var(--accent)', textAlign: 'center' }}>{notice}</div>
      )}
      <div style={{
        display: 'flex',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
      }}>
        <button type="button" style={seg(mode === 'dex')} onClick={() => onChange('dex')} aria-pressed={mode === 'dex'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          DEX Swap
        </button>
        <button type="button" style={seg(mode === 'crosschain')} onClick={() => onChange('crosschain')} aria-pressed={mode === 'crosschain'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          Cross-Chain
        </button>
      </div>
    </div>
  )
}
