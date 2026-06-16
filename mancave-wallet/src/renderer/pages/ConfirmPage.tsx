import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses } from '../types/wallet'

interface Props {
  onNavigate: (page: AppPage) => void
  onComplete: (addresses: WalletAddresses) => void
}

export function ConfirmPage({ onNavigate, onComplete }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setSaving(true)
    setError(null)
    try {
      const addresses = await window.wallet.confirmBackup()
      onComplete(addresses)
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  return (
    <div className="page fade-in" style={{ gap: 20 }}>
      <div>
        <button
          onClick={() => onNavigate('create')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 16 }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <h1 className="page-title">Confirm Backup</h1>
        <p className="page-subtitle">Before we save your wallet, confirm you've stored your seed phrase securely.</p>
      </div>

      {/* Checklist */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          'I wrote down all 12 words in the correct order',
          'I stored my phrase somewhere safe offline',
          'I understand losing my phrase means losing access forever',
          'I understand ManCave never stores or transmits my phrase',
        ].map((item, i) => (
          <label key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            <input type="checkbox" style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }} />
            {item}
          </label>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--error)' }}>
          {error}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleConfirm}
        disabled={saving}
      >
        {saving ? (
          <>
            <div style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTop: '2px solid #000', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Deriving addresses…
          </>
        ) : 'Save Wallet & Continue'}
      </button>
    </div>
  )
}
