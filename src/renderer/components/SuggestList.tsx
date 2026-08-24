/**
 * SuggestList.tsx — the address bar's suggestions, shared by desktop and mobile
 *
 * Two sources in one list:
 *   Recent — pages from browsing history, ranked by shared/history-wire's
 *            matchHistory so the phone and the desktop can never order the same
 *            query differently.
 *   Apps   — the App Hub, matched the same way the App Hub's own search does.
 *
 * History comes FIRST because a typed fragment is far more often "take me back
 * to where I was" than "find me a new dApp" — but Apps always still renders, so
 * the App Hub discovery this bar has always offered is never displaced.
 *
 * The two surfaces differ only in their frame: BrowserApp drops this into an
 * absolutely-positioned dropdown under the bar, while BrowserOverlay gives it
 * the whole content area (a phone cannot have a dropdown — native WebViews
 * render above the wallet's, which is why every menu there is a full surface).
 */
import { useMemo, useState } from 'react'
import { matchHistory, historyHost, type HistoryEntry } from '../../shared/history-wire'
import APP_HUB, { type AppEntry } from '../data/app-hub'

/** How many of each kind, so the list stays scannable rather than exhaustive. */
const HISTORY_LIMIT = 5
const APP_LIMIT = 6

/** Same matching the App Hub search uses: name or website substring. */
function suggestApps(query: string, limit: number): AppEntry[] {
  const q = query.trim().toLowerCase()
  const pool = q
    ? APP_HUB.apps.filter(a => a.name.toLowerCase().includes(q) || a.website.toLowerCase().includes(q))
    : APP_HUB.apps.filter(a => a.featured)
  return pool.slice(0, limit)
}

export interface Suggestions {
  recent: HistoryEntry[]
  apps: AppEntry[]
  /** True when the query matched nothing at all — the caller shows the hint. */
  empty: boolean
}

/**
 * Shared so the row count is known before render (BrowserApp puts it in the
 * section label) and so both chromes compute the same thing.
 *
 * A history entry whose host matches an app is dropped: the app row carries a
 * real favicon and a category, so showing both is a duplicate with less
 * information in it.
 */
export function buildSuggestions(history: HistoryEntry[], query: string): Suggestions {
  const apps = suggestApps(query, APP_LIMIT)
  const appHosts = new Set(apps.map(a => historyHost(a.website)).filter(Boolean))
  const recent = matchHistory(history, query, HISTORY_LIMIT + appHosts.size)
    .filter(h => !appHosts.has(h.host))
    .slice(0, HISTORY_LIMIT)
  return { recent, apps, empty: recent.length === 0 && apps.length === 0 }
}

export function SuggestList({ history, query, typed, onOpen }: {
  history: HistoryEntry[]
  query: string
  /** Nothing typed yet ⇒ the labels read "Recently visited" / "Popular apps". */
  typed: boolean
  onOpen: (url: string) => void
}) {
  const { recent, apps, empty } = useMemo(
    () => buildSuggestions(history, typed ? query : ''),
    [history, query, typed]
  )
  const searching = typed && query.trim().length > 0

  return (
    <>
      {recent.length > 0 && (
        <>
          <SectionLabel>{searching ? `Recent (${recent.length})` : 'Recently visited'}</SectionLabel>
          {recent.map(entry => (
            <HistorySuggestRow key={entry.id} entry={entry} onOpen={onOpen} />
          ))}
        </>
      )}

      {apps.length > 0 && (
        <>
          <SectionLabel>{searching ? `Apps (${apps.length})` : 'Popular apps'}</SectionLabel>
          {apps.map(app => (
            <AppSuggestRow key={app.id} app={app} onOpen={onOpen} />
          ))}
        </>
      )}

      {empty && (
        <div style={{ padding: '4px 8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nothing recent or in the App Hub matches — press Enter to open the address
        </div>
      )}
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '6px 8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
      textTransform: 'uppercase', color: 'var(--text-muted)',
    }}>
      {children}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
  transition: 'background 0.12s',
}
const hoverOn = (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }
const hoverOff = (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'transparent' }

/** A page from history: letter chip, title, url, and when it was last opened. */
function HistorySuggestRow({ entry, onOpen }: { entry: HistoryEntry; onOpen: (url: string) => void }) {
  return (
    <div onClick={() => onOpen(entry.url)} title={entry.url} style={rowStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-raised)', border: '1px solid var(--border)',
        fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase',
      }}>
        {entry.host.charAt(0) || '?'}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title || entry.host || entry.url}
        </span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.url}
        </span>
      </div>

      <span style={{
        fontSize: 9, fontWeight: 600, flexShrink: 0, padding: '2px 6px',
        borderRadius: 8, background: 'transparent',
        border: '1px solid var(--border)', color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}>
        {relativeDay(entry.lastVisitedAt)}
      </span>
    </div>
  )
}

/** Short enough to sit in a chip: "now", "2h", "Tue", "12 Aug". */
function relativeDay(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 3_600_000) return 'now'
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  const date = new Date(ts)
  if (diff < 7 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// One row of the address-bar App Hub dropdown: favicon, name, hostname, category.
// Clicking navigates the ACTIVE tab to the app — same semantics as typing its URL.
function AppSuggestRow({ app, onOpen }: { app: AppEntry; onOpen: (url: string) => void }) {
  const [imgErr, setImgErr] = useState(false)
  let host = app.website
  try { host = new URL(app.website).hostname } catch { /* keep raw website */ }

  return (
    <div onClick={() => onOpen(app.website)} title={app.website} style={rowStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
      {imgErr || !app.favicon ? (
        <div style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-raised)', border: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
        }}>
          {app.name.charAt(0).toUpperCase()}
        </div>
      ) : (
        <img
          src={app.favicon}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: 6, flexShrink: 0 }}
          onError={() => setImgErr(true)}
          loading="lazy"
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {app.name}
        </span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {host}
        </span>
      </div>

      <span style={{
        fontSize: 9, fontWeight: 600, flexShrink: 0, padding: '2px 6px',
        borderRadius: 8, background: 'var(--surface-raised)',
        border: '1px solid var(--border)', color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}>
        {app.category}
      </span>
    </div>
  )
}
