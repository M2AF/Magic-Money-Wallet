import { useState, useEffect } from 'react'

interface Props {
  onUnlocked: () => void
}

/**
 * Unlock screen shown on launch (and after idle auto-lock) when a
 * password-protected wallet exists but the session isn't unlocked. Calls
 * wallet:unlock in main, which decrypts the mnemonic into main-process memory.
 *
 * If Windows Hello unlock is enrolled (optional, set up in Settings), a Hello
 * button is offered as a convenience — the password remains the recovery path.
 */
export function UnlockPage({ onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [helloOn, setHelloOn]   = useState(false)
  const [helloBusy, setHelloBusy] = useState(false)

  // Offer the Hello button only when this wallet is enrolled AND Hello is still
  // set up on the OS. Optional-chained for the extension bridge (no helloStatus).
  useEffect(() => {
    let alive = true
    window.wallet.helloStatus?.()
      .then(s => { if (alive) setHelloOn(s.enrolled && s.supported) })
      .catch(() => { /* leave the button hidden */ })
    return () => { alive = false }
  }, [])

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

  const unlockWithHello = async () => {
    setHelloBusy(true); setError(null)
    try {
      await window.wallet.helloUnlock?.()
      onUnlocked()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Cancel is a normal, quiet outcome — don't shout about it.
      if (!/cancel/i.test(msg)) setError(msg.replace(/^Error:\s*/, ''))
      // Enrollment may have self-healed away (e.g. a lost TPM key) — re-check so
      // the Hello button hides itself and the user just uses their password.
      window.wallet.helloStatus?.()
        .then(s => setHelloOn(s.enrolled && s.supported))
        .catch(() => { /* leave as-is */ })
    } finally {
      setHelloBusy(false)
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
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          {helloOn ? 'Unlock with Windows Hello or your password.' : 'Enter your password to unlock.'}
        </p>
      </div>

      {helloOn && (
        <button type="button" className="btn btn-primary" disabled={helloBusy || busy}
          onClick={unlockWithHello} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <path d="M12 2a5 5 0 0 0-5 5v3" /><rect x="4" y="10" width="16" height="11" rx="2" />
            <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          {helloBusy ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
        </button>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <input
          className="input" type="password" autoFocus={!helloOn}
          aria-label="Wallet password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null) }}
        />
        {error && <div style={{ color: 'var(--error)', fontSize: 12, textAlign: 'center' }}>{error}</div>}
        <button type="submit" className={helloOn ? 'btn' : 'btn btn-primary'} disabled={busy || helloBusy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
