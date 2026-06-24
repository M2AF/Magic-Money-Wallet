import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches render-time exceptions anywhere in the tree so a single component
 * failure shows a recoverable message instead of a blank window (B-1). Pairs with
 * the window.wallet bridge guard in App.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[MagicMoney] render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 16 }}>
        <div style={{ fontSize: 38 }}>⚠️</div>
        <h1 className="page-title">Something went wrong</h1>
        <p className="page-subtitle" style={{ maxWidth: 320 }}>
          The wallet hit an unexpected error. Your funds are safe — keys never leave the secure layer.
        </p>
        <pre style={{
          maxWidth: 340, maxHeight: 120, overflow: 'auto', fontSize: 11,
          color: 'var(--text-muted)', background: 'var(--bg-surface)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', textAlign: 'left'
        }}>{this.state.error.message}</pre>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
