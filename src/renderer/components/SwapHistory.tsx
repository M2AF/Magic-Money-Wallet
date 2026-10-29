/**
 * SwapHistory.tsx — the wallet's recent swaps, opened from the Swap page.
 *
 * Two sources, both read from the privileged layer: multi-step swaps
 * (`swapChainList`, one entry per swap) and single swaps (`swapSessions`). A
 * multi-step swap runs each step as a single swap too; those step records are
 * folded into their swap rather than listed twice. Read-only: nothing here
 * signs, sends or retries anything.
 */

import { useEffect, useState } from 'react'
import type { ChainedSwapView } from '../../shared/chained-swap-view'
import type { SettledSwapSession } from '../../shared/swap-settlement'
import { fmt } from './journey-format'
import { routeName } from './ChainedSwapPanel'

const TX_EXPLORER: Record<string, string> = {
  cardano: 'https://cardanoscan.io/transaction/', solana: 'https://solscan.io/tx/', ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/', arbitrum: 'https://arbiscan.io/tx/', optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/', bsc: 'https://bscscan.com/tx/', avalanche: 'https://snowtrace.io/tx/', monad: 'https://monadscan.com/tx/',
}
const txUrl = (chain: string, hash: string | null) => (hash && TX_EXPLORER[chain] ? TX_EXPLORER[chain] + hash : null)
const name = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type Tone = 'ok' | 'busy' | 'warn' | 'bad'
const TONE: Record<Tone, string> = { ok: '#22c55e', busy: '#38bdf8', warn: '#facc15', bad: '#fca5a5' }
const CHAIN_STATE: Record<ChainedSwapView['state'], [string, Tone]> = {
  completed: ['Complete', 'ok'], running: ['In progress', 'busy'], paused: ['Paused', 'warn'], stopped: ['Stopped', 'warn'], 'needs-review': ['Needs review', 'bad'],
}
function sessionState(s: SettledSwapSession): [string, Tone] {
  switch (s.state) {
    case 'completed': return ['Complete', 'ok']
    case 'refunded': return ['Refunded', 'warn']
    case 'failed': return ['Failed', 'bad']
    case 'partial': return ['Partial', 'warn']
    default: return ['In progress', 'busy']
  }
}

interface Entry { at: number; key: string; node: JSX.Element }

const cardStyle = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column' as const, gap: 5 }
const link = { color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color: TONE[tone], border: `1px solid ${TONE[tone]}55`, borderRadius: 8, padding: '1px 6px' }}>{label}</span>
}

function ChainedEntry({ c }: { c: ChainedSwapView }) {
  const first = c.hops[0], last = c.hops[c.hops.length - 1]
  const [label, tone] = CHAIN_STATE[c.state]
  const got = c.state === 'completed' ? last.measuredOutRaw : null
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
          {fmt(first.sellRaw ?? first.plannedSellRaw, first.fromDecimals)} {first.fromSymbol} → {got ? fmt(got, last.toDecimals) : '…'} {last.toSymbol}
        </span>
        <Badge label={label} tone={tone} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{name(first.fromChain)} → {name(last.toChain)} · {c.hops.length} steps · {when(c.createdAt)}</div>
      {c.hops.map((h, i) => {
        const url = txUrl(h.fromChain, h.txHash)
        const via = routeName(h.via, h.provider)
        return (
          <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {i + 1}. {h.fromSymbol} → {h.toSymbol}{via ? ` · ${via}` : ''}
            {h.measuredOutRaw ? ` · got ${fmt(h.measuredOutRaw, h.toDecimals)}` : ''}
            {url && <> · <a href={url} target="_blank" rel="noreferrer" style={link}>tx ↗</a></>}
          </div>
        )
      })}
      {c.reason && c.state !== 'completed' && <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{c.reason}</div>}
    </div>
  )
}

function SessionEntry({ s }: { s: SettledSwapSession }) {
  const [label, tone] = sessionState(s)
  const got = s.deliveredAmountRaw
  const src = s.sourceExplorerUrl ?? txUrl(s.fromChain, s.sourceTxHash)
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
          {fmt(s.sellAmountRaw, s.fromTokenDecimals)} {s.fromTokenSymbol} → {got ? fmt(got, s.deliveredTokenDecimals ?? s.toTokenDecimals) : `≈ ${fmt(s.expectedBuyAmountRaw, s.toTokenDecimals)}`} {s.deliveredTokenSymbol ?? s.toTokenSymbol}
        </span>
        <Badge label={label} tone={tone} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {s.fromChain === s.toChain ? name(s.fromChain) : `${name(s.fromChain)} → ${name(s.toChain)}`}
        {s.bridgeTool ? ` · ${routeName(s.bridgeTool, s.provider)}` : ''} · {when(s.createdAt)}
      </div>
      {(src || s.destExplorerUrl) && (
        <div style={{ fontSize: 11 }}>
          {src && <a href={src} target="_blank" rel="noreferrer" style={link}>Sent ↗</a>}
          {s.destExplorerUrl && s.destExplorerUrl !== src && <> · <a href={s.destExplorerUrl} target="_blank" rel="noreferrer" style={link}>Received ↗</a></>}
        </div>
      )}
    </div>
  )
}

/** The list itself, fetched when opened. */
export function SwapHistoryList({ limit = 50 }: { limit?: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      window.wallet.swapChainList?.().then(r => (r.ok ? r.value : [])).catch(() => [] as ChainedSwapView[]) ?? Promise.resolve([] as ChainedSwapView[]),
      window.wallet.swapSessions?.().catch(() => [] as SettledSwapSession[]) ?? Promise.resolve([] as SettledSwapSession[]),
    ]).then(([chains, sessions]) => {
      if (!alive) return
      const stepIds = new Set(chains.flatMap(c => c.hops.map(h => h.intentId).filter((x): x is string => !!x)))
      const list: Entry[] = [
        ...chains.map(c => ({ at: c.createdAt, key: c.id, node: <ChainedEntry c={c} /> })),
        ...sessions.filter(s => !stepIds.has(s.id) && s.sourceTxHash).map(s => ({ at: s.createdAt, key: s.id, node: <SessionEntry s={s} /> })),
      ]
      setEntries(list.sort((a, b) => b.at - a.at).slice(0, limit))
    }).catch(() => { if (alive) setError('Swap history could not be read.') })
    return () => { alive = false }
  }, [limit])

  if (error) return <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>
  if (!entries) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
  if (!entries.length) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No swaps yet.</div>
  return <div data-testid="swap-history-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{entries.map(e => <div key={e.key}>{e.node}</div>)}</div>
}

/** The History button; the page renders the sheet (inside its own bounds). */
export function SwapHistoryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label="Recent swaps" title="Recent swaps"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600,
          border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
        </svg>
        History
    </button>
  )
}

/** The history sheet, covering its positioned parent (the Swap page), not the whole window. */
export function SwapHistorySheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
        <div role="dialog" aria-label="Swap history" onClick={onClose}
          style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, maxHeight: '100%', overflowY: 'auto', background: 'var(--bg-primary, #0b0f17)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Swap history</span>
              <button type="button" aria-label="Close" onClick={onClose}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
            <SwapHistoryList />
          </div>
        </div>
  )
}
