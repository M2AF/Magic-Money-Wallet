/**
 * BookmarksPanel.tsx — the dApp browser's bookmarks + installed-apps manager
 *
 * A full-area ContentPanel (not a dropdown): the list can be long and the rename
 * flow needs a real text field. Rendered inside BrowserApp's content div while
 * the active dApp view is detached — see browser-ui.tsx.
 *
 * Two tabs:
 *   Bookmarks — open / rename / remove, plus "Import from another browser"
 *               (reads Chrome/Edge/Brave/Vivaldi/Chromium bookmark files).
 *   Apps      — pages installed as OS shortcuts by the Save-and-share menu.
 */
import { useCallback, useEffect, useState } from 'react'
import { ContentPanel, EmptyState, Notice, SiteIcon, fieldStyle } from './browser-ui'
import type { Bookmark, ImportSource, WebApp } from '../types/wallet'

type Tab = 'bookmarks' | 'apps'

export function BookmarksPanel({ onClose, onNavigate, onToast }: {
  onClose: () => void
  onNavigate: (url: string) => void
  onToast: (message: string) => void
}) {
  const [tab, setTab] = useState<Tab>('bookmarks')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [apps, setApps] = useState<WebApp[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [sources, setSources] = useState<ImportSource[]>([])
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    const [b, a] = await Promise.all([
      window.wallet.browserListBookmarks?.() ?? Promise.resolve([]),
      window.wallet.browserListWebApps?.() ?? Promise.resolve([]),
    ])
    setBookmarks(b)
    setApps(a)
  }, [])

  useEffect(() => {
    void refresh()
    window.wallet.passwordsImportSources?.()
      .then(list => setSources(list.filter(s => s.hasBookmarks)))
      .catch(() => setSources([]))
  }, [refresh])

  const open = (url: string) => { onNavigate(url); onClose() }

  const remove = async (id: string) => {
    const next = await window.wallet.browserRemoveBookmark?.(id)
    if (next) setBookmarks(next)
  }

  const commitRename = async () => {
    if (!editing) return
    const next = await window.wallet.browserRenameBookmark?.(editing.id, editing.title)
    if (next) setBookmarks(next)
    setEditing(null)
  }

  const importFrom = async (sourceId: string) => {
    if (importing) return
    setImporting(true)
    setNotice(null)
    try {
      const result = await window.wallet.browserImportBookmarks?.(sourceId)
      if (!result) return
      if (result.error) setNotice({ tone: 'error', text: result.error })
      else {
        setBookmarks(result.bookmarks)
        setNotice({
          tone: 'success',
          text: `Imported ${result.added} bookmark${result.added === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} already saved` : ''}.`,
        })
      }
    } finally {
      setImporting(false)
    }
  }

  const uninstall = async (id: string) => {
    const next = await window.wallet.browserUninstallWebApp?.(id)
    if (next) setApps(next)
    onToast('App shortcut removed')
  }

  const q = query.trim().toLowerCase()
  const shown = q
    ? bookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    : bookmarks

  return (
    <ContentPanel
      title="Bookmarks"
      subtitle={tab === 'bookmarks'
        ? `${bookmarks.length} saved`
        : `${apps.length} installed app${apps.length === 1 ? '' : 's'}`}
      onClose={onClose}
      actions={<TabSwitch tab={tab} onChange={setTab} appCount={apps.length} />}
    >
      {tab === 'bookmarks' ? (
        <>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search bookmarks"
            spellCheck={false}
            style={{ ...fieldStyle, marginBottom: 12 }}
          />

          {shown.length === 0 ? (
            <EmptyState
              icon="🔖"
              title={bookmarks.length === 0 ? 'No bookmarks yet' : 'No matches'}
              body={bookmarks.length === 0
                ? 'Click the star at the end of the address bar to save the page you are on, or import your bookmarks from another browser below.'
                : 'Nothing here matches that search.'}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {shown.map(b => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 8px', borderRadius: 8, transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <SiteIcon url={b.url} />
                  {editing?.id === b.id ? (
                    <input
                      autoFocus
                      value={editing.title}
                      onChange={e => setEditing({ id: b.id, title: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      onBlur={() => void commitRename()}
                      style={{ ...fieldStyle, flex: 1, padding: '5px 8px' }}
                    />
                  ) : (
                    <div
                      onClick={() => open(b.url)}
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                      title={b.url}
                    >
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {b.title}
                      </div>
                      <div style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {b.url}
                      </div>
                    </div>
                  )}
                  <RowButton label="Rename" onClick={() => setEditing({ id: b.id, title: b.title })} />
                  <RowButton label="Remove" danger onClick={() => void remove(b.id)} />
                </div>
              ))}
            </div>
          )}

          <ImportRow
            sources={sources}
            busy={importing}
            label="Import bookmarks from"
            emptyText="No Chrome, Edge, Brave, Vivaldi or Chromium profile was found on this computer."
            onPick={importFrom}
          />
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </>
      ) : (
        <>
          {apps.length === 0 ? (
            <EmptyState
              icon="🧩"
              title="No installed apps"
              body="Open the share menu at the end of the address bar and choose “Install …” to give a site its own shortcut. It will open in MagicMoney Browser rather than your system browser."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {apps.map(a => (
                <div
                  key={a.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 8 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <SiteIcon url={a.url} />
                  <div onClick={() => open(a.url)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} title={a.shortcutPath ?? a.url}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.url}
                    </div>
                  </div>
                  <RowButton label="Uninstall" danger onClick={() => void uninstall(a.id)} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ContentPanel>
  )
}

function TabSwitch({ tab, onChange, appCount }: { tab: Tab; onChange: (t: Tab) => void; appCount: number }) {
  const btn = (value: Tab, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      style={{
        padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        background: tab === value ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${tab === value ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        color: tab === value ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  )
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {btn('bookmarks', 'Bookmarks')}
      {btn('apps', `Apps${appCount ? ` (${appCount})` : ''}`)}
    </div>
  )
}

/** Small text button used at the end of every list row. */
export function RowButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '4px 8px', fontSize: 10, fontWeight: 700,
        background: 'transparent', border: '1px solid var(--border)', borderRadius: 7,
        color: danger ? '#ef4444' : 'var(--text-secondary)', cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.borderColor = danger ? '#ef4444' : 'var(--accent)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {label}
    </button>
  )
}

/**
 * The "import from another browser" strip, shared by the bookmarks and password
 * panels. Lists every Chromium profile found on this machine as its own button —
 * a user with two Chrome profiles genuinely has two different sets.
 */
export function ImportRow({ sources, busy, label, emptyText, onPick, extra }: {
  sources: ImportSource[]
  busy: boolean
  label: string
  emptyText: string
  onPick: (sourceId: string) => void
  /** Optional trailing chip for a non-profile source (e.g. "CSV file…"). */
  extra?: { label: string; onClick: () => void }
}) {
  return (
    <div style={{
      marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>
        {label}
      </div>
      {sources.length === 0 && !extra ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sources.map(s => (
            <button
              key={s.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(s.id)}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                background: 'var(--surface-raised)', border: '1px solid var(--border)',
                borderRadius: 9, color: 'var(--text-secondary)',
                cursor: busy ? 'wait' : 'pointer',
              }}
              onMouseEnter={e => { if (!busy) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {s.browser}
              {s.profile !== 'Default' && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {s.profile}</span>
              )}
            </button>
          ))}
          {extra && (
            <button
              type="button"
              disabled={busy}
              onClick={extra.onClick}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                background: 'var(--surface-raised)', border: '1px dashed var(--border)',
                borderRadius: 9, color: 'var(--text-secondary)',
                cursor: busy ? 'wait' : 'pointer',
              }}
              onMouseEnter={e => { if (!busy) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {extra.label}
            </button>
          )}
        </div>
      )}
      {busy && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Importing…</div>}
    </div>
  )
}
