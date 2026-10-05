import type { TestnetStatusSummary } from '../../shared/xreserve-testnet-wire'
import { xreserveRouteProgress } from '../lib/xreserve-route-progress'

export function XReserveRouteProgress({ status }: { status?: TestnetStatusSummary }) {
  return (
    <ol aria-label="USDC to USDCx route progress" style={{ listStyle: 'none', margin: '6px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {xreserveRouteProgress(status).map(step => (
        <li key={step.label} data-state={step.state} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{step.label}</span>
          <span style={{ color: step.state === 'verified' ? '#22c55e' : step.state === 'review' ? '#fca5a5' : 'var(--text-muted)' }}>
            {step.state === 'verified' ? 'Verified' : step.state === 'review' ? 'Needs review' : 'Not verified'}
          </span>
        </li>
      ))}
    </ol>
  )
}
