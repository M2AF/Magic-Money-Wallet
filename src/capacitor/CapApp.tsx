/**
 * CapApp.tsx — Android/Capacitor App wrapper
 *
 * The Android counterpart of ExtApp.tsx:
 *  - 'locked'      → wallet exists but the in-memory session is gone (app was
 *                    killed/restarted) or the 15-minute auto-lock expired
 *  - 'setpassword' → wallet just created/imported, needs a password
 *
 * Adds Android lifecycle handling: hardware back button, and a lock re-check
 * whenever the app returns to the foreground (the WebView may have been frozen
 * long past the auto-lock window without any JS running).
 *
 * Reuses all existing pages (DashboardPage, MarketPage, etc.) unchanged.
 * dApp approval overlays arrive in Phase 3 with the in-app browser.
 */

import { useState, useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { App } from '../renderer/App'
import {
  ApprovalOverlays,
  type ConnRequest, type TxApprovalRequest, type SignApprovalRequest,
} from '../renderer/components/ApprovalOverlays'
import { BrowserOverlay, browserUiState } from './BrowserOverlay'
import { DappBrowser } from './dapp-browser'
import { onUiEvent, offUiEvent, emitUiEvent } from './platform-capacitor'

type CapPage = 'checking' | 'locked' | 'setpassword' | 'app'

export function CapApp() {
  const [page, setPage] = useState<CapPage>('checking')
  const [pwError, setPwError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)

  // dApp approval requests (in-app browser pages, routed via dapp-glue)
  const [connRequest, setConnRequest] = useState<ConnRequest | null>(null)
  const [txRequest, setTxRequest] = useState<TxApprovalRequest | null>(null)
  const [signRequest, setSignRequest] = useState<SignApprovalRequest | null>(null)
  const [connAddress, setConnAddress] = useState<string>('')

  useEffect(() => {
    async function check() {
      const exists = await window.wallet.isSetup?.() ?? false
      if (!exists) { setPage('app'); return }
      const unlocked = await window.wallet.isUnlocked?.() ?? false
      setPage(unlocked ? 'app' : 'locked')
    }
    check().catch(() => setPage('app'))
  }, [])

  // Auto-lock push from capacitor-store (sliding session window expired)
  useEffect(() => {
    const onLocked = () => {
      window.wallet.isSetup?.().then((exists: boolean) => {
        if (exists) setPage(p => (p === 'app' ? 'locked' : p))
      }).catch(() => {})
    }
    ;(window.wallet as any).onLocked?.(onLocked)
    return () => (window.wallet as any).offLocked?.(onLocked)
  }, [])

  // Foreground resume — re-check the lock state. Android can freeze the WebView
  // for hours; the passive timestamp only expires on the next mnemonic read, so
  // force the check when the user comes back.
  useEffect(() => {
    const sub = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      window.wallet.isSetup?.().then(async (exists: boolean) => {
        if (!exists) return
        const unlocked = await window.wallet.isUnlocked?.() ?? false
        if (!unlocked) setPage(p => (p === 'app' ? 'locked' : p))
      }).catch(() => {})
    })
    return () => { sub.then(s => s.remove()).catch(() => {}) }
  }, [])

  // Hardware back button: browser history first, then close the browser,
  // otherwise background the app (never exit-crash the wallet).
  useEffect(() => {
    const sub = CapacitorApp.addListener('backButton', () => {
      if (browserUiState.open) emitUiEvent('cap:browser:back', null)
      else CapacitorApp.minimizeApp().catch(() => {})
    })
    return () => { sub.then(s => s.remove()).catch(() => {}) }
  }, [])

  // dApp approval requests arrive on the in-process bus (dapp-glue → shared
  // handler → platform requestApproval). Hydrate any queued ones on mount.
  useEffect(() => {
    const onConn = (d: unknown) => setConnRequest(d as ConnRequest)
    const onTx   = (d: unknown) => setTxRequest(d as TxApprovalRequest)
    const onSign = (d: unknown) => setSignRequest(d as SignApprovalRequest)
    onUiEvent('web3:connection-request', onConn)
    onUiEvent('web3:tx-request', onTx)
    onUiEvent('web3:sign-request', onSign)
    ;(window.wallet as any).web3GetPendingConnections?.()
      .then((reqs: ConnRequest[]) => { if (reqs.length > 0) setConnRequest(reqs[0]) }).catch(() => {})
    ;(window.wallet as any).web3GetPendingTx?.()
      .then((reqs: TxApprovalRequest[]) => { if (reqs.length > 0) setTxRequest(reqs[0]) }).catch(() => {})
    ;(window.wallet as any).web3GetPendingSign?.()
      .then((reqs: SignApprovalRequest[]) => { if (reqs.length > 0) setSignRequest(reqs[0]) }).catch(() => {})
    return () => {
      offUiEvent('web3:connection-request', onConn)
      offUiEvent('web3:tx-request', onTx)
      offUiEvent('web3:sign-request', onSign)
    }
  }, [])

  // Pre-load the wallet address for the connect-approval preview
  useEffect(() => {
    window.wallet.getAddresses?.()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((a: any) => { if (a?.evm) setConnAddress(a.evm) })
      .catch(() => {})
  }, [])

  // Native dApp WebViews sit ON TOP of this WebView — hide them while an
  // approval overlay is pending so the user can see and tap it.
  const approvalPending = !!(connRequest || txRequest || signRequest)
  useEffect(() => {
    if (approvalPending) DappBrowser.hide().catch(() => {})
    else DappBrowser.show().catch(() => {})
  }, [approvalPending])

  // Deep links: wc: URIs (intent-filter in AndroidManifest) → WalletConnect
  // pairing. The proposal modal then arrives via the wc:proposal push.
  useEffect(() => {
    const sub = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (url?.startsWith('wc:')) {
        window.wallet.wcPair(url).catch(e => console.error('[WC] deep-link pair failed:', e))
      }
    })
    return () => { sub.then(s => s.remove()).catch(() => {}) }
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
        <form onSubmit={(e) => { e.preventDefault(); doUnlock() }} style={{ display: 'contents' }}>
          <input
            type="password"
            aria-label="Wallet password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setPwError('') }}
            placeholder="Password"
            autoFocus
            style={inputStyle}
          />
          {pwError && <div style={{ color: '#ef4444', fontSize: 12 }}>{pwError}</div>}
          <button disabled={!password || loading} style={btnStyle} type="submit">
            {loading ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
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
          You'll need it every time you reopen the app.
        </div>
        <form onSubmit={(e) => { e.preventDefault(); doSetPassword() }} style={{ display: 'contents' }}>
          <input
            type="password"
            aria-label="New wallet password"
            autoComplete="new-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setPwError('') }}
            placeholder="Password (min 8 characters)"
            style={inputStyle}
          />
          <input
            type="password"
            aria-label="Confirm wallet password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
            placeholder="Confirm password"
            style={inputStyle}
          />
          {pwError && <div style={{ color: '#ef4444', fontSize: 12 }}>{pwError}</div>}
          <button disabled={!password || loading} style={btnStyle} type="submit">
            {loading ? 'Encrypting…' : 'Encrypt & Continue'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <>
      <App />
      <BrowserOverlay />
      <ApprovalOverlays
        connRequest={connRequest}
        txRequest={txRequest}
        signRequest={signRequest}
        connAddress={connAddress}
        onApproveConnection={() => { approve('web3ApproveConnection', connRequest?.id); setConnRequest(null) }}
        onRejectConnection={() => { approve('web3RejectConnection', connRequest?.id); setConnRequest(null) }}
        onApproveTx={() => { approveTx(true) }}
        onRejectTx={() => { approveTx(false) }}
        onApproveSign={() => { approve('web3ApproveSign', signRequest?.id); setSignRequest(null) }}
        onRejectSign={() => { approve('web3RejectSign', signRequest?.id); setSignRequest(null) }}
      />
    </>
  )

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function approve(method: string, id?: string) {
    if (!id) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.wallet as any)[method]?.(id).catch(() => { /* already resolved */ })
  }

  function approveTx(ok: boolean) {
    const req = txRequest
    setTxRequest(null)
    if (!req) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window.wallet as any
    if (ok) w.web3ApproveTx?.(req.id, req.chainId).catch(() => {})
    else w.web3RejectTx?.(req.id).catch(() => {})
  }

  async function doUnlock() {
    if (!password) return
    setLoading(true)
    try {
      await window.wallet.unlock(password)
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
      await window.wallet.setPassword(password)
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
