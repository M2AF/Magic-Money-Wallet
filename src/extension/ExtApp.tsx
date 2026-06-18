/**
 * ExtApp.tsx — Extension popup App wrapper
 *
 * Wraps the main App with extension-specific states:
 *  - 'locked'      → wallet exists but session cleared (browser restarted)
 *  - 'setpassword' → wallet just created/imported, needs a password before going live
 *
 * Also handles dApp connection approval as a full-screen overlay so any
 * page the user is on gets interrupted safely when a site requests connection.
 *
 * Reuses all existing pages (DashboardPage, MarketPage, etc.) unchanged.
 */

import { useState, useEffect } from 'react'
import { App } from '../renderer/App'

type ExtPage = 'checking' | 'locked' | 'setpassword' | 'app'

type ConnRequest = { id: string; origin: string }

export function ExtApp() {
  const [page, setPage] = useState<ExtPage>('checking')
  const [pwError, setPwError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)

  // dApp connection request (null = none pending)
  const [connRequest, setConnRequest] = useState<ConnRequest | null>(null)
  const [connAddress, setConnAddress] = useState<string>('')

  useEffect(() => {
    async function check() {
      const exists = await (window.wallet as any).isSetup?.() ?? false
      if (!exists) { setPage('app'); return }
      const unlocked = await (window.wallet as any).isUnlocked?.() ?? false
      setPage(unlocked ? 'app' : 'locked')
    }
    check().catch(() => setPage('app'))
  }, [])

  // Pre-load the wallet address so the approval UI can show it
  useEffect(() => {
    window.wallet.getAddresses?.()
      .then((a: any) => { if (a?.evm) setConnAddress(a.evm) })
      .catch(() => {})
  }, [])

  // Listen for incoming dApp connection requests from the background
  useEffect(() => {
    function handleMsg(msg: { type: string; data: ConnRequest }) {
      if (msg?.type === 'web3:connection-request') {
        setConnRequest(msg.data)
      }
    }
    chrome.runtime.onMessage.addListener(handleMsg)
    // Also check for any pending requests that arrived before the popup opened
    ;(window.wallet as any).web3GetPendingConnections?.()
      .then((reqs: ConnRequest[]) => { if (reqs.length > 0) setConnRequest(reqs[0]) })
      .catch(() => {})
    return () => chrome.runtime.onMessage.removeListener(handleMsg)
  }, [])

  // Replace wallet methods so Create/Import pages route to password setup
  useEffect(() => {
    const origConfirm = window.wallet.confirmBackup
    const origImport  = window.wallet.import

    window.wallet.confirmBackup = async () => {
      const result = await origConfirm.call(window.wallet)
      setPage('setpassword')
      return result
    }

    window.wallet.import = async (m: string) => {
      const result = await origImport.call(window.wallet, m)
      setPage('setpassword')
      return result
    }

    return () => {
      window.wallet.confirmBackup = origConfirm
      window.wallet.import        = origImport
    }
  }, [])

  const isSidePanel = !!(window as any).__SIDE_PANEL__

  // Register the sidebar toggle function so DashboardPage can render the button.
  // Must call chrome APIs directly here — user gesture context is lost over sendMessage.
  useEffect(() => {
    const fn = isSidePanel
      ? () => {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tabId = tabs[0]?.id
            if (tabId == null) return
            ;(chrome.sidePanel as any).setOptions({ tabId, enabled: false })
            setTimeout(() => (chrome.sidePanel as any).setOptions({ tabId, enabled: true }), 700)
          })
        }
      : () => {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const windowId = tabs[0]?.windowId
            if (windowId == null) return
            ;(chrome.sidePanel as any).open({ windowId })
              .then(() => window.close())
              .catch((e: Error) => console.error('[SidePanel] open failed:', e))
          })
        }
    ;(window as any).__EXT_SIDEBAR_FN__ = fn
    return () => { delete (window as any).__EXT_SIDEBAR_FN__ }
  }, [isSidePanel])

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
        <button onClick={doUnlock} disabled={!password || loading} style={btnStyle} type="button">
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
        <button onClick={doSetPassword} disabled={!password || loading} style={btnStyle} type="button">
          {loading ? 'Encrypting…' : 'Encrypt & Continue'}
        </button>
      </div>
    )
  }

  // ── Main app + dApp connection overlay ───────────────────────────────────────

  let hostname = ''
  try { hostname = connRequest ? new URL(connRequest.origin).hostname : '' } catch { hostname = connRequest?.origin ?? '' }

  return (
    <>
      <App />

      {connRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '28px 24px', width: '100%',
            maxWidth: 340, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 16
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🌐</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Connect Wallet</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{hostname}</span>
                {' '}wants to see your wallet address
              </div>
            </div>

            {/* Address preview */}
            {connAddress && (
              <div style={{
                background: '#1a1a1a', borderRadius: 12, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #2a2a2a'
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <div>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 2 }}>YOUR ADDRESS</div>
                  <div style={{ color: '#fff', fontSize: 12, fontFamily: 'monospace' }}>
                    {connAddress.slice(0, 8)}…{connAddress.slice(-6)}
                  </div>
                </div>
              </div>
            )}

            {/* What this allows */}
            <div style={{ color: '#555', fontSize: 11, lineHeight: 1.6, padding: '0 2px' }}>
              This will allow the site to see your address. It cannot move funds without your approval on each transaction.
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                onClick={doRejectConnection}
                style={{ ...rejectBtnStyle, flex: 1 }}
                type="button"
              >
                Reject
              </button>
              <button
                onClick={doApproveConnection}
                style={{ ...btnStyle, flex: 2, marginTop: 0 }}
                type="button"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // ── Handlers ─────────────────────────────────────────────────────────────────

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

  async function doApproveConnection() {
    if (!connRequest) return
    try {
      await (window.wallet as any).web3ApproveConnection(connRequest.id)
    } catch { /* background may have already resolved */ }
    setConnRequest(null)
  }

  async function doRejectConnection() {
    if (!connRequest) return
    try {
      await (window.wallet as any).web3RejectConnection(connRequest.id)
    } catch { /* already gone */ }
    setConnRequest(null)
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

const rejectBtnStyle: React.CSSProperties = {
  padding: '12px', borderRadius: 12,
  background: 'transparent', color: '#888', fontWeight: 600, fontSize: 14,
  border: '1px solid #2a2a2a', cursor: 'pointer'
}
