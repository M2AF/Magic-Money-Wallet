import { useState, useEffect, useCallback } from 'react'
import type { WcSession, WcProposal, WcRequest } from '../types/wallet'

// ── Peer avatar ───────────────────────────────────────────────────────────────

function PeerIcon({ icon, name, size = 40 }: { icon: string | null; name: string; size?: number }) {
  const [imgErr, setImgErr] = useState(false)
  const initial = name.slice(0, 2).toUpperCase()
  if (icon && !imgErr) {
    return (
      <img
        src={icon} alt={name}
        style={{ width: size, height: size, borderRadius: 10, objectFit: 'contain', background: '#fff', flexShrink: 0 }}
        onError={() => setImgErr(true)}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.35, color: 'white'
    }}>{initial}</div>
  )
}

// ── Method badge ──────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  eth_sendTransaction: '#f97316',
  personal_sign: '#6366f1',
  eth_sign: '#6366f1',
  eth_signTypedData_v4: '#8b5cf6',
  eth_signTypedData: '#8b5cf6'
}

function MethodBadge({ method }: { method: string }) {
  const short = method.replace('eth_', '').replace('wallet_', '')
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
      background: `${METHOD_COLORS[method] ?? '#6b7280'}22`,
      color: METHOD_COLORS[method] ?? '#6b7280',
      border: `1px solid ${METHOD_COLORS[method] ?? '#6b7280'}44`
    }}>{short}</span>
  )
}

// ── Session Proposal modal ────────────────────────────────────────────────────

function ProposalModal({
  proposal, onApprove, onReject
}: {
  proposal: WcProposal
  onApprove: () => void
  onReject: () => void
}) {
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const approve = async () => {
    setApproving(true)
    try { await window.wallet.wcApproveSession(proposal.id); onApprove() }
    catch (e) { console.error('[WC] approve failed:', e); setApproving(false) }
  }

  const reject = async () => {
    setRejecting(true)
    try { await window.wallet.wcRejectSession(proposal.id); onReject() }
    catch (e) { console.error('[WC] reject failed:', e); setRejecting(false) }
  }

  const chainNums = [...proposal.requiredChains, ...proposal.optionalChains]
    .map(c => c.split(':')[1]).filter(Boolean)

  return (
    <Overlay>
      <ModalCard>
        <ModalHeader title="Connection Request" />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0 12px' }}>
          <PeerIcon icon={proposal.peerIcon} name={proposal.peerName} size={56} />
          <div style={{ fontWeight: 700, fontSize: 16, textAlign: 'center' }}>{proposal.peerName}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, wordBreak: 'break-all' }}>{proposal.peerUrl}</div>
        </div>

        <div style={{ background: 'var(--bg-dark)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>
            REQUESTING ACCESS TO
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chainNums.slice(0, 8).map(c => (
              <span key={c} style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#6366f122', color: '#818cf8', border: '1px solid #6366f144' }}>
                Chain {c}
              </span>
            ))}
          </div>
          {proposal.requiredMethods.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {proposal.requiredMethods.slice(0, 6).map(m => (
                <MethodBadge key={m} method={m} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={reject} disabled={rejecting} style={secondaryBtnStyle}>
            {rejecting ? '…' : 'Reject'}
          </button>
          <button type="button" onClick={approve} disabled={approving} style={primaryBtnStyle}>
            {approving ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </ModalCard>
    </Overlay>
  )
}

// ── Signing / tx request modal ────────────────────────────────────────────────

function RequestModal({
  request, onApprove, onReject
}: {
  request: WcRequest
  onApprove: () => void
  onReject: () => void
}) {
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const approve = async () => {
    setApproving(true)
    try { await window.wallet.wcApproveRequest(request.id); onApprove() }
    catch (e) { console.error('[WC] req approve failed:', e); setApproving(false) }
  }

  const reject = async () => {
    setRejecting(true)
    try { await window.wallet.wcRejectRequest(request.id); onReject() }
    catch (e) { console.error('[WC] req reject failed:', e); setRejecting(false) }
  }

  const isSend = request.method === 'eth_sendTransaction'
  const chainNum = request.chainId.split(':')[1] ?? '1'

  return (
    <Overlay>
      <ModalCard>
        <ModalHeader title={isSend ? 'Transaction Request' : 'Signature Request'} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0 12px' }}>
          <PeerIcon icon={request.peerIcon} name={request.peerName} size={44} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{request.peerName}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Chain {chainNum}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <MethodBadge method={request.method} />
          </div>
        </div>

        <div style={{
          background: 'var(--bg-dark)', borderRadius: 10, padding: '12px 14px',
          marginBottom: 12, fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word',
          maxHeight: 160, overflowY: 'auto', color: 'var(--text-muted)', fontFamily: 'monospace'
        }}>
          {request.humanReadable}
        </div>

        {isSend && (
          <div style={{ color: '#f97316', fontSize: 11, marginBottom: 12, padding: '6px 10px', background: '#f9731611', borderRadius: 8, border: '1px solid #f9731633' }}>
            ⚠ This will broadcast a transaction. Verify the details before signing.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={reject} disabled={rejecting} style={secondaryBtnStyle}>
            {rejecting ? '…' : 'Reject'}
          </button>
          <button
            type="button" onClick={approve} disabled={approving}
            style={{ ...primaryBtnStyle, background: isSend ? '#f97316' : undefined }}
          >
            {approving ? 'Signing…' : isSend ? 'Send' : 'Sign'}
          </button>
        </div>
      </ModalCard>
    </Overlay>
  )
}

// ── WalletConnect sessions panel (slide-over) ─────────────────────────────────

function SessionsPanel({
  sessions, onClose, onConnect
}: {
  sessions: WcSession[]
  onClose: () => void
  onConnect: () => void
}) {
  const disconnect = async (topic: string) => {
    try { await window.wallet.wcDisconnect(topic) }
    catch (e) { console.error('[WC] disconnect failed:', e) }
  }

  return (
    <Overlay onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
          border: '1px solid var(--border)', maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--border)' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 8px' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            WalletConnect
            {sessions.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: '#6366f122', color: '#818cf8' }}>
                {sessions.length}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* New connection button */}
        <div style={{ padding: '0 16px 12px' }}>
          <button type="button" onClick={onConnect} style={{
            width: '100%', padding: '11px 0', borderRadius: 12,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            border: 'none', color: 'white', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', fontFamily: 'var(--font-body)',
            boxShadow: '0 4px 14px rgba(99,102,241,0.35)'
          }}>
            + New Connection
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
          {sessions.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>
              No active sessions.<br />
              <span style={{ fontSize: 11 }}>Paste a WalletConnect URI to connect.</span>
            </div>
          ) : (
            sessions.map(s => (
              <SessionRow key={s.topic} session={s} onDisconnect={() => disconnect(s.topic)} />
            ))
          )}
        </div>
      </div>
    </Overlay>
  )
}

function SessionRow({ session, onDisconnect }: { session: WcSession; onDisconnect: () => void }) {
  const expiry = new Date(session.expiry * 1000)
  const expires = expiry.toLocaleDateString()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
      borderBottom: '1px solid var(--border)'
    }}>
      <PeerIcon icon={session.peerIcon} name={session.peerName} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session.peerName}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Expires {expires}</div>
      </div>
      <button type="button" onClick={onDisconnect} style={{
        padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'none', color: 'var(--text-muted)', fontSize: 11,
        cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0
      }}>
        Disconnect
      </button>
    </div>
  )
}

// ── Connect (paste URI) modal ─────────────────────────────────────────────────

function ConnectModal({ onClose, onPaired }: { onClose: () => void; onPaired: () => void }) {
  const [uri, setUri] = useState('')
  const [loading, setLoading] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pair = async (value?: string) => {
    const raw = (value ?? uri).trim()
    if (!raw.startsWith('wc:')) {
      setError('Invalid WalletConnect URI — it should start with "wc:"')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await window.wallet.wcPair(raw)
      // pair() returns immediately — proposal arrives via event, show waiting state
      setLoading(false)
      setWaiting(true)
    } catch (e) {
      setError(String(e))
      setLoading(false)
    }
  }

  // Camera QR scan — mobile only (capability-detected, like helloStatus)
  const canScan = typeof window.wallet.scanQr === 'function'
  const scan = async () => {
    setError(null)
    const text = await window.wallet.scanQr!().catch(() => null)
    if (!text) return
    setUri(text)
    pair(text)  // scanned a full URI — connect immediately
  }

  // Auto-close once a proposal arrives (WalletConnectManager will show it)
  useEffect(() => {
    if (!waiting) return
    const onProposal = () => onPaired()
    window.wallet.onWcProposal(onProposal)
    const timeout = setTimeout(() => {
      setWaiting(false)
      setError('No response from dApp — the URI may have expired. Try again.')
    }, 30000)
    return () => {
      window.wallet.offWcProposal(onProposal)
      clearTimeout(timeout)
    }
  }, [waiting, onPaired])

  if (waiting) {
    return (
      <Overlay onClick={onClose}>
        <ModalCard onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Waiting for dApp…</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
              The connection request was sent.<br />
              Approve it in the dApp to continue.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ ...secondaryBtnStyle, width: '100%' }}>
            Cancel
          </button>
        </ModalCard>
      </Overlay>
    )
  }

  return (
    <Overlay onClick={onClose}>
      <ModalCard onClick={e => e.stopPropagation()}>
        <ModalHeader title="New Connection" />
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
          In a dApp, click "WalletConnect" then copy the URI or scan the QR code — paste the full URI below.
        </div>
        <textarea
          value={uri}
          onChange={e => setUri(e.target.value)}
          placeholder="wc:…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-dark)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'monospace',
            resize: 'none', outline: 'none'
          }}
        />
        {error && (
          <div style={{ color: '#ef4444', fontSize: 11, marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
            {error}
          </div>
        )}
        {canScan && (
          <button type="button" onClick={scan} disabled={loading} style={{ ...secondaryBtnStyle, width: '100%', marginTop: 10 }}>
            📷 Scan QR Code
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button type="button" onClick={() => pair()} disabled={loading || !uri.trim()} style={primaryBtnStyle}>
            {loading ? 'Sending…' : 'Connect'}
          </button>
        </div>
      </ModalCard>
    </Overlay>
  )
}

// ── Top-level WalletConnect manager (rendered in App.tsx) ─────────────────────

interface WcManagerProps {
  panelOpen: boolean
  onPanelClose: () => void
  onSessionsChange: (count: number) => void
  onPendingChange: (pending: boolean) => void
}

export function WalletConnectManager({ panelOpen, onPanelClose, onSessionsChange, onPendingChange }: WcManagerProps) {
  const [sessions,    setSessions]    = useState<WcSession[]>([])
  const [proposal,    setProposal]    = useState<WcProposal | null>(null)
  const [request,     setRequest]     = useState<WcRequest | null>(null)
  const [showConnect, setShowConnect] = useState(false)

  const updateSessions = useCallback((s: WcSession[]) => {
    setSessions(s)
    onSessionsChange(s.length)
  }, [onSessionsChange])

  // Load sessions + any pending proposals/requests that arrived while popup was closed
  useEffect(() => {
    window.wallet.wcGetSessions().then(updateSessions).catch(() => {})
    ;(window.wallet as any).wcGetPendingProposals?.().then((ps: WcProposal[]) => {
      if (ps.length > 0) { setProposal(ps[0]); onPendingChange(true) }
    }).catch(() => {})
    ;(window.wallet as any).wcGetPendingRequests?.().then((rs: WcRequest[]) => {
      if (rs.length > 0) { setRequest(rs[0]); onPendingChange(true) }
    }).catch(() => {})
  }, [updateSessions, onPendingChange])

  // Subscribe to push events from main process
  useEffect(() => {
    const onProposal = (p: WcProposal) => { setProposal(p); onPendingChange(true) }
    const onRequest  = (r: WcRequest)  => { setRequest(r);  onPendingChange(true) }
    const onSessions = (s: WcSession[]) => updateSessions(s)

    window.wallet.onWcProposal(onProposal)
    window.wallet.onWcRequest(onRequest)
    window.wallet.onWcSessionsChanged(onSessions)
    return () => {
      window.wallet.offWcProposal(onProposal)
      window.wallet.offWcRequest(onRequest)
      window.wallet.offWcSessionsChanged(onSessions)
    }
  }, [updateSessions, onPendingChange])

  return (
    <>
      {proposal && (
        <ProposalModal
          proposal={proposal}
          onApprove={() => {
            setProposal(null)
            onPendingChange(false)
            window.wallet.wcGetSessions().then(updateSessions).catch(() => {})
          }}
          onReject={() => { setProposal(null); onPendingChange(false) }}
        />
      )}
      {request && !proposal && (
        <RequestModal
          request={request}
          onApprove={() => { setRequest(null); onPendingChange(false) }}
          onReject={() => { setRequest(null); onPendingChange(false) }}
        />
      )}
      {panelOpen && !proposal && !request && (
        <SessionsPanel
          sessions={sessions}
          onClose={onPanelClose}
          onConnect={() => { onPanelClose(); setShowConnect(true) }}
        />
      )}
      {showConnect && (
        <ConnectModal
          onClose={() => setShowConnect(false)}
          onPaired={() => setShowConnect(false)}
        />
      )}
    </>
  )
}

// ── Titlebar button (exported so App.tsx can render it in the titlebar) ───────

export function WcTitlebarBtn({
  active, pending, onClick
}: {
  active: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="WalletConnect"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px',
        borderRadius: 8, position: 'relative',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        transition: 'color 0.15s'
      }}
    >
      {/* WC logo */}
      <svg width="18" height="12" viewBox="0 0 480 360" fill="none">
        <path d="M98.3,120.1 C182.3,37.4 325.7,37.4 409.7,120.1 L419.8,130 C430.1,140.2 430.1,156.5 419.8,166.7 L387.9,198.2 C382.7,203.3 374.1,203.3 369,198.2 L355.1,184.5 C299.1,129.4 180.9,129.4 124.9,184.5 L110,198.2 C104.9,203.3 96.3,203.3 91.1,198.2 L60.2,166.7 C49.9,156.5 49.9,140.2 60.2,130 L98.3,120.1 Z" fill="currentColor" opacity="0.9"/>
        <path d="M183.5,204.7 C222.6,166 278.5,166 317.6,204.7 L323.9,210.9 C334.2,221.1 334.2,237.4 323.9,247.6 L292.6,278.5 C287.5,283.6 278.9,283.6 273.7,278.5 L263.4,268.4 C247.3,252.5 232.7,252.5 216.6,268.4 L206.3,278.5 C201.1,283.6 192.5,283.6 187.4,278.5 L156.1,247.6 C145.8,237.4 145.8,221.1 156.1,210.9 L183.5,204.7 Z" fill="currentColor"/>
      </svg>
      {pending && (
        <span style={{
          position: 'absolute', top: 2, right: 4,
          width: 7, height: 7, borderRadius: '50%',
          background: '#f97316', border: '1.5px solid var(--bg-dark)',
          boxShadow: '0 0 6px #f97316'
        }} />
      )}
    </button>
  )
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

function Overlay({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      {children}
    </div>
  )
}

function ModalCard({ children, onClick }: { children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)',
        width: 320, padding: '16px 18px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)'
      }}
    >
      {children}
    </div>
  )
}

function ModalHeader({ title }: { title: string }) {
  return (
    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, textAlign: 'center' }}>
      {title}
    </div>
  )
}

const primaryBtnStyle: React.CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  fontFamily: 'var(--font-body)', boxShadow: '0 4px 12px rgba(99,102,241,0.3)'
}

const secondaryBtnStyle: React.CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 10,
  border: '1px solid var(--border)', background: 'none',
  color: 'var(--text-muted)', fontWeight: 600, fontSize: 13,
  cursor: 'pointer', fontFamily: 'var(--font-body)'
}

// Hook for external usage
export function useWcPendingCount(): number {
  const [count, setCount] = useState(0)
  const update = useCallback(async () => {
    const sessions = await window.wallet.wcGetSessions().catch(() => [])
    setCount(sessions.length)
  }, [])
  useEffect(() => { update() }, [update])
  return count
}
