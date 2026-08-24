/**
 * HistoryPanel.tsx — the dApp browser's browsing history
 *
 * The same panel on every target that has a browser of its own (Electron,
 * Android, iOS). It talks only to `window.wallet.browser*History*`, which each
 * platform bridge implements over its own store — browser-store.ts in the
 * Electron main process, browser-data-local.ts in the mobile WebView.
 *
 * Anchored card on desktop (`floating`, so it reads as a dropdown from the ☰ it
 * came from), full-bleed sheet on the touch targets — the same two shapes the
 * passwords and downloads panels take, for the same reasons.
 *
 * The Tor notice is load-bearing, not decoration: visits made with Tor Mode on
 * are deliberately never written down, so without it a user who browsed through
 * Tor would open this and conclude history was broken.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ContentPanel, EmptyState, Notice, SiteIcon, fieldStyle } from './browser-ui'
import { RowButton } from './BookmarksPanel'
import type { HistoryEntry, HistorySnapshot } from '../types/wallet'

const EMPTY: HistorySnapshot = { items: [], recording: true }

// ─── Grouping ────────────────────────────────────────────────────────────────

const startOfDay = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today" / "Yesterday" / "Tuesday" / "12 August" — Chrome's day headings. */
function dayLabel(dayStart: number): string {
  const today = startOfDay(Date.now())
  if (dayStart === today) return 'Today'
  if (dayStart === today - 86_400_000) return 'Yesterday'
  const date = new Date(dayStart)
  if (today - dayStart < 7 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

const timeLabel = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * Split the (already newest-first) list into day buckets, preserving order.
 * Done here rather than in main so the boundaries follow the VIEWER's clock —
 * "Today" has to mean today where the window is, not where the file was written.
 */
function groupByDay(items: HistoryEntry[]): Array<{ day: number; entries: HistoryEntry[] }> {
  const out: Array<{ day: number; entries: HistoryEntry[] }> = []
  for (const entry of items) {
    const day = startOfDay(entry.lastVisitedAt)
    const last = out[out.length - 1]
    if (last && last.day === day) last.entries.push(entry)
    else out.push({ day, entries: [entry] })
  }
  return out
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function HistoryPanel({ onClose, onNavigate, onToast, floating, onDismiss }: {
  onClose: () => void
  onNavigate: (url: string) => void
  onToast: (message: string) => void
  /** Anchored card (desktop) rather than the full-bleed sheet (touch targets). */
  floating?: boolean
  onDismiss?: () => void
}) {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(EMPTY)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // Clearing everything is the one irreversible action here, so it asks first.
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)
  // Mobile resolves its list asynchronously; until the first read lands,
  // "nothing here yet" would be a lie.
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await window.wallet.browserListHistory?.()
      if (next) setSnapshot(next)
    } catch {
      setNotice('Your history could not be read.')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** Every mutation funnels through here so one place owns the fresh snapshot. */
  const run = useCallback(async (fn: () => Promise<HistorySnapshot | undefined>, done?: string) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const next = await fn()
      if (next) { setSnapshot(next); setLoaded(true) }
      if (done) onToast(done)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }, [busy, onToast])

  const open = (url: string) => { onNavigate(url); onClose() }

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      onToast('Link copied')
    } catch {
      setNotice('Could not copy that link.')
    }
  }

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q
      ? snapshot.items.filter(h =>
          h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      : snapshot.items),
    [snapshot.items, q]
  )
  const groups = useMemo(() => groupByDay(shown), [shown])

  return (
    <ContentPanel
      title="History"
      subtitle={`${snapshot.items.length} page${snapshot.items.length === 1 ? '' : 's'}`}
      onClose={onClose}
      floating={floating}
      // Never dismiss on an outside click while the clear is half-confirmed.
      onDismiss={confirmClear ? undefined : onDismiss}
      // Wider than the other panels: four row actions plus a meta line leave
      // little for the title otherwise, and a truncated title is the one thing
      // that makes a history row useless.
      width={560}
      actions={
        snapshot.items.length === 0 ? undefined : confirmClear ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Clear all history?</span>
            <RowButton
              label="Clear"
              danger
              ariaLabel="Clear all history permanently"
              onClick={() => {
                setConfirmClear(false)
                void run(() => window.wallet.browserClearHistory?.() ?? Promise.resolve(undefined), 'History cleared')
              }}
            />
            <RowButton label="Keep" onClick={() => setConfirmClear(false)} />
          </div>
        ) : (
          <RowButton label="Clear all" danger onClick={() => setConfirmClear(true)} disabled={busy} />
        )
      }
    >
      {snapshot.items.length > 4 && (
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search history"
          spellCheck={false}
          style={{ ...fieldStyle, marginBottom: 12 }}
        />
      )}

      {!snapshot.recording && (
        <div style={{ marginBottom: 10 }}>
          <Notice tone="info">
            {snapshot.pausedReason ?? 'Pages are not being added to history right now.'}
          </Notice>
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="🕘"
          title={!loaded ? 'Loading…' : snapshot.items.length === 0 ? 'No history yet' : 'No matches'}
          body={!loaded
            ? 'Reading your browsing history.'
            : snapshot.items.length === 0
              ? 'Pages you visit in this browser are listed here so you can find your way back to them. Nothing is ever sent anywhere — this list lives only on this device.'
              : 'Nothing here matches that search.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups.map(group => (
            <div key={group.day}>
              <div style={{
                padding: '10px 8px 6px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                textTransform: 'uppercase', color: 'var(--text-muted)',
              }}>
                {dayLabel(group.day)}
              </div>
              {group.entries.map(entry => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  onOpen={() => open(entry.url)}
                  onCopy={() => void copyLink(entry.url)}
                  onRemove={() => void run(() =>
                    window.wallet.browserRemoveHistory?.(entry.id) ?? Promise.resolve(undefined))}
                  onForgetSite={() => void run(() =>
                    window.wallet.browserRemoveHistoryHost?.(entry.host) ?? Promise.resolve(undefined),
                    `Removed everything from ${entry.host}`)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {notice && <Notice tone="error">{notice}</Notice>}
    </ContentPanel>
  )
}

function HistoryRow({ entry, busy, onOpen, onCopy, onRemove, onForgetSite }: {
  entry: HistoryEntry
  busy: boolean
  onOpen: () => void
  onCopy: () => void
  onRemove: () => void
  onForgetSite: () => void
}) {
  // Rows repeat the same three labels, so each button says WHAT it acts on for
  // a screen reader — the convention the downloads rows established.
  const name = entry.title || entry.host || entry.url

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px', borderRadius: 8, transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <SiteIcon url={entry.url} />

      <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} title={entry.url}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
        {/* HOST, not the full URL: at this width a long path truncates to
            "http://exa…" and says nothing, whereas the host always fits and is
            what identifies the page. The full URL is on the row's tooltip. */}
        <div style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {timeLabel(entry.lastVisitedAt)} · {entry.host || entry.url}
          {entry.visits > 1 ? ` · ${entry.visits} visits` : ''}
        </div>
      </div>

      <RowButton label="Open" ariaLabel={`Open ${name}`} onClick={onOpen} disabled={busy} />
      <RowButton label="Copy link" ariaLabel={`Copy the link to ${name}`} onClick={onCopy} disabled={busy} />
      <RowButton label="Forget site" ariaLabel={`Forget everything from ${entry.host}`} onClick={onForgetSite} disabled={busy} />
      <RowButton label="Remove" danger ariaLabel={`Remove ${name} from history`} onClick={onRemove} disabled={busy} />
    </div>
  )
}
