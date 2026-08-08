/**
 * PasskeyApproval.tsx — Android passkey approval overlay
 *
 * The Android counterpart of Electron's branded approval window. Same three
 * questions: which site, which account, create-vs-sign — plus the chooser when a
 * discoverable sign-in matched several identities.
 *
 * Rendered by CapApp inside the wallet's own WebView. The native dApp WebViews
 * sit ON TOP of that, so CapApp hides them while this is up (see approvalPending
 * there) or the user could never see, let alone tap, the thing they are being
 * asked to approve.
 *
 * ⚠ Everything shown here comes from the ceremony, which took the site from the
 * tab's real URL. Nothing on this screen is page-supplied except the username,
 * which React escapes.
 */

import { useState, useEffect } from 'react'
import { onUiEvent, offUiEvent } from './platform-capacitor'
import { resolvePasskeyApproval, getPendingPasskeyApprovals } from './passkey-provider'
import type { PasskeyApprovalRequest } from '../main/passkey-protocol'

type PendingRequest = PasskeyApprovalRequest & { id: string }

export function PasskeyApproval({ onPendingChange }: { onPendingChange?: (pending: boolean) => void }) {
  const [request, setRequest] = useState<PendingRequest | null>(null)
  const [choiceId, setChoiceId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const onRequest = (d: unknown) => {
      const req = d as PendingRequest
      setRequest(req)
      setChoiceId(req.choices?.[0]?.id)
    }
    onUiEvent('passkey:approval-request', onRequest)
    // A remount (rotation, process restart of the WebView) must not strand a
    // ceremony that is already waiting on an answer.
    const queued = getPendingPasskeyApprovals()
    if (queued.length > 0) onRequest(queued[0])
    return () => offUiEvent('passkey:approval-request', onRequest)
  }, [])

  useEffect(() => { onPendingChange?.(request !== null) }, [request, onPendingChange])

  if (!request) return null

  const isCreate = request.ceremony === 'create'
  const settle = (approved: boolean) => {
    resolvePasskeyApproval(request.id, approved, approved ? choiceId : undefined)
    setRequest(null)
    setChoiceId(undefined)
  }

  return (
    <div style={backdrop} role="dialog" aria-modal="true" aria-label={isCreate ? 'Create a passkey' : 'Sign in with a passkey'}>
      <div style={sheet}>
        <div style={{ fontSize: 30, textAlign: 'center' }}>{isCreate ? '🔑' : '👤'}</div>
        <div style={heading}>
          {request.site} wants to {isCreate ? 'create a passkey' : 'sign you in'}
        </div>

        <div style={panel}>
          <Row label="Site" value={request.site} />
          {!request.choices?.length && (
            <Row label="Wallet" value={`Account ${request.accountIndex + 1}${request.accountAddress ? ` · ${short(request.accountAddress)}` : ''}`} />
          )}
          {request.userName && !request.choices?.length && (
            <Row label={isCreate ? 'Sign up as' : 'Sign in as'} value={request.userName} />
          )}
        </div>

        {request.choices?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ color: '#9aa4b2', fontSize: 12 }}>Choose which account to sign in with</div>
            {request.choices.map(c => (
              <label key={c.id} style={{ ...choiceRow, ...(choiceId === c.id ? choiceRowActive : null) }}>
                <input
                  type="radio"
                  name="mm-passkey-choice"
                  checked={choiceId === c.id}
                  onChange={() => setChoiceId(c.id)}
                  style={{ accentColor: '#2563eb', width: 16, height: 16 }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ color: '#f1f5f9', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                  <span style={{ color: '#9aa4b2', fontSize: 12 }}>{c.sublabel}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {request.replacesExisting && (
          <div style={warn}>
            ⚠ This replaces the passkey you already have for {request.site}. The old one will stop working.
          </div>
        )}

        {isCreate && (
          <div style={{ color: '#9aa4b2', fontSize: 12, lineHeight: 1.5 }}>
            This passkey is derived from your seed phrase. It will work on any device where you
            restore those words — and anyone who has them can sign in as you.
          </div>
        )}

        <button type="button" onClick={() => settle(true)} style={confirmBtn}>
          {isCreate ? 'Create passkey' : 'Sign in'}
        </button>
        <button type="button" onClick={() => settle(false)} style={rejectBtn}>Reject</button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{ color: '#9aa4b2', flex: '0 0 auto' }}>{label}:</span>
      <span style={{ color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

const short = (a: string): string => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 10_000,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
}
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 480, background: '#0b1220', borderTopLeftRadius: 18, borderTopRightRadius: 18,
  border: '1px solid rgba(255,255,255,.08)', padding: 18, paddingBottom: 26,
  display: 'flex', flexDirection: 'column', gap: 12,
}
const heading: React.CSSProperties = { color: '#f8fafc', fontSize: 16, fontWeight: 700, textAlign: 'center' }
const panel: React.CSSProperties = {
  background: '#0f172a', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5,
}
const choiceRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#0f172a',
  border: '1px solid rgba(255,255,255,.10)', borderRadius: 10, cursor: 'pointer',
}
const choiceRowActive: React.CSSProperties = { borderColor: '#2563eb', background: 'rgba(37,99,235,.12)' }
const warn: React.CSSProperties = {
  background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 10,
  padding: '10px 12px', fontSize: 12.5, lineHeight: 1.45, color: '#fcd34d',
}
const confirmBtn: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 0, borderRadius: 12, padding: 13,
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
}
const rejectBtn: React.CSSProperties = {
  background: 'transparent', color: '#9aa4b2', border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer',
}
