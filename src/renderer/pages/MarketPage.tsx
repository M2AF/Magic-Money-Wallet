import { useState, useEffect, useCallback, useRef } from 'react'
import type { MarketCoin, MarketResult } from '../types/wallet'
import { HeaderToolbar, type HeaderToolbarProps } from '../components/HeaderToolbar'
import { useDisplayCurrency, type DisplayCurrency } from '../lib/currency'

// Carried as one bag and spread below, so a new toolbar action reaches this
// page without an edit here — see HeaderToolbarProps.
type TabProps = HeaderToolbarProps

// ─── Module-level client cache — survives tab switches (component unmount/remount)
let _pageCache: MarketResult | null = null
let _pageCacheTime = 0
const PAGE_CACHE_SHOW_TTL  = 3 * 60 * 1000  // use cached data for up to 3 min
const PAGE_CACHE_FRESH_TTL = 60 * 1000       // silently refresh if older than 1 min

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * The table's column track, shared by the header, the rows and the loading
 * skeleton so they cannot drift apart. Fixed widths, not `auto`: every row is
 * its own grid container, so content-sized tracks would line up with nothing.
 *
 * Price and market cap are wider than they were because both the symbol and the
 * magnitude move with the display currency — "$80,522.00" becomes
 * "CA$112,730.80" — and against the old 66px the CAD figure ran straight
 * through the 24h column. The other half of that fit is in formatFiatPrice,
 * which goes compact above ten million so the high-magnitude currencies (VND,
 * IDR, KRW) cannot outgrow the track either. The asset name pays for the extra
 * width and already ellipsizes.
 */
const MARKET_COLUMNS = '20px minmax(0,1fr) 96px 44px 58px 58px'

// Market data is quoted in USD (see main/market-fetcher.ts); the display
// currency is applied on top of it, exactly as it is for portfolio values.
function fmtPrice(p: number, cur: DisplayCurrency): string {
  return cur.fmtPrice(p) ?? '—'
}

function fmtCap(n: number | null, cur: DisplayCurrency): string {
  if (!n) return '—'
  return cur.fmtCompact(n) ?? '—'
}

function fmtChange(pct: number | null) {
  if (pct == null) return null
  const up = pct >= 0
  return (
    <span style={{ color: up ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
    </span>
  )
}

// ─── Inline sparkline for table row ─────────────────────────────────────────

function RowSparkline({ data, change24h }: { data: number[] | null; change24h: number | null }) {
  if (!data || data.length < 2) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  const W = 60, H = 22
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 2) - 1}`)
    .join(' ')
  const color = (change24h ?? 0) >= 0 ? '#22c55e' : '#ef4444'
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}

// ─── Full chart for modal ────────────────────────────────────────────────────

function FullChart({ data, color }: { data: Array<[number, number]>; color: string }) {
  if (data.length < 2) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
      No chart data
    </div>
  )
  const W = 380, H = 130
  const prices = data.map(d => d[1])
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices
    .map((v, i) => `${(i / (prices.length - 1)) * W},${H - ((v - min) / range) * (H - 8) - 4}`)
    .join(' ')

  const first = prices[0]
  const last = prices[prices.length - 1]
  const isUp = last >= first

  // Gradient fill path
  const fillPts = `${pts} ${W},${H} 0,${H}`

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', height: H, borderRadius: 6 }}>
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#chartFill)" />
      <polyline points={pts} fill="none" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── Chart modal ─────────────────────────────────────────────────────────────

type Timeframe = '1' | '7' | '30' | '365' | 'max'
const TIMEFRAMES: Array<{ key: Timeframe; label: string }> = [
  { key: '1',   label: '1D' },
  { key: '7',   label: '7D' },
  { key: '30',  label: '1M' },
  { key: '365', label: '1Y' },
  { key: 'max', label: 'ALL' },
]

function ChartModal({ coin, onClose }: { coin: MarketCoin; onClose: () => void }) {
  const cur = useDisplayCurrency()
  const [tf, setTf]           = useState<Timeframe>('7')
  const [chartData, setChartData] = useState<Array<[number, number]>>([])
  const [loading, setLoading] = useState(true)
  const [convertAmt, setConvertAmt] = useState('1')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.wallet.getCoinChart(coin.id, tf).then(data => {
      if (!cancelled) { setChartData(data); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [coin.id, tf])

  const usdVal = parseFloat(convertAmt || '0') * coin.price
  // Per-unit-of-display-currency, not per-USD: with CAD selected the line
  // below reads "1 CAD = …", so the divisor has to move with the rate.
  const pricePerUnit = coin.price * (cur.rate ?? 1)
  const coinVal = parseFloat(convertAmt || '0') / (pricePerUnit || 1)

  const prices = chartData.map(d => d[1])
  const first = prices[0] ?? coin.price
  const last  = prices[prices.length - 1] ?? coin.price
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0
  const isUp = changePct >= 0

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(6, 11, 24, 0.85)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 20, width: '100%', maxWidth: 420
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={coin.image} alt={coin.symbol} width={32} height={32} style={{ borderRadius: '50%' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                {coin.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{coin.symbol}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {/* Price + change */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {fmtPrice(coin.price, cur)}
          </div>
          {!loading && chartData.length > 1 && (
            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: isUp ? '#22c55e' : '#ef4444' }}>
              {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
        </div>

        {/* Timeframe buttons */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {TIMEFRAMES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTf(key)}
              style={{
                flex: 1, padding: '5px 0', border: `1px solid ${tf === key ? 'var(--border-active)' : 'var(--border)'}`,
                borderRadius: 6, background: tf === key ? 'var(--accent-dim)' : 'transparent',
                color: tf === key ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                transition: 'all var(--transition)'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div style={{ marginBottom: 16, minHeight: 130 }}>
          {loading ? (
            <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : (
            <FullChart data={chartData} color={isUp ? '#22c55e' : '#ef4444'} />
          )}
        </div>

        {/* Converter */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Converter</div>

          {/* Row 1 — coin amount input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="number"
              value={convertAmt}
              onChange={e => setConvertAmt(e.target.value)}
              placeholder="1"
              style={{
                flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', minWidth: 0
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 700, minWidth: 48, textAlign: 'right', letterSpacing: '0.04em' }}>
              {coin.symbol}
            </span>
          </div>

          {/* Row 2 — fiat output, in the user's display currency */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              flex: 1, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font-mono)',
              fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {cur.fmt(usdVal, { precise: true })}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, minWidth: 48, textAlign: 'right' }}>
              {cur.shownCode.toUpperCase()}
            </span>
          </div>

          {/* Rate */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            1 {cur.shownCode.toUpperCase()} = {coinVal >= 0.000001 ? coinVal.toPrecision(5) : coinVal.toExponential(2)} {coin.symbol}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Market table row ────────────────────────────────────────────────────────

function CoinRow({ coin, onClick }: { coin: MarketCoin; onClick: () => void }) {
  const cur = useDisplayCurrency()
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: MARKET_COLUMNS,
        gap: 6, alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background var(--transition)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,170,255,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Rank */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'left' }}>
        {coin.rank}
      </div>

      {/* Name + image */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <img src={coin.image} alt={coin.symbol} width={20} height={20}
          style={{ borderRadius: '50%', flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{coin.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{coin.symbol}</div>
        </div>
      </div>

      {/* Price */}
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right' }}>
        {fmtPrice(coin.price, cur)}
      </div>

      {/* 24h */}
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtChange(coin.change24h)}</div>

      {/* Market cap */}
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
        {fmtCap(coin.marketCap, cur)}
      </div>

      {/* Sparkline */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <RowSparkline data={coin.sparkline} change24h={coin.change24h} />
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function MarketPage(toolbar: TabProps) {
  // Seed state from module-level cache instantly — avoids loading flash on tab switch
  const [data, setData]             = useState<MarketResult | null>(_pageCache)
  const [loading, setLoading]       = useState(_pageCache === null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]         = useState('')
  const [searchResults, setSearchResults] = useState<MarketCoin[] | null>(null)
  const [searching, setSearching]   = useState(false)
  const [selectedCoin, setSelectedCoin] = useState<MarketCoin | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadMarket = useCallback(async (forceRefresh = false) => {
    const now = Date.now()
    const cacheAge = now - _pageCacheTime

    // If cache is fresh and this isn't a manual refresh, return immediately
    if (!forceRefresh && _pageCache && cacheAge < PAGE_CACHE_SHOW_TTL) {
      // Silently refresh in background if cache is > 1 min old
      if (cacheAge > PAGE_CACHE_FRESH_TTL) {
        window.wallet.getMarket().then(result => {
          _pageCache = result
          _pageCacheTime = Date.now()
          if (mountedRef.current) setData(result)
        }).catch(() => { /* silent */ })
      }
      return
    }

    // Cache is stale or manual refresh — show loading indicator
    if (forceRefresh && _pageCache) setRefreshing(true)
    else if (!_pageCache) setLoading(true)

    try {
      const result = await window.wallet.getMarket()
      _pageCache = result
      _pageCacheTime = Date.now()
      if (mountedRef.current) setData(result)
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])

  useEffect(() => { loadMarket() }, [loadMarket])

  const handleSearch = async () => {
    const q = search.trim()
    if (!q) { setSearchResults(null); return }
    setSearching(true)
    try {
      const results = await window.wallet.searchMarket(q)
      setSearchResults(results)
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => { setSearch(''); setSearchResults(null) }

  // The fetcher returns up to 500 coins so search covers well beyond the table;
  // the table itself stays top-100.
  const displayCoins = searchResults ?? (data?.coins ?? []).slice(0, 100)

  const lastUpdated = data
    ? new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="page fade-in" style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h1 style={{ fontSize: 16, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
              Market Watch
            </h1>
            {lastUpdated && !searchResults && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                Updated {lastUpdated}{data?.source ? ` · ${data.source}` : ''}
              </div>
            )}
            {searchResults && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{search}"
              </div>
            )}
          </div>
          <HeaderToolbar
            {...toolbar}
            onRefresh={() => loadMarket(true)}
            refreshing={refreshing}
          />
        </div>

        {/* Search */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search coins…"
            style={{
              flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)', fontSize: 12, padding: '7px 10px', outline: 'none'
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--border-active)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          {searchResults ? (
            <button onClick={clearSearch} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Clear
            </button>
          ) : (
            <button onClick={handleSearch} disabled={searching || !search.trim()} style={{ padding: '6px 12px', background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: !search.trim() ? 0.5 : 1 }}>
              {searching ? '…' : 'Search'}
            </button>
          )}
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: MARKET_COLUMNS,
        gap: 6, padding: '6px 12px',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, background: 'rgba(0,0,0,0.2)'
      }}>
        {['#', 'Asset', 'Price', '24h', 'Mkt Cap', '7D'].map((h, i) => (
          <div key={h} style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: i > 1 ? 'right' : 'left' }}>
            {h}
          </div>
        ))}
      </div>

      {/* Scrollable coin list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: MARKET_COLUMNS,
              gap: 6, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border)'
            }}>
              {[16, 100, 60, 40, 50, 50].map((w, j) => (
                <div key={j} style={{ height: 10, width: w, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite', justifySelf: j > 1 ? 'end' : 'start' }} />
              ))}
            </div>
          ))
        ) : data?.error && !searchResults ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Failed to load market data. Check your connection and try again.
          </div>
        ) : displayCoins.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {searchResults ? 'No coins found.' : 'No data.'}
          </div>
        ) : (
          displayCoins.map(coin => (
            <CoinRow key={coin.id} coin={coin} onClick={() => setSelectedCoin(coin)} />
          ))
        )}
      </div>

      {/* Chart modal */}
      {selectedCoin && (
        <ChartModal coin={selectedCoin} onClose={() => setSelectedCoin(null)} />
      )}
    </div>
  )
}
