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
type TxRequest = { id: string; origin?: string; chainId?: string; from?: string; to?: string; value?: string; data?: string }
type SignRequest = { id: string; origin: string; chain: string; method: string; summary: string; details?: string }

export function ExtApp() {
  const [page, setPage] = useState<ExtPage>('checking')
  const [pwError, setPwError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)

  // dApp connection request (null = none pending)
  const [connRequest, setConnRequest] = useState<ConnRequest | null>(null)
  const [txRequest, setTxRequest] = useState<TxRequest | null>(null)
  const [signRequest, setSignRequest] = useState<SignRequest | null>(null)
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
    function handleMsg(msg: { type: string; data: ConnRequest | TxRequest | SignRequest }) {
      if (msg?.type === 'web3:connection-request') {
        setConnRequest(msg.data as ConnRequest)
      } else if (msg?.type === 'web3:tx-request') {
        setTxRequest(msg.data as TxRequest)
      } else if (msg?.type === 'web3:sign-request') {
        setSignRequest(msg.data as SignRequest)
      }
    }
    chrome.runtime.onMessage.addListener(handleMsg)
    // Also check for any pending requests that arrived before the popup opened
    ;(window.wallet as any).web3GetPendingConnections?.()
      .then((reqs: ConnRequest[]) => { if (reqs.length > 0) setConnRequest(reqs[0]) })
      .catch(() => {})
    ;(window.wallet as any).web3GetPendingTx?.()
      .then((reqs: TxRequest[]) => { if (reqs.length > 0) setTxRequest(reqs[0]) })
      .catch(() => {})
    ;(window.wallet as any).web3GetPendingSign?.()
      .then((reqs: SignRequest[]) => { if (reqs.length > 0) setSignRequest(reqs[0]) })
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
          You'll need it every time you open a new browser session.
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

  // ── Main app + dApp connection overlay ───────────────────────────────────────

  let hostname = ''
  try { hostname = connRequest ? new URL(connRequest.origin).hostname : '' } catch { hostname = connRequest?.origin ?? '' }
  let txHostname = ''
  try { txHostname = txRequest?.origin ? new URL(txRequest.origin).hostname : '' } catch { txHostname = txRequest?.origin ?? '' }
  let signHostname = ''
  try { signHostname = signRequest?.origin ? new URL(signRequest.origin).hostname : '' } catch { signHostname = signRequest?.origin ?? '' }
  const txNativeValue = txRequest?.value ? formatWei(txRequest.value) : '0'

  return (
    <>
      <App />

      {txRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100000,
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '26px 22px', width: '100%',
            maxWidth: 360, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 14
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✍</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Transaction</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{txHostname || 'Connected site'}</span>
                {' '}wants to send a transaction
              </div>
            </div>

            <div style={detailBoxStyle}>
              <DetailRow label="Chain" value={txRequest.chainId ?? 'current'} />
              <DetailRow label="To" value={shorten(txRequest.to)} mono />
              <DetailRow label="Value" value={`${txNativeValue} native`} />
              {txRequest.data && txRequest.data !== '0x' && <DetailRow label="Data" value={`${txRequest.data.slice(0, 18)}…${txRequest.data.slice(-8)}`} mono />}
            </div>

            <div style={{ color: '#777', fontSize: 11, lineHeight: 1.55 }}>
              Only approve if you trust this site and recognize the transaction.
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={doRejectTx} style={{ ...rejectBtnStyle, flex: 1 }} type="button">Reject</button>
              <button onClick={doApproveTx} style={{ ...btnStyle, flex: 2, marginTop: 0 }} type="button">Approve</button>
            </div>
          </div>
        </div>
      )}

      {signRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100001,
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '26px 22px', width: '100%',
            maxWidth: 360, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 14
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✎</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Signature</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{signHostname || 'Connected site'}</span>
                {' '}wants your signature
              </div>
            </div>

            <div style={detailBoxStyle}>
              <DetailRow label="Chain" value={signRequest.chain} />
              <DetailRow label="Method" value={signRequest.method} mono />
              <DetailRow label="Request" value={signRequest.summary} />
              {signRequest.details && <DetailRow label="Details" value={signRequest.details} mono />}
            </div>

            <div style={{ color: '#777', fontSize: 11, lineHeight: 1.55 }}>
              Signatures can grant permissions or authorize off-chain actions. Approve only if you understand this request.
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={doRejectSign} style={{ ...rejectBtnStyle, flex: 1 }} type="button">Reject</button>
              <button onClick={doApproveSign} style={{ ...btnStyle, flex: 2, marginTop: 0 }} type="button">Sign</button>
            </div>
          </div>
        </div>
      )}

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

  async function doApproveTx() {
    if (!txRequest) return
    try {
      await (window.wallet as any).web3ApproveTx(txRequest.id, txRequest.chainId)
    } catch { /* background may have already resolved */ }
    setTxRequest(null)
  }

  async function doRejectTx() {
    if (!txRequest) return
    try {
      await (window.wallet as any).web3RejectTx(txRequest.id)
    } catch { /* already gone */ }
    setTxRequest(null)
  }

  async function doApproveSign() {
    if (!signRequest) return
    try {
      await (window.wallet as any).web3ApproveSign(signRequest.id)
    } catch { /* background may have already resolved */ }
    setSignRequest(null)
  }

  async function doRejectSign() {
    if (!signRequest) return
    try {
      await (window.wallet as any).web3RejectSign(signRequest.id)
    } catch { /* already gone */ }
    setSignRequest(null)
  }
}

function shorten(value?: string): string {
  if (!value) return '-'
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

function formatWei(value: string): string {
  try {
    const wei = BigInt(value)
    const whole = wei / 1_000_000_000_000_000_000n
    const frac = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : whole.toString()
  } catch {
    return value
  }
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, alignItems: 'start' }}>
      <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: 12, fontFamily: mono ? 'monospace' : undefined, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
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

const detailBoxStyle: React.CSSProperties = {
  background: '#1a1a1a',
  borderRadius: 12,
  padding: '12px 14px',
  border: '1px solid #2a2a2a',
  display: 'flex',
  flexDirection: 'column',
  gap: 8
}
