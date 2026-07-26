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

import { useState, useEffect, useRef } from 'react'
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

  // Biometric unlock — the shared UnlockPage (which has the Windows Hello /
  // Touch ID button) is Electron's flow; THIS lock screen is what Android
  // shows, so it needs its own biometric affordance. Auto-prompts once per
  // lock; the password form always remains as the recovery path.
  const [bioReady, setBioReady] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const bioAutoTried = useRef(false)

  // dApp approval requests (in-app browser pages, routed via dapp-glue)
  const [connRequest, setConnRequest] = useState<ConnRequest | null>(null)
  const [txRequest, setTxRequest] = useState<TxApprovalRequest | null>(null)
  const [signRequest, setSignRequest] = useState<SignApprovalRequest | null>(null)
  const [connAddress, setConnAddress] = useState<string>('')

  // Web link handed to us by another app (MagicMoney set as the default browser).
  // Held here until `page === 'app'`, because the in-app browser renders inside
  // this WebView and has nowhere to go while the lock screen is up.
  const [pendingLink, setPendingLink] = useState<string | null>(null)

  useEffect(() => {
    async function check() {
      const exists = await window.wallet.isSetup?.() ?? false
      if (!exists) { setPage('app'); return }
      const unlocked = await window.wallet.isUnlocked?.() ?? false
      setPage(unlocked ? 'app' : 'locked')
    }
    check().catch(() => setPage('app'))
  }, [])

  // Biometric availability + one auto-prompt whenever the lock screen appears
  useEffect(() => {
    if (page !== 'locked') { bioAutoTried.current = false; return }
    let alive = true
    window.wallet.helloStatus?.()
      .then(s => {
        if (!alive) return
        const ready = s.supported && s.enrolled
        setBioReady(ready)
        if (ready && !bioAutoTried.current) {
          bioAutoTried.current = true
          // Small delay so the prompt doesn't race the activity/keyboard focus
          setTimeout(() => { if (alive) doBioUnlock() }, 350)
        }
      })
      .catch(() => setBioReady(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

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
    // Only re-show the native WebViews if the browser is actually the visible
    // view — otherwise a passing approval would un-hide a browser the user had
    // tucked away behind the wallet (persistent-tabs hide state).
    else if (browserUiState.open) DappBrowser.show().catch(() => {})
  }, [approvalPending])

  // Deep links (intent-filters in AndroidManifest):
  //   wc:…        → WalletConnect pairing; the proposal modal arrives via wc:proposal.
  //   http(s)://… → another app handed us a web link because MagicMoney is the
  //                 default browser. It opens as a NEW tab so an existing browsing
  //                 session is preserved.
  //
  // The browser lives inside this WebView (unlike Electron, where it's its own
  // window), so a link that lands while the wallet is locked has nowhere to
  // render — hold it and replay it after unlock rather than dropping it.
  useEffect(() => {
    const handleUrl = (url: string | null | undefined) => {
      if (!url) return
      if (url.startsWith('wc:')) {
        window.wallet.wcPair(url).catch(e => console.error('[WC] deep-link pair failed:', e))
      } else if (/^https?:\/\//i.test(url)) {
        setPendingLink(url)   // delivered by the effect below, once unlocked
      }
    }
    const sub = CapacitorApp.addListener('appUrlOpen', ({ url }) => handleUrl(url))
    // Cold start: the launch intent predates this listener, so read it directly.
    // Mount-only, so a later warm-start link can't be replayed from here twice.
    CapacitorApp.getLaunchUrl().then(r => handleUrl(r?.url)).catch(() => {})
    return () => { sub.then(s => s.remove()).catch(() => {}) }
  }, [])

  // Deliver the queued link as soon as the wallet is usable (immediately when it
  // already was). Clearing first keeps a re-render from opening a second tab.
  useEffect(() => {
    if (page !== 'app' || !pendingLink) return
    setPendingLink(null)
    window.wallet.openBrowserInNewTab?.(pendingLink)
  }, [page, pendingLink])

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
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
          {bioReady ? 'Unlock with your fingerprint or password' : 'Enter your password to unlock'}
        </div>
        {bioReady && (
          <button type="button" onClick={doBioUnlock} disabled={bioBusy || loading} style={btnStyle}>
            {bioBusy ? 'Waiting for biometrics…' : '👆 Unlock with Biometrics'}
          </button>
        )}
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

  async function doBioUnlock() {
    setBioBusy(true)
    setPwError('')
    try {
      await window.wallet.helloUnlock?.()
      setPage('app')
    } catch {
      // Cancelled or failed — stay on the lock screen quietly; the password
      // form is the recovery path (mirrors UnlockPage's behavior).
    } finally {
      setBioBusy(false)
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
