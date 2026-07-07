import { useState } from 'react'

interface Props {
  /** 'create' = new/imported wallet; 'migrate' = securing a pre-password wallet. */
  mode: 'create' | 'migrate'
  onComplete: () => void
}

// ── Password strength (audit M-5) ────────────────────────────────────────────
// Lightweight local heuristic — no dependency, no network. Score 0-4 from
// length + character variety, floored to 0 for the most common passwords.
// Weak (0-1) is BLOCKED: this credential is the only thing between a stolen
// laptop and the seed phrase (PBKDF2-600k helps, but not against "password1").

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'welcome1', 'admin123', 'letmein1',
  'dragon123', 'monkey123', 'master123', 'shadow123', 'michael1', 'jennifer',
  'charlie1', 'aa123456', 'abc12345', '11111111', '00000000', 'passw0rd',
])

function passwordScore(pw: string): number {
  if (!pw) return 0
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 0
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/[0-9]/.test(pw)) variety++
  if (/[^a-zA-Z0-9]/.test(pw)) variety++
  // Length is the dominant factor; variety breaks ties.
  if (pw.length < 8) return variety >= 3 ? 1 : 0
  if (pw.length < 10) return Math.min(1 + Math.floor(variety / 2), 2)
  if (pw.length < 14) return Math.min(1 + variety, 3)
  return Math.min(2 + variety, 4)
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
const STRENGTH_COLORS = ['var(--error)', 'var(--error)', '#f59e0b', 'var(--success)', 'var(--success)']

function StrengthMeter({ password }: { password: string }) {
  if (!password) return null
  const score = passwordScore(password)
  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i < score ? STRENGTH_COLORS[score] : 'var(--border)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: STRENGTH_COLORS[score] }}>
        {STRENGTH_LABELS[score]}
        {score <= 1 && password.length >= 8 && ' — add length or mix in symbols/numbers'}
      </div>
    </div>
  )
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
    if (passwordScore(password) <= 1) {
      setError('That password is too weak to protect a wallet — make it longer or mix in symbols/numbers')
      return
    }
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
        <StrengthMeter password={password} />
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
