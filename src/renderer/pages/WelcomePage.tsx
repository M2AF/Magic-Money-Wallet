import type { AppPage } from '../types/wallet'

interface Props {
  onNavigate: (page: AppPage) => void
}

export function WelcomePage({ onNavigate }: Props) {
  return (
    <div className="page fade-in" style={{ justifyContent: 'center', gap: 28 }}>
      {/* Logo / wordmark */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'var(--accent-dim)',
          border: '1px solid var(--border-active)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 0 32px var(--accent-glow)'
        }}>
          {/* Vault icon */}
          <svg width="28" height="28" fill="none" stroke="var(--accent)" strokeWidth="1.5" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            <circle cx="12" cy="16" r="1" fill="var(--accent)"/>
          </svg>
        </div>
        <h1 className="page-title">MagicMoney Wallet</h1>
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          Self-custody across EVM · Solana · Cardano.<br />
          Your keys. Your coins.
        </p>
      </div>

      {/* Chain badges */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Ethereum', color: '#627EEA' },
          { label: 'Monad',    color: '#627EEA' },
          { label: 'Abstract', color: '#627EEA' },
          { label: 'Solana',   color: '#9945FF' },
          { label: 'Cardano',  color: '#2A7DEA' },
        ].map(c => (
          <span key={c.label} style={{
            padding: '4px 10px',
            background: `${c.color}1a`,
            border: `1px solid ${c.color}33`,
            borderRadius: 99,
            fontSize: 11,
            color: c.color,
            fontWeight: 500
          }}>{c.label}</span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className="btn btn-primary" onClick={() => onNavigate('create')}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Create New Wallet
        </button>
        <button className="btn btn-ghost" onClick={() => onNavigate('import')}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import Existing Wallet
        </button>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        Your seed phrase is encrypted with your OS keychain.<br />
        No data is transmitted to any server.
      </p>
    </div>
  )
}
