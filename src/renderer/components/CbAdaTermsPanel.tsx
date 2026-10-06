/**
 * CbAdaTermsPanel.tsx — the user's review and approval of one Base -> Solana
 * cbADA transfer's exact terms (journey:cbadaReview / journey:cbadaAuthorize).
 *
 * Every term shown is read live by the privileged layer for THIS account: the
 * Base sender, the Solana recipient, the amount, the router's current CCIP fee,
 * and the ceilings the user approves (CCIP fee, approval gas, transfer gas).
 * Approving sends back only the proposal id; nothing here can change a term.
 *
 * Approving STORES the terms. It signs and sends nothing: sending is not
 * enabled in this build. Terms expire quickly and are used once; any change
 * needs a new review.
 */

import { useEffect, useRef, useState } from 'react'
import type { CbAdaTermsReview } from '../../shared/journey-candidate'
import { fmt, ethAmount } from './journey-format'

const eth = ethAmount

/** Tell other views (journeys in progress) that the stored journeys changed. */
export const JOURNEYS_CHANGED = 'mm:journeys-changed'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ flex: '0 0 118px', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  )
}

export function CbAdaTermsPanel({ amountRaw }: { amountRaw: string }) {
  const [review, setReview] = useState<CbAdaTermsReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // A review that returns after the amount changed (or after unmount) answered another question.
  const currentKey = useRef(amountRaw)
  currentKey.current = amountRaw
  useEffect(() => () => { currentKey.current = '\u0000unmounted' }, [])
  useEffect(() => { setReview(null); setError(null); setAgreed(false); setSaved(null); setLoading(false) }, [amountRaw])

  useEffect(() => {
    if (!review || saved) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [review, saved])

  if (!window.wallet.journeyCbAdaReview || !window.wallet.journeyCbAdaAuthorize) return null

  const load = async () => {
    const asked = amountRaw
    setLoading(true); setError(null); setReview(null); setAgreed(false); setSaved(null)
    try {
      const r = await window.wallet.journeyCbAdaReview!(asked)
      if (currentKey.current !== asked) return
      if (r.ok) { setReview(r.value); setNow(Date.now()) } else setError(r.message)
    } catch (e) {
      if (currentKey.current === asked) setError(e instanceof Error ? e.message : 'The transfer terms could not be read.')
    } finally {
      if (currentKey.current === asked) setLoading(false)
    }
  }

  const approve = async () => {
    if (!review) return
    setSaving(true); setError(null)
    try {
      const r = await window.wallet.journeyCbAdaAuthorize!(review.proposalId)
      if (r.ok) {
        setSaved(r.value.journeyId)
        window.dispatchEvent(new Event(JOURNEYS_CHANGED))
      } else {
        // A proposal is used once: a refusal always needs a fresh review.
        setError(r.message); setReview(null); setAgreed(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The terms could not be saved.'); setReview(null); setAgreed(false)
    } finally {
      setSaving(false)
    }
  }

  const expired = !!review && now >= review.expiresAt
  const secondsLeft = review ? Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) : 0
  const blocked = !review || review.problems.length > 0 || expired

  return (
    <div data-testid="cbada-terms" style={{
      border: '1px solid rgba(56,189,248,0.35)', borderRadius: 'var(--radius-sm)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Approve cbADA transfer terms</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Approving saves these exact terms for this account. Sending is not enabled in this build — nothing is signed or sent.
      </div>

      {!review && !saved && (
        <button type="button" onClick={load} disabled={loading}
          style={{ padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Reading live fee, gas and limits…' : 'Review transfer terms'}
        </button>
      )}
      {error && <div style={{ fontSize: 11, color: '#fca5a5' }}>{error}</div>}

      {review && !saved && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Row label="From (Base)">{review.sender} · account {review.accountIndex + 1}</Row>
            <Row label="To (Solana)">{review.recipient} · this account</Row>
            <Row label="Amount">{fmt(review.amountRaw, 6)} cbADA</Row>
            <Row label="Base token">{review.baseToken}</Row>
            <Row label="Solana mint">{review.solanaMint}</Row>
            <Row label="CCIP router">{review.router}</Row>
            <Row label="CCIP fee now">{eth(review.ccipFeeWei)}</Row>
            <Row label="Max CCIP fee">{eth(review.maxCcipFeeWei)}</Row>
            <Row label="Approval">
              {review.needsApproval
                ? <>needed, for exactly {fmt(review.amountRaw, 6)} cbADA · max gas {eth(review.approvalGas.maxWei)}</>
                : <>not needed now (allowance {fmt(review.allowanceRaw, 6)} cbADA) · if needed later, max gas {eth(review.approvalGas.maxWei)}</>}
            </Row>
            <Row label="Max transfer gas">{eth(review.sendGas.maxWei)}</Row>
            <Row label="CCIP + gas cap">
              <b>{eth(review.totalMaxEthWei)}</b>
              <span style={{ color: 'var(--text-muted)' }}> plus Base's L1 data fee (≈{eth(
                review.approvalGas.l1FeeWei !== null && review.sendGas.l1FeeWei !== null
                  ? String((review.needsApproval ? BigInt(review.approvalGas.l1FeeWei) : 0n) + BigInt(review.sendGas.l1FeeWei))
                  : null)}, not capped)</span>
            </Row>
            <Row label="Balances">{fmt(review.cbAdaBalanceRaw, 6)} cbADA · {eth(review.ethBalanceWei)}</Row>
            <Row label="Lane capacity now">
              {review.outboundRateLimit
                ? <>{fmt(review.outboundRateLimit.availableRaw, 6)} cbADA available{review.outboundRateLimit.enabled ? '' : ' (limit off)'} — read again before any send</>
                : 'unknown'}
            </Row>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Maximums are ceilings, not expected costs. A higher fee or gas price at sending time stops the transfer and needs a new approval.
          </div>
          {review.problems.length > 0 && (
            <div data-testid="cbada-terms-problems" style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.45 }}>
              {review.problems.map(p => <div key={p}>• {p}</div>)}
            </div>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, color: 'var(--text-primary)', cursor: blocked ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={agreed} disabled={blocked} onChange={e => setAgreed(e.target.checked)} />
            I approve these exact terms. Any change needs a new approval.
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={approve} disabled={blocked || !agreed || saving}
              style={{ padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                background: blocked || !agreed ? 'var(--border)' : '#0ea5e9', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: blocked || !agreed || saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Approve terms'}
            </button>
            <span style={{ fontSize: 10, color: expired ? '#facc15' : 'var(--text-muted)' }}>
              {expired ? 'These terms expired.' : `Valid for ${secondsLeft}s`}
            </span>
            {expired && (
              <button type="button" onClick={load}
                style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer' }}>
                Review again
              </button>
            )}
          </div>
        </>
      )}

      {saved && (
        <div data-testid="cbada-terms-saved" style={{ fontSize: 11, color: '#22c55e', lineHeight: 1.5 }}>
          Terms approved and saved. Sending is not enabled in this build: nothing was signed or sent. The transfer is listed under Journeys in progress.
        </div>
      )}
    </div>
  )
}
