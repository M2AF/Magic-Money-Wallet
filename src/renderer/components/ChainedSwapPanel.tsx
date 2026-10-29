/**
 * ChainedSwapPanel.tsx — a swap from a Cardano token to any token on another
 * chain, run as several hops by the wallet after ONE approval
 * (src/main/chained-swap.ts). The user sees one quote: the route, the final
 * expected amount and its guaranteed minimum, and presses Swap once.
 *
 * ChainedSwapProgress follows a started swap; ChainedSwapsInProgress resumes
 * any unfinished one after the wallet is reopened.
 */

import { useEffect, useRef, useState } from 'react'
import type { ChainQuoteRequest, ChainQuoteView, ChainedSwapView, ChainHopView } from '../../shared/chained-swap-view'
import { fmt } from './journey-format'

const name = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)
/** How a step's route is named on screen: the executed route when known, else its provider. */
export const routeName = (via: string | null | undefined, provider: string | null | undefined): string | null => {
  const v = via ? (VIA[via.toLowerCase()] ?? via) : null
  return v ?? (provider ? PROVIDER[provider] ?? provider : null)
}
const VIA: Record<string, string> = { 'near-intents': 'NEAR Intents', jupiter: 'Jupiter', relay: 'Relay', lifi: 'LI.FI' }
const PROVIDER: Record<string, string> = { minswap: 'Cardano DEX (best route)', 'near-intents': 'NEAR Intents', jupiter: 'Jupiter', relay: 'Relay', lifi: 'LI.FI', '0x': '0x', uniswap: 'Uniswap' }
const STATE: Record<ChainHopView['state'], string> = {
  pending: 'waiting', executing: 'sending…', submitted: 'in progress…', completed: 'done',
  failed: 'failed', refunded: 'refunded', 'needs-review': 'needs review',
}

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 7 }
const row = (l: string, r: React.ReactNode) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
    <span style={{ color: 'var(--text-muted)' }}>{l}</span>
    <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>{r}</span>
  </div>
)
const button = (primary: boolean, disabled = false) => ({
  padding: '11px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
  border: primary ? 'none' : '1px solid var(--border)', background: primary ? (disabled ? 'var(--border)' : 'var(--accent, #0ea5e9)') : 'transparent',
  color: primary ? '#0b0f17' : 'var(--text-primary)',
})

function Steps({ hops }: { hops: ChainHopView[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {hops.map((h, i) => (
        <div key={i} data-testid={`chain-step-${i + 1}`} style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          {i + 1}. {h.fromSymbol} → {h.toSymbol} on {name(h.toChain)}
          {h.state !== 'pending' && routeName(h.via, h.provider) && <span style={{ color: 'var(--text-muted)' }}> · via {routeName(h.via, h.provider)}</span>}
          <span style={{ color: 'var(--text-muted)' }}> · at least {fmt(h.approvedMinOutRaw, h.toDecimals)} {h.toSymbol}</span>
          {h.state !== 'pending' && <span style={{ color: h.state === 'completed' ? '#22c55e' : h.state === 'refunded' || h.state === 'failed' ? '#fca5a5' : '#38bdf8' }}> — {STATE[h.state]}</span>}
          {h.measuredOutRaw && <span style={{ color: 'var(--text-muted)' }}> · got {fmt(h.measuredOutRaw, h.toDecimals)}</span>}
        </div>
      ))}
    </div>
  )
}

export function ChainedSwapProgress({ initial, onDone }: { initial: ChainedSwapView; onDone?: () => void }) {
  const [swap, setSwap] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A failed poll schedules another one: without this the swap would stop being advanced.
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  // Set on EVERY mount: React may unmount and remount a component (StrictMode does
  // in development), and a flag left false would discard every later result.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const advance = async (opts: { acceptNewMinimum?: boolean; stop?: boolean } = {}) => {
    if (!window.wallet.swapChainAdvance) return
    setBusy(true)
    try {
      const r = await window.wallet.swapChainAdvance({ id: swap.id, ...opts })
      if (!alive.current) return
      if (r.ok) { setSwap(r.value); setError(null); setRetry(0) } else { setError(r.message); setRetry(n => n + 1) }
    } catch { if (alive.current) { setError('The swap could not be checked; it is retried automatically.'); setRetry(n => n + 1) } }
    finally { if (alive.current) setBusy(false) }
  }

  // The wallet runs the next hop when it is polled; a paused swap waits for the user
  // (except a locked wallet, which continues once unlocked).
  useEffect(() => {
    const auto = swap.state === 'running' || (swap.state === 'paused' && !!swap.reason?.startsWith('Unlock')) || (swap.state === 'paused' && !!swap.reason?.includes('retried automatically'))
    if (!auto) return
    const delay = retry > 0 ? Math.min(60_000, 5000 * retry) : swap.hops.some(h => h.state === 'submitted') ? 6000 : 1500
    const t = setTimeout(() => { void advance() }, delay)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap, retry])

  const last = swap.hops[swap.hops.length - 1]
  const priceMoved = swap.state === 'paused' && !!swap.reason?.startsWith('The price moved')
  // Paused for the user (not a pause the wallet resolves by itself): they can always stop.
  const waitingForUser = swap.state === 'paused' && !priceMoved && !swap.reason?.startsWith('Unlock') && !swap.reason?.includes('retried automatically')
  const finished = swap.state === 'completed' || swap.state === 'stopped'
  return (
    <div data-testid="chained-swap-progress" style={{ ...card, position: 'relative' }}>
      {finished && onDone && (
        <button type="button" aria-label="Close" onClick={onDone} style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12,
          border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 15, lineHeight: '24px', cursor: 'pointer' }}>✕</button>
      )}
      <div style={{ fontSize: 13, fontWeight: 700, paddingRight: finished && onDone ? 24 : 0, color: swap.state === 'completed' ? '#22c55e' : swap.state === 'running' ? '#38bdf8' : '#facc15' }}>
        {swap.state === 'completed' ? '✓ Swap complete'
          : swap.state === 'running' ? `Swapping… step ${Math.min(swap.hops.findIndex(h => h.state !== 'completed') + 1 || swap.hops.length, swap.hops.length)} of ${swap.hops.length}`
          : swap.state === 'paused' ? 'Paused' : swap.state === 'stopped' ? 'Stopped' : 'Needs review'}
      </div>
      <Steps hops={swap.hops} />
      {swap.state === 'completed' && last.measuredOutRaw && (
        <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>Received <b>{fmt(last.measuredOutRaw, last.toDecimals)} {last.toSymbol}</b> on {name(last.toChain)}.</div>
      )}
      {swap.reason && swap.state !== 'completed' && <div data-testid="chained-swap-reason" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{swap.reason}</div>}
      {error && <div style={{ fontSize: 11, color: '#fca5a5' }}>{error}</div>}
      {priceMoved && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => advance({ acceptNewMinimum: true })} style={button(true, busy)}>Continue at the new minimum</button>
          <button type="button" disabled={busy} onClick={() => advance({ stop: true })} style={button(false, busy)}>Stop here</button>
        </div>
      )}
      {waitingForUser && (
        <button type="button" disabled={busy} onClick={() => advance({ stop: true })} style={button(false, busy)}>Stop here</button>
      )}
    </div>
  )
}

export function ChainedSwapPanel({ request }: { request: ChainQuoteRequest | null }) {
  const [plan, setPlan] = useState<ChainQuoteView | null>(null)
  const [started, setStarted] = useState<ChainedSwapView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = request ? JSON.stringify(request) : ''
  const current = useRef(key)
  current.current = key
  useEffect(() => { setPlan(null); setError(null) }, [key])

  const quote = async (silent = false) => {
    if (!request || !window.wallet.swapChainQuote) return
    const asked = key
    if (!silent) { setLoading(true); setError(null) }
    try {
      const r = await window.wallet.swapChainQuote(request)
      if (current.current !== asked) return
      if (r.ok) setPlan(r.value); else if (!silent) setError(r.message)
    } catch (e) { if (!silent && current.current === asked) setError(e instanceof Error ? e.message : 'The swap could not be planned.') }
    finally { if (!silent && current.current === asked) setLoading(false) }
  }

  // Plans expire with their first hop's quote: refresh while the user decides.
  useEffect(() => {
    if (!plan || started) return
    const t = setInterval(() => { void quote(true) }, 25_000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, started])

  const start = async () => {
    if (!plan || !window.wallet.swapChainStart) return
    setLoading(true); setError(null)
    try {
      const r = await window.wallet.swapChainStart(plan.planId)
      if (r.ok) setStarted(r.value); else { setError(r.message); setPlan(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'The swap could not be started.') }
    finally { setLoading(false) }
  }

  if (!request || !window.wallet.swapChainQuote) return null
  if (started) return <ChainedSwapProgress initial={started} onDone={() => { setStarted(null); setPlan(null) }} />
  const last = plan?.hops[plan.hops.length - 1]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>}
      {plan && last && (
        <div data-testid="chained-swap-quote" style={card}>
          {row('Route', <span style={{ color: '#38bdf8' }}>{plan.hops.length > 1 ? `${plan.hops.length} steps, one approval` : 'Cross-chain'}</span>)}
          {plan.routes.map((r, i) => row(`Step ${i + 1}`, `${r.fromSymbol} → ${r.toSymbol} · ${PROVIDER[r.provider] ?? r.provider}`))}
          {row('You receive', <>≈ {fmt(plan.finalExpectedRaw, last.toDecimals)} {last.toSymbol}</>)}
          {row('Minimum received', <>{fmt(plan.finalMinRaw, last.toDecimals)} {last.toSymbol}</>)}
          <div data-testid="chained-swap-terms" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', background: 'rgba(56,189,248,0.06)',
            border: '1px solid rgba(56,189,248,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
            <strong style={{ color: '#38bdf8' }}>How this works: </strong>
            you approve once; the wallet then signs each step itself as soon as the previous one has arrived, selling exactly what
            arrived. Between steps your funds are in your own wallet. If a step's price falls below the minimum shown, the swap
            pauses and you choose whether to continue. A small amount of the destination's native token may be kept to pay the last
            step's network fee. Keep the wallet unlocked until it finishes; it continues when you unlock it again.
          </div>
        </div>
      )}
      {!plan
        ? <button type="button" disabled={loading} onClick={() => quote()} style={button(true, loading)}>{loading ? 'Planning the route…' : 'Get Quote'}</button>
        : <button type="button" disabled={loading} onClick={start} style={button(true, loading)}>{loading ? 'Starting…' : `Swap ${plan.hops[0].fromSymbol} → ${last?.toSymbol}`}</button>}
    </div>
  )
}

/** Unfinished multi-step swaps of this wallet, resumed on every visit. */
export function ChainedSwapsInProgress() {
  const [list, setList] = useState<ChainedSwapView[]>([])
  useEffect(() => {
    let alive = true
    window.wallet.swapChainList?.().then(r => { if (alive && r.ok) setList(r.value.filter(c => c.state === 'running' || c.state === 'paused' || c.state === 'needs-review')) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!list.length) return null
  return <>{list.map(c => <ChainedSwapProgress key={c.id} initial={c} onDone={() => setList(l => l.filter(x => x.id !== c.id))} />)}</>
}
