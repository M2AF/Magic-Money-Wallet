/**
 * JourneysInProgress.tsx — the current wallet's unfinished multi-step journeys,
 * restored from storage on every visit (journey:list), with a read-only check
 * of each SENT step against its chain by the transaction hash saved before
 * broadcast (journey:recheck).
 *
 * There is deliberately no resend, retry or "try again" action for a sent step:
 * a step whose outcome is unknown is checked again, never sent again. Only a
 * journey that sent nothing can be cancelled. Finding a
 * Solana transaction is only discovery — a cbADA delivery shows as delivered
 * only when the OffRamp/credit proof in the privileged layer says so.
 */

import { useEffect, useRef, useState } from 'react'
import type { JourneyListSummary, JourneyRecheckResult } from '../../shared/journey-candidate'
import { fmt, ethAmount } from './journey-format'
import { JOURNEYS_CHANGED } from './CbAdaTermsPanel'

const ROLE: Record<string, string> = { 'source-swap': 'Swap', bridge: 'Bridge', 'destination-swap': 'Swap' }
const STATE: Record<string, string> = {
  skipped: 'not needed', planned: 'not started', approved: 'approved, not sent', submitted: 'sent',
  uncertain: 'sent — outcome unknown', confirmed: 'confirmed', failed: 'failed', 'needs-review': 'needs review',
}
const ON_CHAIN: Record<string, string> = {
  confirmed: 'on chain: succeeded', failed: 'on chain: failed', 'not-found': 'not on chain (yet)', unknown: 'could not be checked',
}
const short = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h)
const name = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)

function deliveryLine(d: NonNullable<JourneyRecheckResult['legs'][number]['delivery']>): { text: string; color: string } {
  switch (d.state) {
    case 'delivered': return { text: `Delivered on Solana (proven by the OffRamp event and the exact credit) — ${short(d.signature)}`, color: '#22c55e' }
    case 'execution-failed': return { text: `Solana execution FAILED for this message — ${short(d.signature)}. Needs review; this is not a refund.`, color: '#fca5a5' }
    case 'credit-mismatch': return { text: `Executed on Solana but the credit differs (${d.creditedRaw}) — ${short(d.signature)}. Needs review.`, color: '#facc15' }
    case 'not-found-yet': return { text: `No Solana delivery yet (${d.checked} transactions checked).`, color: 'var(--text-secondary)' }
    case 'incomplete': return { text: `Solana search incomplete: ${d.reason}.`, color: 'var(--text-secondary)' }
  }
}

export function JourneysInProgress() {
  const [list, setList] = useState<JourneyListSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, JourneyRecheckResult | string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  // Re-read storage whenever this view comes into sight: the Swap screen can
  // stay mounted while hidden, so a list read only at mount would go stale.
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      window.wallet.journeyList?.().then(r => {
        if (!alive) return
        if (r.ok) { setList(r.value); setError(null) } else setError(r.message)
      }).catch(() => { if (alive) setError('Journeys could not be read.') })
    }
    load()
    const el = sentinel.current
    const io = el && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) load() })
      : null
    if (io && el) io.observe(el)
    window.addEventListener(JOURNEYS_CHANGED, load)
    return () => { alive = false; io?.disconnect(); window.removeEventListener(JOURNEYS_CHANGED, load) }
  }, [reloads])

  // Always rendered (zero height) so the view can notice when it is shown.
  const marker = <div ref={sentinel} data-testid="journeys-sentinel" style={{ height: 0 }} />
  if (!window.wallet.journeyList) return null
  if (error) return <>{marker}<div style={{ fontSize: 11, color: '#fca5a5' }}>{error}</div></>
  if (!list || (list.active.length === 0 && list.unreadable.length === 0)) return marker

  const recheck = async (id: string) => {
    if (!window.wallet.journeyRecheck) return
    setBusy(id)
    try {
      const r = await window.wallet.journeyRecheck(id)
      setChecks(c => ({ ...c, [id]: r.ok ? r.value : r.message }))
    } catch {
      setChecks(c => ({ ...c, [id]: 'This journey could not be checked.' }))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (id: string) => {
    if (!window.wallet.journeyCancel) return
    setBusy(id)
    try {
      const r = await window.wallet.journeyCancel(id)
      if (!r.ok) setChecks(c => ({ ...c, [id]: r.message }))
    } catch {
      setChecks(c => ({ ...c, [id]: 'This journey could not be cancelled.' }))
    } finally {
      setBusy(null); setConfirmCancel(null); setReloads(n => n + 1)
    }
  }

  const button = (wait: boolean) => ({
    alignSelf: 'flex-start' as const, padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: wait ? 'wait' : 'pointer',
  })

  return (
    <>{marker}<div data-testid="journeys-in-progress" style={{
      background: 'var(--bg-card)', border: '1px solid rgba(56,189,248,0.35)', borderRadius: 'var(--radius-sm)',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Journeys in progress</div>
      {list.unreadable.length > 0 && (
        <div style={{ fontSize: 11, color: '#facc15' }}>
          {list.unreadable.length} stored journey record(s) could not be read. They were kept untouched.
        </div>
      )}
      {list.active.map(j => {
        const check = checks[j.id]
        return (
          <div key={j.id} data-testid={`journey-${j.id}`} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Started {new Date(j.createdAt).toLocaleString()}</div>
            {j.legs.map((l, i) => (
              <div key={i} style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                {i + 1}. {ROLE[l.role] ?? l.role} {l.inputSymbol} → {l.outputSymbol} on {name(l.chain)} — {STATE[l.state] ?? l.state}
                {l.txHash && <span style={{ color: 'var(--text-muted)' }}> · {short(l.txHash)}</span>}
                {l.providerRef && <span style={{ color: 'var(--text-muted)' }}> · message {short(l.providerRef)}</span>}
                {l.approvalTxHash && <span style={{ color: 'var(--text-muted)' }}> · approval {short(l.approvalTxHash)}</span>}
              </div>
            ))}
            {j.authorization && (() => {
              const a = j.authorization, amount = j.legs[1]?.approvedInputRaw
              return (
                <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                  Approved terms{amount ? `: ${fmt(amount, 6)} ${j.legs[1].inputSymbol}` : ''} from {a.sender.slice(0, 8)}…{a.sender.slice(-6)} · max CCIP
                  fee {ethAmount(a.maxCcipFeeWei)} · max gas: approval {ethAmount(a.maxApprovalGasWei)}, transfer {ethAmount(a.maxSendGasWei)}
                  {j.cancellable && <div style={{ color: '#facc15' }}>Sending is not enabled in this build; nothing has been signed or sent.</div>}
                </div>
              )
            })()}
            {typeof check === 'string' && <div style={{ fontSize: 11, color: '#fca5a5' }}>{check}</div>}
            {check && typeof check !== 'string' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {check.legs.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No step has been sent yet.</div>}
                {check.legs.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                    {e.kind === 'approval' ? 'Approval' : (ROLE[e.role] ?? e.role)} on {name(e.chain)}: {ON_CHAIN[e.onChain]}
                    {e.kind === 'approval' && e.allowanceCovers !== null && <> · allowance {e.allowanceCovers ? 'covers the amount' : 'does not cover the amount'}</>}
                    {e.messageId && <> · message {short(e.messageId)}</>}
                    {e.note && <div style={{ color: '#facc15' }}>{e.note}</div>}
                    {e.delivery && (() => { const d = deliveryLine(e.delivery); return <div style={{ color: d.color }}>{d.text}</div> })()}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => recheck(j.id)} disabled={busy === j.id} style={button(busy === j.id)}>
                {busy === j.id ? 'Checking…' : 'Check on chain'}
              </button>
              {j.cancellable && window.wallet.journeyCancel && (confirmCancel === j.id ? (
                <button type="button" onClick={() => cancel(j.id)} disabled={busy === j.id} style={{ ...button(busy === j.id), color: '#fca5a5' }}>
                  Confirm: cancel this transfer
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmCancel(j.id)} disabled={busy === j.id} style={button(false)}>
                  Cancel (nothing was sent)
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Sent steps are only ever checked again by their saved transaction — never sent a second time.
            </div>
          </div>
        )
      })}
    </div></>
  )
}
