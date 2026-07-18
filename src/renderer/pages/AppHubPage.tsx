import { useState, useMemo, useRef, useEffect } from 'react'
import APP_HUB, { AppEntry } from '../data/app-hub'
import { HeaderToolbar } from '../components/HeaderToolbar'
import { chainColor, type ChainColor } from '../data/chain-colors'

const ALL = 'All'

/** Distinct chain accent colors for an app, in chain order, capped for legibility. */
function chainAccents(chains: string[]): ChainColor[] {
  const seen = new Set<string>()
  const out: ChainColor[] = []
  for (const c of chains) {
    const col = chainColor(c)
    if (seen.has(col.hex)) continue
    seen.add(col.hex)
    out.push(col)
    if (out.length >= 6) break
  }
  return out.length ? out : [chainColor('')]
}

/** Smooth rounded-card ring that blends the supported chains' colors. */
function accentGradient(colors: ChainColor[]): string {
  const palette = colors.length === 1
    ? [colors[0].hex, '#05D9FF', colors[0].hex]
    : colors.map(c => c.hex)
  const stops = [...palette, palette[0]].map((hex, i) => {
    const pos = (100 * i) / palette.length
    return `${hex} ${pos.toFixed(1)}%`
  })
  return `conic-gradient(from 140deg at 50% 50%, ${stops.join(', ')})`
}

interface DropdownOption { value: string; label: string; count?: number }

interface TabProps {
  onWcOpen?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
  onProfile?: () => void
  onSettings?: () => void
  browserOpen?: boolean
  onBrowserOpened?: () => void
}

interface AppContextMenu {
  app: AppEntry
  x: number
  y: number
}

export function AppHubPage({
  onWcOpen,
  wcActiveSessions,
  wcPending,
  onProfile,
  onSettings,
  browserOpen = false,
  onBrowserOpened,
}: TabProps) {
  const [chainFilter, setChainFilter]       = useState<string>(ALL)
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL)
  const [search, setSearch]                 = useState('')
  const [openDropdown, setOpenDropdown]     = useState<'category' | 'chain' | null>(null)
  const [contextMenu, setContextMenu]        = useState<AppContextMenu | null>(null)

  const filtered = useMemo<AppEntry[]>(() => {
    const q = search.trim().toLowerCase()
    return APP_HUB.apps.filter(app => {
      if (chainFilter    !== ALL && !app.chains.includes(chainFilter))    return false
      if (categoryFilter !== ALL && app.category !== categoryFilter)       return false
      if (q && !app.name.toLowerCase().includes(q) && !app.website.toLowerCase().includes(q)) return false
      return true
    })
  }, [chainFilter, categoryFilter, search])

  const featured = filtered.filter(a => a.featured)
  const rest      = filtered.filter(a => !a.featured)

  function hasChromeTabs() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((globalThis as any).chrome?.tabs?.create)
  }

  function openApp(url: string) {
    setContextMenu(null)
    // In Chrome extension context chrome.tabs is available — open directly in a new tab.
    if (hasChromeTabs()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).chrome.tabs.create({ url })
      return
    }
    // Electron: open the built-in dApp browser popup then navigate to the URL.
    window.wallet.openBrowser()
    onBrowserOpened?.()
    setTimeout(() => window.wallet.browserNavigate(url), 400)
  }

  // Android has a persistent-tabs browser: "Open in New Tab" works even when the
  // browser isn't currently visible (it reveals the session and adds the tab).
  function canOpenInNewTab() {
    return hasChromeTabs() || !!window.wallet.openBrowserInNewTab || browserOpen
  }

  function openAppInNewTab(url: string) {
    setContextMenu(null)
    if (hasChromeTabs()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).chrome.tabs.create({ url })
      return
    }
    // Android persistent browser — add a tab (revealing the browser if hidden).
    if (window.wallet.openBrowserInNewTab) {
      window.wallet.openBrowserInNewTab(url)
      onBrowserOpened?.()
      return
    }
    if (browserOpen) {
      window.wallet.browserNewTab(url)
      return
    }
    openApp(url)
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  return (
    <div className="apphub-page">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="apphub-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 className="apphub-title">App Hub</h2>
          <span className="apphub-count">{APP_HUB.apps.length} apps</span>
        </div>
        <HeaderToolbar
          onWcOpen={onWcOpen}
          wcActiveSessions={wcActiveSessions}
          wcPending={wcPending}
          onProfile={onProfile}
          onSettings={onSettings}
        />
      </div>

      {/* ── Search ───────────────────────────────────────────── */}
      <div className="apphub-search-wrap">
        <svg className="apphub-search-icon" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          className="apphub-search"
          type="text"
          placeholder="Search apps…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* ── Filters (dropdowns) ──────────────────────────────── */}
      <div className="apphub-filters-row">
        <FilterDropdown
          label="Category"
          value={categoryFilter}
          options={[
            { value: ALL, label: 'All Categories' },
            ...APP_HUB.categories.map(c => ({ value: c.name, label: c.short, count: c.count })),
          ]}
          onChange={setCategoryFilter}
          open={openDropdown === 'category'}
          onToggle={() => setOpenDropdown(o => (o === 'category' ? null : 'category'))}
          onClose={() => setOpenDropdown(null)}
        />
        <FilterDropdown
          label="Chain"
          value={chainFilter}
          options={[
            { value: ALL, label: 'All Chains' },
            ...APP_HUB.chains.map(ch => ({ value: ch.id, label: ch.label })),
          ]}
          onChange={setChainFilter}
          open={openDropdown === 'chain'}
          onToggle={() => setOpenDropdown(o => (o === 'chain' ? null : 'chain'))}
          onClose={() => setOpenDropdown(null)}
        />
      </div>

      {/* ── Results ──────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="apphub-empty">No apps match your filters</div>
      ) : (
        <div className="apphub-scroll">
          {featured.length > 0 && (
            <>
              <p className="apphub-section-label">Featured</p>
              <div className="apphub-grid">
                {featured.map(app => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onOpen={openApp}
                    onContextMenu={(x, y) => setContextMenu({ app, x, y })}
                  />
                ))}
              </div>
            </>
          )}
          {rest.length > 0 && (
            <>
              {featured.length > 0 && <p className="apphub-section-label">All apps</p>}
              <div className="apphub-grid">
                {rest.map(app => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onOpen={openApp}
                    onContextMenu={(x, y) => setContextMenu({ app, x, y })}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="apphub-context-menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 180)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - (canOpenInNewTab() ? 92 : 50))),
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {canOpenInNewTab() && (
            <button
              type="button"
              className="apphub-context-item"
              onClick={() => openAppInNewTab(contextMenu.app.website)}
            >
              Open in New Tab
            </button>
          )}
          <button
            type="button"
            className="apphub-context-item"
            onClick={() => openApp(contextMenu.app.website)}
          >
            {browserOpen ? 'Open in Current Tab' : 'Open in Browser'}
          </button>
        </div>
      )}
    </div>
  )
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  open,
  onToggle,
  onClose,
}: {
  label: string
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, onClose])

  const selected = options.find(o => o.value === value) ?? options[0]
  const isFiltered = value !== options[0].value

  return (
    <div className="apphub-dropdown" ref={ref}>
      <button
        className={`apphub-dropdown-btn${isFiltered ? ' active' : ''}`}
        onClick={onToggle}
      >
        <span className="apphub-dropdown-prefix">{label}</span>
        <span className="apphub-dropdown-value">{selected.label}</span>
        <svg
          className={`apphub-dropdown-caret${open ? ' open' : ''}`}
          width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="apphub-dropdown-menu">
          {options.map(o => (
            <button
              key={o.value}
              className={`apphub-dropdown-item${o.value === value ? ' active' : ''}`}
              onClick={() => {
                onChange(o.value)
                onClose()
              }}
            >
              <span>{o.label}</span>
              {o.count != null && <span className="apphub-dropdown-count">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AppCard({
  app,
  onOpen,
  onContextMenu,
}: {
  app: AppEntry
  onOpen: (url: string) => void
  onContextMenu: (x: number, y: number) => void
}) {
  const [imgErr, setImgErr] = useState(false)

  // Touch equivalent of right-click: a 500ms long-press opens the same menu.
  const longPress = useRef<number | null>(null)
  const startLongPress = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    const { clientX, clientY } = e
    longPress.current = window.setTimeout(() => { longPress.current = null; onContextMenu(clientX, clientY) }, 500)
  }
  const cancelLongPress = () => {
    if (longPress.current != null) { clearTimeout(longPress.current); longPress.current = null }
  }

  const accents = chainAccents(app.chains)
  const primary = accents[0]

  return (
    <div
      className="apphub-card"
      onContextMenu={e => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerMove={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      style={{
        ['--chains-gradient' as string]: accentGradient(accents),
        ['--card-accent' as string]: primary.hex,
        ['--card-accent-rgb' as string]: primary.rgb,
      }}
    >
      <div className="apphub-card-top">
        {imgErr || !app.favicon ? (
          <div className="apphub-favicon-fallback">
            {app.name.charAt(0).toUpperCase()}
          </div>
        ) : (
          <img
            className="apphub-favicon"
            src={app.favicon}
            alt={app.name}
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        )}
        <div className="apphub-card-info">
          <span className="apphub-card-name">{app.name}</span>
          <span className="apphub-card-category">{app.category}</span>
        </div>
      </div>

      {/* Chain badges — show up to 5 then +N */}
      <div className="apphub-card-chains">
        {app.chains.slice(0, 5).map(c => (
          <span key={c} className="apphub-chain-badge">{c}</span>
        ))}
        {app.chains.length > 5 && (
          <span className="apphub-chain-badge muted">+{app.chains.length - 5}</span>
        )}
      </div>

      <button
        className="apphub-open-btn"
        onClick={() => onOpen(app.website)}
        title={`Open ${app.website}`}
      >
        Open
        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 4 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    </div>
  )
}
