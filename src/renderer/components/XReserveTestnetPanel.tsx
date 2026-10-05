/**
 * XReserveTestnetPanel.tsx — Testnet Mode only: send Ethereum Sepolia USDC to
 * this wallet's own Cardano Preprod address through Circle xReserve, then check
 * what happened. Reopening rechecks one saved route; later checks are explicit.
 *
 * This panel is a thin view. Everything that matters — Testnet Mode, the
 * sender, the recipient, the contracts, the one-time intent, the checks before
 * signing and the tracking record — is decided in the privileged layer
 * (src/main/xreserve-testnet-deposit.ts). There is no mainnet path and no
 * polling timer here.
 *
 * ONE CLICK PER TRANSACTION. When the allowance is short, "Approve" signs only
 * the exact-amount USDC approval; its hash and confirmation are shown, and the
 * deposit terms are shown AGAIN for a separate "Sign deposit" click. Nothing
 * here (or in the privileged layer) moves from an approval to a deposit by
 * itself, so leaving the panel after approving can never send a deposit.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { XReserveRouteProgress } from './XReserveRouteProgress'
import { latestXreserveRoute } from '../lib/xreserve-route-progress'
import type {
  TestnetDepositState, TestnetDepositPreview, TestnetDepositResult, TestnetStatusSummary, XReserveTestnetEnvelope,
  TestnetApprovalResult, TestnetRecoveryResult,
} from '../../shared/xreserve-testnet-wire'

const card = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  padding: 14, display: 'flex', flexDirection: 'column' as const, gap: 10,
}
const muted = { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, wordBreak: 'break-all' as const }

const usdc = (raw: string | null) => {
  if (raw == null || !/^[0-9]+$/.test(raw)) return '—'
  const v = BigInt(raw)
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${v / 1_000_000n}${frac ? `.${frac}` : ''}`
}
const eth = (raw: string | null) => (raw == null || !/^[0-9]+$/.test(raw) ? '—' : (Number(BigInt(raw) / 10n ** 12n) / 1e6).toFixed(4))
const short = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h)

/** Plain words for the coordinator's typed states. */
const STATE_TEXT: Record<string, { text: string; color: string }> = {
  'minted': { text: '✓ Minted on Cardano Preprod', color: '#22c55e' },
  'source-pending': { text: '⏳ Waiting for the Sepolia deposit to confirm', color: '#38bdf8' },
  'source-failed': { text: '⚠ The Sepolia deposit reverted — nothing was deposited', color: '#fca5a5' },
  'source-not-approved': { text: '⚠ That transaction is not the approved deposit', color: '#fca5a5' },
  'source-inconsistent': { text: '⏳ Sepolia data disagreed — check again', color: '#facc15' },
  'attestation-pending': { text: '⏳ Waiting for Circle\'s attestation', color: '#38bdf8' },
  'attestation-malformed': { text: '⏳ Circle\'s answer was unreadable — check again', color: '#facc15' },
  'attestation-mismatch': { text: '⚠ Circle\'s attestation does not match this deposit', color: '#fca5a5' },
  'awaiting-mint': { text: '⏳ Attested — waiting for the Cardano mint', color: '#38bdf8' },
  'awaiting-confirmations': { text: '⏳ Minted — waiting for Cardano confirmations', color: '#38bdf8' },
  'mint-attempt-failed': { text: '⏳ A mint attempt failed on Cardano — waiting for another', color: '#facc15' },
  'conflict-awaiting-confirmations': { text: '⚠ A wrong-looking mint is still shallow — check again', color: '#facc15' },
  'mint-conflict': { text: '⚠ The attested mint paid or minted wrongly — needs review', color: '#fca5a5' },
  'mint-evidence-inconsistent': { text: '⚠ The two Cardano scans found different mints — needs review', color: '#fca5a5' },
  'disagreement-awaiting-confirmations': { text: '⏳ The Cardano scans disagree, not final yet — check again', color: '#facc15' },
  'cardano-unknown': { text: '⏳ Cardano scan incomplete or provider busy — check again', color: '#facc15' },
  'provider-unavailable': { text: '⏳ A provider could not be reached — check again', color: '#facc15' },
  'tracking-error': { text: '⚠ The tracking record needs recovery', color: '#fca5a5' },
  'invalid-input': { text: '⚠ The request was refused', color: '#fca5a5' },
}

function errorText(e: { code: string; message: string; submitted: string[] }) {
  return `${e.message}${e.code ? ` (${e.code})` : ''}`
}

export function XReserveTestnetPanel() {
  const api = window.wallet
  const [state, setState] = useState<TestnetDepositState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState('')
  const [amount, setAmount] = useState('')
  const [maxFee, setMaxFee] = useState('')
  const [preview, setPreview] = useState<TestnetDepositPreview | null>(null)
  const [approval, setApproval] = useState<TestnetApprovalResult | null>(null)
  const [result, setResult] = useState<TestnetDepositResult | null>(null)
  const [statuses, setStatuses] = useState<Record<string, TestnetStatusSummary | string>>({})
  const [auditDue, setAuditDue] = useState(false)
  const alive = useRef(true)
  const resumed = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const unwrap = <T,>(r: XReserveTestnetEnvelope<T> | undefined): T | null => {
    if (!r) { setError('Not available in this build.'); return null }
    if (!r.ok) { setError(errorText(r)); return null }
    return r.value
  }

  const refresh = useCallback(async () => {
    const r = await api.xreserveTestnetState?.()
    if (r?.ok) setState(r.value)
    else if (r) setError(errorText(r))
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  // ── Deposits recorded before broadcast whose outcome is not resolved yet ──
  const [recovery, setRecovery] = useState<TestnetRecoveryResult | null>(null)
  const recover = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const r = await api.xreserveTestnetRecover?.()
      if (r?.ok) setRecovery(r.value)
      else if (r) setError(errorText(r))
      await refresh()
    } finally { setBusy(false) }
  }, [api, refresh])
  // One read-only check when the panel opens with pending records (e.g. after a restart). Not a timer.
  const [autoRecovered, setAutoRecovered] = useState(false)
  useEffect(() => {
    if (!autoRecovered && state?.testnet && (state.pendingSends?.length ?? 0) > 0) { setAutoRecovered(true); void recover() }
  }, [autoRecovered, state, recover])
  const dismissCorrupt = async (key: string) => {
    if (!window.confirm('Remove this unreadable recovery record? Do this only after checking the account on Sepolia Etherscan: '
      + 'if a deposit from it landed, it will not be tracked.')) return
    setBusy(true); setError(null)
    try { if (unwrap(await api.xreserveTestnetDismissCorrupt?.(key))) await refresh() } finally { setBusy(false) }
  }

  const setSource = async (source: 'koios' | 'blockfrost') => {
    if (state?.cardanoSource === source) return
    setBusy(true); setError(null)
    try {
      if (unwrap(await api.xreserveTestnetSetSource?.(source))) await refresh()
    } finally { setBusy(false) }
  }

  const saveKey = async () => {
    setBusy(true); setError(null)
    try {
      if (unwrap(await api.xreserveTestnetSetKey?.(key.trim()))) { setKey(''); await refresh() }
    } finally { setBusy(false) }
  }

  const prepare = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const p = unwrap(await api.xreserveTestnetPrepare?.({ amount: amount.trim(), maxFee: maxFee.trim() }))
      if (p) setPreview(p)
    } finally { setBusy(false) }
  }

  const reset = () => { setPreview(null); setApproval(null) }

  /** Read-only: the approval's confirmation (bounded wait in the privileged layer). */
  const checkApproval = async (intentId: string) => {
    const a = unwrap(await api.xreserveTestnetApprovalStatus?.(intentId))
    if (a) {
      setApproval(prev => ({
        ...a,
        approvalTxHash: a.approvalTxHash ?? prev?.approvalTxHash ?? null,
        explorerUrl: a.explorerUrl ?? prev?.explorerUrl ?? null,
      }))
    }
  }

  /** Action 1: the exact-amount approval ONLY. */
  const approve = async () => {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      const a = unwrap(await api.xreserveTestnetApprove?.(preview.intentId))
      if (!a) return
      setApproval(a)
      if (a.state === 'submitted') await checkApproval(preview.intentId)
    } finally { setBusy(false) }
  }

  const recheckApproval = async () => {
    if (!approval) return
    setBusy(true); setError(null)
    try { await checkApproval(approval.intentId) } finally { setBusy(false) }
  }

  /** Action 2: the deposit, for exactly the terms on screen. */
  const deposit = async (terms: TestnetDepositPreview) => {
    setBusy(true); setError(null)
    try {
      const r = unwrap(await api.xreserveTestnetDeposit?.({
        intentId: terms.intentId,
        expected: { amountRaw: terms.amountRaw, maxFeeRaw: terms.maxFeeRaw, recipient: terms.recipient, sender: terms.sender },
      }))
      if (r) { setResult(r); reset(); setAmount(''); setMaxFee('') }
      await refresh()
    } finally { setBusy(false) }
  }

  const check = useCallback(async (sourceTxHash: string) => {
    setBusy(true); setError(null)
    // A failed new read cannot leave an older verdict presented as current.
    setStatuses(s => { const next = { ...s }; delete next[sourceTxHash]; return next })
    try {
      const r = unwrap(await api.xreserveTestnetCheck?.({ sourceTxHash, auditDue }))
      if (!r || !alive.current) return
      setStatuses(s => ({
        ...s,
        [sourceTxHash]: r.kind === 'tracking-error' ? `${r.reason} (${r.code})`
          : r.kind === 'save-failed' ? { ...r.status, reason: `${r.status.reason ?? ''} Progress was NOT saved: ${r.reason}`.trim() }
          : r.status,
      }))
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not check this route.')
    } finally { if (alive.current) setBusy(false) }
  }, [api, auditDue])

  // Reopen one persisted route with fresh evidence, using the privileged layer's
  // saved cursors. No timer, no signing and no resubmission; older routes stay manual.
  useEffect(() => {
    if (resumed.current || !state?.testnet || busy || !state.cardanoSourceReady || state.pendingSends.length) return
    resumed.current = true
    const latest = latestXreserveRoute(state.deposits)
    if (latest) void check(latest.sourceTxHash)
  }, [state, busy, check])

  if (!state) {
    return <div style={{ ...card, ...muted }}>{error ?? 'Loading the xReserve testnet test…'}</div>
  }
  if (!state.testnet) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="xreserve-testnet-panel">
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          🧪 xReserve test: {state.network.source} USDC → {state.network.destination} USDCx
        </div>
        <div style={muted}>
          Testnet only. Deposits Sepolia test USDC into Circle&apos;s xReserve contract so USDCx is minted to
          <strong style={{ color: 'var(--text-secondary)' }}> this wallet&apos;s own Cardano Preprod address</strong>.
          No mainnet funds can move here. The fee cap is yours to choose; Circle publishes no testnet quote.
        </div>
        <div style={{ ...muted, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
          <span>From</span><span style={mono}>{state.sender ?? '—'}</span>
          <span>To</span><span style={mono}>{state.recipient ?? '—'}</span>
          <span>Contract</span><span style={mono}>{state.network.xReserve}</span>
        </div>
      </div>

      <div style={card} data-testid="xreserve-testnet-source">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Cardano Preprod data</div>
        <div role="radiogroup" aria-label="Cardano Preprod data source" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ ...muted, display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="xreserve-preprod-source" checked={state.cardanoSource === 'koios'} disabled={busy} onChange={() => setSource('koios')} />
            <span><strong style={{ color: 'var(--text-secondary)' }}>Koios</strong> — keyless public Preprod API (koios.rest). Nothing to set up.</span>
          </label>
          <label style={{ ...muted, display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="xreserve-preprod-source" checked={state.cardanoSource === 'blockfrost'} disabled={busy} onChange={() => setSource('blockfrost')} />
            <span><strong style={{ color: 'var(--text-secondary)' }}>Blockfrost</strong> — with your own Preprod project id{state.preprodKeySet ? ' (set)' : ''}.</span>
          </label>
        </div>
      </div>

      {state.cardanoSource === 'blockfrost' && !state.preprodKeySet && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Blockfrost Preprod project id</div>
          <div style={muted}>
            Tracking reads Cardano Preprod through Blockfrost with your own free Preprod project id
            (blockfrost.io). It is stored on this device only and used only in Testnet Mode.
          </div>
          <input className="input" placeholder="preprod…" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="button" className="btn btn-primary" disabled={busy || !key.trim()} onClick={saveKey}>Save project id</button>
        </div>
      )}

      {!preview && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, ...muted }}>Amount (USDC)
              <input className="input" inputMode="decimal" placeholder="e.g. 20" value={amount} onChange={e => setAmount(e.target.value)} />
            </label>
            <label style={{ flex: 1, ...muted }}>Fee cap (USDC)
              <input className="input" inputMode="decimal" placeholder="e.g. 10" value={maxFee} onChange={e => setMaxFee(e.target.value)} />
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !state.cardanoSourceReady || !amount.trim() || !maxFee.trim()} onClick={prepare}>
            {busy ? 'Checking…' : 'Review deposit'}
          </button>
        </div>
      )}

      {preview && (() => {
        // The terms to confirm for the deposit: the fresh ones after an approval, or the preview when none is needed.
        const depositTerms = approval?.terms ?? (preview.needsApproval === false ? preview : null)
        const twoSteps = preview.needsApproval !== false
        const termRows = (t: TestnetDepositPreview) => (
          <div style={{ ...muted, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px' }}>
            <span>Deposit</span><span style={{ color: 'var(--text-primary)' }}>{t.amount} USDC on {t.sourceChain}</span>
            <span>Fee cap</span><span style={{ color: 'var(--text-primary)' }}>{t.maxFee} USDC</span>
            <span>Recipient</span><span style={mono}>{t.recipient} ({t.recipientKind})</span>
            <span>Balance</span><span>{usdc(t.usdcBalanceRaw)} USDC · {eth(t.ethBalanceRaw)} ETH</span>
            <span>Allowance</span><span>{t.allowanceRaw == null ? 'unreadable — checked again at each step' : `${usdc(t.allowanceRaw)} USDC`}</span>
          </div>
        )
        return (
          <>
            {!depositTerms && (
              <div style={{ ...card, borderColor: 'rgba(245, 158, 11, 0.5)' }} data-testid="xreserve-testnet-preview">
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Step 1 of 2 — approve USDC</div>
                {termRows(preview)}
                <div style={muted}>
                  This signs ONLY an approval letting Circle&apos;s xReserve contract take exactly {preview.amount} USDC.
                  No deposit is sent. You confirm the deposit separately afterwards.
                </div>
                {approval && (
                  <div style={{ fontSize: 12, lineHeight: 1.5 }} data-testid="xreserve-testnet-approval">
                    {approval.approvalTxHash && approval.explorerUrl && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Approval <a href={approval.explorerUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)' }}>{short(approval.approvalTxHash)}</a>
                      </div>
                    )}
                    <div style={{ color: approval.state === 'failed' ? '#fca5a5' : '#38bdf8' }}>
                      {approval.state === 'failed' ? '⚠ The approval reverted — approving again is safe.'
                        : '⏳ Approval submitted — not confirmed yet.'}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  {approval && approval.state !== 'failed'
                    ? <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={recheckApproval}>{busy ? 'Checking…' : 'Check approval'}</button>
                    : <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={approve}>{busy ? 'Signing…' : `Approve ${preview.amount} USDC`}</button>}
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={reset}>Cancel</button>
                </div>
              </div>
            )}
            {depositTerms && (
              <div style={{ ...card, borderColor: 'rgba(245, 158, 11, 0.5)' }} data-testid="xreserve-testnet-deposit-confirm">
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {twoSteps ? 'Step 2 of 2 — confirm the deposit' : 'Confirm the deposit'}
                </div>
                {approval?.approvalTxHash && approval.explorerUrl && (
                  <div style={{ fontSize: 12, color: '#22c55e' }}>
                    ✓ Approval confirmed <a href={approval.explorerUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)' }}>{short(approval.approvalTxHash)}</a>
                  </div>
                )}
                {termRows(depositTerms)}
                <div style={muted}>This signs the xReserve deposit on Ethereum Sepolia. It is checked again against these terms before signing.</div>
                {(state.pendingSends?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 12, color: '#facc15' }}>An earlier deposit is pending recovery. Check it first — a deposit that could double-send is refused.</div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => deposit(depositTerms)}>{busy ? 'Signing…' : 'Sign deposit'}</button>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={reset}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {result && (
        <div style={card} data-testid="xreserve-testnet-result">
          <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>Deposit sent on Sepolia</div>
          <a href={result.explorerUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)' }}>{result.sourceTxHash}</a>
          {result.tracking === 'save-failed'
            ? <div style={{ fontSize: 12, color: '#fca5a5' }}>Tracking was NOT saved ({result.trackingReason}). Keep the transaction hash above.</div>
            : <div style={muted}>Tracking started from the Cardano Preprod tip read before sending.</div>}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }} role="alert">{error}</div>}

      {(state.pendingSends?.length ?? 0) > 0 && (
        <div style={{ ...card, borderColor: 'rgba(250, 204, 21, 0.5)' }} data-testid="xreserve-testnet-pending">
          <div style={{ fontSize: 13, fontWeight: 700, color: '#facc15' }}>Pending deposit — outcome not confirmed yet</div>
          <div style={muted}>
            A deposit was signed and recorded, but the wallet has not yet confirmed whether it reached Sepolia. It is
            never sent again automatically. &quot;Check pending deposit&quot; looks for it on Sepolia and starts tracking it if
            found. A new deposit is blocked while this one could still land.
          </div>
          {state.pendingSends.map(p => {
            const r = recovery?.entries.find(e => (p.txHash && e.txHash === p.txHash) || (p.corrupt && e.verdict === 'corrupt'))
            return (
              <div key={p.key} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {p.corrupt
                  ? <div style={{ fontSize: 12, color: '#fca5a5' }}>Unreadable recovery record.</div>
                  : <div style={{ ...muted }}>
                      {usdc(p.amountRaw)} USDC · nonce {p.nonce} ·{' '}
                      <a href={p.explorerUrl ?? '#'} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)' }}>{short(p.txHash ?? '')}</a>
                    </div>}
                {r && <div style={{ fontSize: 12, color: r.verdict === 'mismatch' || r.verdict === 'corrupt' ? '#fca5a5' : '#38bdf8' }}>{r.reason}</div>}
                {p.corrupt && (
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', width: 'auto', alignSelf: 'flex-start' }}
                    disabled={busy} onClick={() => dismissCorrupt(p.key)}>Remove after checking Etherscan</button>
                )}
              </div>
            )
          })}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={recover}>{busy ? 'Checking…' : 'Check pending deposit'}</button>
        </div>
      )}

      {recovery && (state.pendingSends?.length ?? 0) === 0 && recovery.entries.length > 0 && (
        <div style={{ ...muted }} data-testid="xreserve-testnet-recovered">
          {recovery.entries.map((e, i) => <div key={i}>{e.reason}</div>)}
        </div>
      )}

      {state.deposits.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Tracked deposits</div>
            <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={auditDue} onChange={e => setAuditDue(e.target.checked)} /> also scan all USDCx
            </label>
          </div>
          <div style={muted}>The latest saved route is rechecked when this panel opens. Checking progress never sends another deposit.</div>
          {state.deposits.map(d => {
            const s = statuses[d.sourceTxHash]
            const view = s && typeof s !== 'string' ? (STATE_TEXT[s.state] ?? { text: s.state, color: 'var(--text-secondary)' }) : null
            return (
              <div key={d.sourceTxHash} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a href={d.explorerUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)', wordBreak: 'normal', whiteSpace: 'nowrap' }}>{short(d.sourceTxHash)}</a>
                    <div style={muted}>{usdc(d.amountRaw)} USDC · fee cap {usdc(d.maxFeeRaw)}</div>
                  </div>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0, whiteSpace: 'nowrap', width: 'auto' }} disabled={busy} onClick={() => check(d.sourceTxHash)}>Check status</button>
                </div>
                {typeof s === 'string' && <div style={{ fontSize: 11, color: '#fca5a5' }}>{s}</div>}
                <XReserveRouteProgress status={s && typeof s !== 'string' ? s : undefined} />
                {view && typeof s !== 'string' && (
                  <div style={{ fontSize: 12, color: view.color }}>
                    {view.text}
                    {s.mint && <div style={{ ...muted, marginTop: 2 }}>Cardano tx <span style={mono}>{short(s.mint.txHash)}</span> · {s.mint.confirmations} confirmations{s.creditedRaw ? ` · ${usdc(s.creditedRaw)} USDCx credited` : ''}</div>}
                    {s.reason && <div style={{ ...muted, marginTop: 2 }}>{s.reason}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
