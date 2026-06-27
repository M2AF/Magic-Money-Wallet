/**
 * ExchangeStatusCard.tsx — replaces the SimpleSwap form once an exchange is
 * created. Shows the deposit address the user must fund, an animated status
 * tracker (polled every 8s until terminal), and a fixed-rate countdown.
 */

import { useEffect, useRef, useState } from 'react'
import type { SsExchange, SimpleSwapStatus, ExchangeProvider } from '../types/simpleswap'

interface Props {
  exchange: SsExchange
  provider: ExchangeProvider
  fromLabel: string
  toLabel: string
  fromNetworkName: string
  onNewExchange: () => void
}

const STEPS: { key: SimpleSwapStatus; label: string }[] = [
  { key: 'waiting', label: 'Waiting for deposit' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'exchanging', label: 'Exchanging' },
  { key: 'sending', label: 'Sending' },
  { key: 'finished', label: 'Complete' },
]
const STEP_INDEX: Record<string, number> = { waiting: 0, confirming: 1, exchanging: 2, sending: 3, finished: 4 }
const TERMINAL = new Set(['finished', 'failed', 'refunded', 'expired'])

const DOT_COLOR: Record<string, string> = {
  waiting: '#94a3b8', confirming: '#38bdf8', exchanging: '#facc15',
  sending: '#fb923c', finished: '#22c55e', failed: '#ef4444', refunded: '#ef4444', expired: '#ef4444',
}

function shorten(s: string, head = 10, tail = 6): string {
  if (!s || s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

export function ExchangeStatusCard({ exchange: initial, provider, fromLabel, toLabel, fromNetworkName, onNewExchange }: Props) {
  const [exchange, setExchange] = useState<SsExchange>(initial)
  const [copied, setCopied] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const alive = useRef(true)

  const status = String(exchange.status)
  const isFixed = exchange.rateType === 'fixed'
  const currentIdx = STEP_INDEX[status] ?? 0
  const failed = status === 'failed' || status === 'refunded' || status === 'expired'

  // ── Status polling (every 8s until terminal) ──────────────────────────────
  useEffect(() => {
    alive.current = true
    if (TERMINAL.has(status)) return
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await window.wallet.xStatus(provider, exchange.id)
        if (!alive.current) return
        if (!next.error && next.id) setExchange(prev => ({ ...prev, ...next }))
        if (next.error || !TERMINAL.has(String(next.status))) timer = setTimeout(poll, 8000)
      } catch {
        if (alive.current) timer = setTimeout(poll, 8000)
      }
    }
    timer = setTimeout(poll, 8000)
    return () => { alive.current = false; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange.id, status])

  // ── Fixed-rate countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isFixed || !exchange.validUntil) { setRemaining(null); return }
    const target = new Date(exchange.validUntil).getTime()
    const tick = () => setRemaining(Math.max(0, Math.floor((target - Date.now()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [isFixed, exchange.validUntil])

  const copy = async () => {
    try { await navigator.clipboard.writeText(exchange.addressFrom); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const mmss = remaining != null ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: failed ? '#fca5a5' : '#22c55e' }}>
          {failed ? '⚠ Exchange ' + status : '✓ Exchange Created'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{shorten(exchange.id, 8, 6)}</span>
      </div>

      {/* Deposit instructions */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>SEND EXACTLY</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {exchange.amountFrom} {fromLabel}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>TO THIS ADDRESS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1 }}>{exchange.addressFrom}</span>
            <button type="button" onClick={copy} style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Network: {fromNetworkName}</div>
          {exchange.extraIdFrom && (
            <div style={{ fontSize: 11, color: '#facc15', marginTop: 4 }}>Include memo/tag: <span style={{ fontFamily: 'monospace' }}>{exchange.extraIdFrom}</span></div>
          )}
        </div>

        <div style={{ fontSize: 11, color: '#facc15', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span>⚠ Do not close until funds are sent</span>
          {mmss && <span style={{ fontFamily: 'monospace' }}>⏱ {mmss}</span>}
        </div>
      </div>

      {/* Status tracker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>STATUS</div>
        {STEPS.map((step, i) => {
          const done = !failed && currentIdx > i
          const active = !failed && currentIdx === i
          const color = active ? (DOT_COLOR[status] ?? 'var(--accent)') : done ? '#22c55e' : 'var(--border)'
          return (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, animation: active ? 'pulse 1.2s ease-in-out infinite' : undefined }} />
              <span style={{ fontSize: 13, color: done || active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>{step.label}</span>
            </div>
          )
        })}
        {failed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#fca5a5', fontWeight: 600, textTransform: 'capitalize' }}>{status}</span>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        You will receive ≈ <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{exchange.amountTo} {toLabel}</span>
        <div style={{ marginTop: 2 }}>Destination: <span style={{ fontFamily: 'monospace' }}>{shorten(exchange.addressTo)}</span></div>
      </div>

      <button type="button" onClick={onNewExchange} style={{ padding: '11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Start New Exchange
      </button>
    </div>
  )
}
