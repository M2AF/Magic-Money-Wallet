import { useEffect, useRef, useState } from 'react'
import type { AutoRevokeSettings } from '../types/wallet'
import {
  AUTO_REVOKE_MAX_MINUTES, AUTO_REVOKE_MIN_MINUTES,
  clampMinutes, formatDuration, formatRemaining, stepMinutes,
} from '../lib/auto-revoke-ui'

/**
 * Settings → Security → "Auto-revoke site access".
 *
 * Off by default. On reveals a 1–60 minute slider with one-minute arrows. The
 * backend owns the countdown — this only edits the two settings and displays
 * the deadline it reports, re-reading the truth after any failed save so the
 * control never shows a value that was not persisted.
 */
export function AutoRevokeControl({ onChanged }: { onChanged?: () => void }) {
  const [settings, setSettings] = useState<AutoRevokeSettings | null>(null)
  const [draft, setDraft] = useState(15)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Only the newest save's answer may land — the arrows can outrun the backend.
  const saveSeq = useRef(0)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const adopt = (s: AutoRevokeSettings) => { setSettings(s); setDraft(s.durationMinutes) }

  const reload = () => {
    window.wallet.getAutoRevokeSettings()
      .then(adopt)
      .catch(() => setError('Couldn’t load the auto-revoke setting.'))
  }

  useEffect(() => {
    let alive = true
    window.wallet.getAutoRevokeSettings()
      .then(s => { if (alive) adopt(s) })
      .catch(() => { if (alive) setError('Couldn’t load the auto-revoke setting.') })
    // Pushed after an automatic expiry (and any change), so the Connected
    // Sites count and the countdown refresh without reopening Settings.
    const onPush = (s: AutoRevokeSettings) => {
      if (!alive) return
      adopt(s)
      onChangedRef.current?.()
    }
    window.wallet.onAutoRevokeChanged(onPush)
    return () => {
      alive = false
      window.wallet.offAutoRevokeChanged(onPush)
      if (commitTimer.current) clearTimeout(commitTimer.current)
    }
  }, [])

  // Keep "disconnects in N min" current, and re-read once the deadline passes
  // (the backend enforces it; this just catches the UI up).
  const deadlineAt = settings?.enabled ? settings.deadlineAt : null
  useEffect(() => {
    if (deadlineAt === null) return
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    const due = setTimeout(reload, Math.max(deadlineAt - Date.now(), 0) + 1_500)
    setNow(Date.now())
    return () => { clearInterval(tick); clearTimeout(due) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt])

  const save = async (patch: { enabled?: boolean; durationMinutes?: number }) => {
    const seq = ++saveSeq.current
    setBusy(true)
    setError(null)
    try {
      const next = await window.wallet.setAutoRevokeSettings(patch)
      if (seq === saveSeq.current) adopt(next)
      onChangedRef.current?.()
    } catch (e) {
      if (seq !== saveSeq.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Couldn’t save: ${msg.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')}`)
      reload()
    } finally {
      if (seq === saveSeq.current) setBusy(false)
    }
  }

  const commitDuration = (minutes: number, delay: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null
      if (minutes !== settings?.durationMinutes) void save({ durationMinutes: minutes })
    }, delay)
  }

  const onSlide = (value: number) => {
    const minutes = clampMinutes(value)
    setDraft(minutes)
    commitDuration(minutes, 350)   // one save per drag, not per pixel
  }

  const onStep = (delta: 1 | -1) => {
    const minutes = stepMinutes(draft, delta)
    if (minutes === draft) return
    setDraft(minutes)
    commitDuration(minutes, 0)
  }

  if (!settings) {
    return error
      ? <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{error}</div>
      : null
  }

  const on = settings.enabled
  const arrowStyle: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text)', fontSize: 14, cursor: 'pointer',
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="settings-row"
        onClick={() => void save({ enabled: !on })}
        disabled={busy}
      >
        <span className="settings-icon">⏱️</span>
        <div className="settings-row-text">
          <div className="settings-row-label">{`Auto-revoke site access — ${on ? 'On' : 'Off'}`}</div>
          <div className="settings-row-sub">
            {on
              ? `All sites disconnect after ${formatDuration(settings.durationMinutes)}.`
              : 'Disconnect all sites after a set time.'}
          </div>
        </div>
      </button>

      {on && (
        <div style={{ padding: '2px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
            <label htmlFor="auto-revoke-minutes" style={{ color: 'var(--text-secondary)' }}>
              Disconnect all sites after
            </label>
            <output htmlFor="auto-revoke-minutes" aria-live="polite" style={{ fontWeight: 600 }}>
              {formatDuration(draft)}
            </output>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              style={arrowStyle}
              aria-label="One minute less"
              onClick={() => onStep(-1)}
              disabled={draft <= AUTO_REVOKE_MIN_MINUTES}
            >◀</button>
            <input
              id="auto-revoke-minutes"
              type="range"
              min={AUTO_REVOKE_MIN_MINUTES}
              max={AUTO_REVOKE_MAX_MINUTES}
              step={1}
              value={draft}
              aria-valuetext={formatDuration(draft)}
              onChange={e => onSlide(Number(e.target.value))}
              style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent)' }}
            />
            <button
              type="button"
              style={arrowStyle}
              aria-label="One minute more"
              onClick={() => onStep(1)}
              disabled={draft >= AUTO_REVOKE_MAX_MINUTES}
            >▶</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }} role="status">
            {settings.deadlineAt !== null
              ? `Next automatic disconnect in ${formatRemaining(settings.deadlineAt - now)} (at ${new Date(settings.deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`
              : 'The timer starts when you next connect a site or WalletConnect session.'}
            {settings.wcTeardownPending && ' Still disconnecting WalletConnect sessions — will retry.'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            One timer for everything: it starts at the first connection, and sites connected
            meanwhile share its deadline. It does not clear cookies or browsing data, lock the
            wallet, or revoke on-chain token approvals.
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }} role="alert">{error}</div>
      )}
    </>
  )
}
