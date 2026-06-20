/**
 * SwapSettings.tsx — "Advanced" slippage override for the DEX swap.
 * Hidden by default (auto-slippage handles most cases); power users can pin a bps value.
 */

interface Props {
  open: boolean
  onToggle: () => void
  slippageBps: number
  autoBps: number
  isAuto: boolean
  onSet: (bps: number | null) => void   // null = back to auto
}

const PRESETS = [10, 50, 100, 300]   // 0.1% · 0.5% · 1% · 3%

export function SwapSettings({ open, onToggle, slippageBps, autoBps, isAuto, onSet }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', fontSize: 12 }}>
        <span>Slippage: {isAuto ? `Auto (${(autoBps / 100).toFixed(2)}%)` : `${(slippageBps / 100).toFixed(2)}%`}</span>
        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{open ? 'Hide' : 'Advanced'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onSet(null)}
            style={chip(isAuto)}>Auto</button>
          {PRESETS.map(bps => (
            <button key={bps} type="button" onClick={() => onSet(bps)} style={chip(!isAuto && slippageBps === bps)}>
              {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const chip = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
  background: active ? 'var(--accent-dim)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
})
