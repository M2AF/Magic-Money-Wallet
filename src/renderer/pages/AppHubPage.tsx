import { useState, useMemo } from 'react'
import APP_HUB, { AppEntry } from '../data/app-hub'

const ALL = 'All'

export function AppHubPage() {
  const [chainFilter, setChainFilter]       = useState<string>(ALL)
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL)
  const [search, setSearch]                 = useState('')

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

  function openApp(url: string) {
    // In Chrome extension context chrome.tabs is available — open directly in a new tab.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((globalThis as any).chrome?.tabs?.create) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).chrome.tabs.create({ url })
      return
    }
    // Electron: open the built-in dApp browser popup then navigate to the URL.
    window.wallet.openBrowser()
    setTimeout(() => window.wallet.browserNavigate(url), 400)
  }

  return (
    <div className="apphub-page">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="apphub-header">
        <h2 className="apphub-title">App Hub</h2>
        <span className="apphub-count">{APP_HUB.apps.length} apps</span>
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

      {/* ── Category pills ───────────────────────────────────── */}
      <div className="apphub-pills-row">
        <button
          className={`apphub-pill${categoryFilter === ALL ? ' active' : ''}`}
          onClick={() => setCategoryFilter(ALL)}
        >All</button>
        {APP_HUB.categories.map(c => (
          <button
            key={c.name}
            className={`apphub-pill${categoryFilter === c.name ? ' active' : ''}`}
            onClick={() => setCategoryFilter(c.name)}
          >
            {c.short}
            <span className="apphub-pill-count">{c.count}</span>
          </button>
        ))}
      </div>

      {/* ── Chain pills ──────────────────────────────────────── */}
      <div className="apphub-pills-row apphub-chains-row">
        <button
          className={`apphub-pill chain-pill${chainFilter === ALL ? ' active' : ''}`}
          onClick={() => setChainFilter(ALL)}
        >All chains</button>
        {APP_HUB.chains.map(ch => (
          <button
            key={ch.id}
            className={`apphub-pill chain-pill${chainFilter === ch.id ? ' active' : ''}`}
            onClick={() => setChainFilter(ch.id)}
          >
            {ch.label}
          </button>
        ))}
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
                {featured.map(app => <AppCard key={app.id} app={app} onOpen={openApp} />)}
              </div>
            </>
          )}
          {rest.length > 0 && (
            <>
              {featured.length > 0 && <p className="apphub-section-label">All apps</p>}
              <div className="apphub-grid">
                {rest.map(app => <AppCard key={app.id} app={app} onOpen={openApp} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AppCard({ app, onOpen }: { app: AppEntry; onOpen: (url: string) => void }) {
  const [imgErr, setImgErr] = useState(false)

  return (
    <div className="apphub-card">
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
