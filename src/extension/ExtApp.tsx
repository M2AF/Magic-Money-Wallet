/**
 * ExtApp.tsx — Extension popup App wrapper
 *
 * Wraps the main App with extension-specific states:
 *  - 'locked'      → wallet exists but session cleared (browser restarted)
 *  - 'setpassword' → wallet just created/imported, needs a password before going live
 *
 * Reuses all existing pages (DashboardPage, MarketPage, etc.) unchanged.
 */

import { useState, useEffect } from 'react'
import { App } from '../renderer/App'

type ExtPage = 'checking' | 'locked' | 'setpassword' | 'app'

export function ExtApp() {
  const [page, setPage] = useState<ExtPage>('checking')
  const [pwError, setPwError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function check() {
      const exists = await (window.wallet as any).isSetup?.() ?? false
      if (!exists) { setPage('app'); return }
      const unlocked = await (window.wallet as any).isUnlocked?.() ?? false
      setPage(unlocked ? 'app' : 'locked')
    }
    check().catch(() => setPage('app'))
  }, [])

  // Called by App when wallet creation/import finishes — extension needs password
  useEffect(() => {
    const original = window.wallet.confirmBackup.bind(window.wallet)
    // Intercept confirmBackup to redirect to setpassword after addresses derived
    ;(window.wallet as any)._extConfirmBackup = async () => {
      const result = await original()
      setPage('setpassword')
      return result
    }
    const originalImport = window.wallet.import.bind(window.wallet)
    ;(window.wallet as any)._extImport = async (m: string) => {
      const result = await originalImport(m)
      setPage('setpassword')
      return result
    }
    return () => {
      delete (window.wallet as any)._extConfirmBackup
      delete (window.wallet as any)._extImport
    }
  }, [])

  if (page === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d0d', color: '#888', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  if (page === 'locked') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d0d', padding: 32, gap: 16 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>MagicMoney Wallet</div>
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>Enter your password to unlock</div>
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setPwError('') }}
          onKeyDown={e => e.key === 'Enter' && doUnlock()}
          placeholder="Password"
          autoFocus
          style={inputStyle}
        />
        {pwError && <div style={{ color: '#ef4444', fontSize: 12 }}>{pwError}</div>}
        <button onClick={doUnlock} disabled={!password || loading} style={btnStyle}>
          {loading ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    )
  }

  if (page === 'setpassword') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d0d', padding: 32, gap: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 4 }}>🔐</div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Set a Password</div>
        <div style={{ color: '#888', fontSize: 12, textAlign: 'center', lineHeight: 1.5, marginBottom: 4 }}>
          Your wallet is encrypted with this password.<br />
          You'll need it every time you open a new browser session.
        </div>
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setPwError('') }}
          placeholder="Password (min 8 characters)"
          style={inputStyle}
        />
        <input
          type="password"
          value={confirmPw}
          onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
          onKeyDown={e => e.key === 'Enter' && doSetPassword()}
          placeholder="Confirm password"
          style={inputStyle}
        />
        {pwError && <div style={{ color: '#ef4444', fontSize: 12 }}>{pwError}</div>}
        <button onClick={doSetPassword} disabled={!password || loading} style={btnStyle}>
          {loading ? 'Encrypting…' : 'Encrypt & Continue'}
        </button>
      </div>
    )
  }

  return <App />

  async function doUnlock() {
    if (!password) return
    setLoading(true)
    try {
      await (window.wallet as any).unlock(password)
      setPage('app')
    } catch (e) {
      setPwError(String(e).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setPassword('')
    }
  }

  async function doSetPassword() {
    if (!password) return
    if (password.length < 8) { setPwError('Password must be at least 8 characters'); return }
    if (password !== confirmPw) { setPwError('Passwords do not match'); return }
    setLoading(true)
    try {
      await (window.wallet as any).setPassword(password)
      setPage('app')
    } catch (e) {
      setPwError(String(e).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setPassword('')
      setConfirmPw('')
    }
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10,
  border: '1px solid #2a2a2a', background: '#1a1a1a',
  color: '#fff', fontSize: 14, outline: 'none'
}

const btnStyle: React.CSSProperties = {
  width: '100%', padding: '12px', borderRadius: 12,
  background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
  color: '#fff', fontWeight: 700, fontSize: 15,
  border: 'none', cursor: 'pointer', marginTop: 4
}
