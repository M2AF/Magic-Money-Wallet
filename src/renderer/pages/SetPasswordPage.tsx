import { useState } from 'react'

interface Props {
  /** 'create' = new/imported wallet; 'migrate' = securing a pre-password wallet. */
  mode: 'create' | 'migrate'
  onComplete: () => void
}

/**
 * Sets the wallet password. This is the moment the mnemonic is encrypted and
 * written to disk (main-process wallet:set-password) — for a freshly created /
 * imported wallet, or to upgrade a legacy (safeStorage-only) wallet in place.
 */
export function SetPasswordPage({ mode, onComplete }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)

  const submit = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setBusy(true); setError(null)
    try {
      await window.wallet.setPassword(password)
      setPassword(''); setConfirm('')
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page fade-in" style={{ justifyContent: 'center', gap: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
          background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 28px var(--accent-glow)'
        }}>
          <svg width="26" height="26" fill="none" stroke="var(--accent)" strokeWidth="1.5" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="page-title">{mode === 'migrate' ? 'Secure Your Wallet' : 'Set a Password'}</h1>
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          {mode === 'migrate'
            ? 'Add a password to encrypt your existing wallet. You’ll enter it to unlock the app.'
            : 'Your wallet is encrypted with this password. You’ll need it each time you open the app.'}
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <input
          className="input" type="password" autoFocus
          aria-label="New wallet password"
          autoComplete="new-password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null) }}
        />
        <input
          className="input" type="password"
          aria-label="Confirm wallet password"
          autoComplete="new-password"
          placeholder="Confirm password"
          value={confirm}
          onChange={e => { setConfirm(e.target.value); setError(null) }}
        />
        {error && <div style={{ color: 'var(--error)', fontSize: 12, textAlign: 'center' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password || !confirm}>
          {busy ? 'Encrypting…' : 'Encrypt & Continue'}
        </button>
      </form>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        There is no password recovery. If you forget it, restore from your seed phrase.
      </p>
    </div>
  )
}
