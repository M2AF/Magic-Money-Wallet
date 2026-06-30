import { useState } from 'react'

interface Props {
  onUnlocked: () => void
}

/**
 * Unlock screen shown on launch (and after idle auto-lock) when a
 * password-protected wallet exists but the session isn't unlocked. Calls
 * wallet:unlock in main, which decrypts the mnemonic into main-process memory.
 */
export function UnlockPage({ onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)

  const submit = async () => {
    if (!password) return
    setBusy(true); setError(null)
    try {
      await window.wallet.unlock(password)
      setPassword('')
      onUnlocked()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/incorrect/i.test(msg) ? 'Incorrect password' : msg.replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page fade-in" style={{ justifyContent: 'center', gap: 22 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
          background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 32px var(--accent-glow)'
        }}>
          <svg width="28" height="28" fill="none" stroke="var(--accent)" strokeWidth="1.5" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1" fill="var(--accent)" />
          </svg>
        </div>
        <h1 className="page-title">Welcome Back</h1>
        <p className="page-subtitle" style={{ marginTop: 8 }}>Enter your password to unlock.</p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <input
          className="input" type="password" autoFocus
          aria-label="Wallet password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null) }}
        />
        {error && <div style={{ color: 'var(--error)', fontSize: 12, textAlign: 'center' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
