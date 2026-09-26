/**
 * CardanoOrderStatusCard.tsx — what happened to a Minswap order after it was placed.
 *
 * A Cardano swap here is a batcher ORDER, not an atomic trade: the transaction
 * the wallet submitted only locks the sell amount at Minswap's order script, and
 * a batcher trades it afterwards. So "submitted" is not "swapped", and the
 * bridge card's wording ("Bridging…") would be wrong. Status is measured on
 * Cardano by the privileged layer (src/main/cardano-swap.ts); nothing here asks
 * Minswap what happened.
 *
 * The one thing this card must never hide: an order the batcher cannot fill at
 * the user's minimum is NOT refunded automatically. It stays open — tokens and
 * the ADA deposit with it — until its owner cancels it. The wallet does not
 * build cancellations itself yet, so the recovery path is Minswap's own Orders
 * page in the wallet's browser, signed through the normal CIP-30 prompt.
 */

import { useEffect, useRef, useState } from 'react'
import type { NormalizedSwapQuote, CrossSwapStatus } from '../types/wallet'
import type { SwapLifecycleState } from '../../shared/swap-lifecycle'

/** Minswap's order management page (app.minswap.org/orders redirects here; checked 2026-09-26). */
const MINSWAP_ORDERS_URL = 'https://minswap.org/orders'

interface Props {
  quote: NormalizedSwapQuote
  txHash: string
  explorerUrl: string
  toSymbol: string
  toDecimals: number
  onDone: () => void
  onSettled?: (state: SwapLifecycleState) => void
}

const HEADINGS: Partial<Record<SwapLifecycleState, { text: string; color: string }>> = {
  'source-submitted': { text: '⏳ Order sent — waiting for Cardano to confirm it', color: '#38bdf8' },
  'source-confirmed': { text: '⏳ Order placed — waiting for a Minswap batcher', color: '#38bdf8' },
  completed: { text: '✓ Swap complete', color: '#22c55e' },
  partial: { text: '⚠ The order paid out something else', color: '#facc15' },
  refunded: { text: '↩ Order cancelled — the swap did not happen', color: '#facc15' },
  failed: { text: '⚠ The order failed', color: '#fca5a5' },
  unknown: { text: '⏳ Checking the order on Cardano…', color: '#38bdf8' },
}
const TERMINAL = new Set<SwapLifecycleState>(['completed', 'partial', 'refunded', 'failed'])
/** After this long without a fill, the price has probably moved past the minimum. */
const LIKELY_STUCK_MS = 5 * 60_000

function openInWalletBrowser(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabs = (globalThis as any).chrome?.tabs
  if (tabs) { tabs.create({ url }); return }
  if (window.wallet.openBrowserInNewTab) { window.wallet.openBrowserInNewTab(url); return }
  window.wallet.openBrowser()
  setTimeout(() => { window.wallet.browserNavigate(url) }, 400)
}

function rawToHuman(raw: string | null | undefined, decimals: number): number | null {
  if (!raw || !/^[0-9]+$/.test(raw)) return null
  const v = BigInt(raw)
  const d = 10n ** BigInt(decimals)
  return Number(v / d) + Number(v % d) / Number(d)
}

export function CardanoOrderStatusCard({ quote, txHash, explorerUrl, toSymbol, toDecimals, onDone, onSettled }: Props) {
  const [status, setStatus] = useState<CrossSwapStatus>({ status: 'pending', state: 'source-submitted', error: null })
  const placedAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await window.wallet.swapCrossStatus({
          provider: quote.provider,
          txHash,
          fromChain: quote.fromChain,
          toChain: quote.toChain,
          expectedToTokenAddress: quote.toTokenAddress,
          recipient: quote.toAddress ?? null,
          minBuyAmountRaw: quote.minBuyAmountRaw ?? null,
        })
        if (!alive.current) return
        setStatus(next)
        setNow(Date.now())
        const state = (next.state ?? 'unknown') as SwapLifecycleState
        if (TERMINAL.has(state)) {
          window.wallet.swapReconcile?.().catch(() => { /* evidence store; never blocks the UI */ })
          onSettled?.(state)
          return
        }
      } catch { /* a failed read is not a verdict — poll again */ }
      if (alive.current) timer = setTimeout(poll, 15_000)
    }
    timer = setTimeout(poll, 8_000)
    return () => { alive.current = false; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash])

  const state = (status.state ?? 'source-submitted') as SwapLifecycleState
  const heading = HEADINGS[state] ?? HEADINGS.unknown!
  const terminal = TERMINAL.has(state)
  const open = state === 'source-confirmed' || state === 'unknown'
  const likelyStuck = open && now - placedAt.current > LIKELY_STUCK_MS
  const cost = quote.cardanoCost
  const deposit = cost ? rawToHuman(cost.depositLovelace, 6) : null
  const received = rawToHuman(status.delivered?.amountRaw ?? status.receivedAmountRaw, toDecimals)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: heading.color }}>{heading.text}</div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Your transaction placed a <strong style={{ color: 'var(--text-primary)' }}>Minswap order</strong>. A batcher
          trades it — usually within a minute or two — and sends the {toSymbol} to your wallet
          {deposit != null ? <>, together with the {deposit} ADA deposit</> : null}.
        </div>

        <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
          View order transaction ↗
        </a>

        {status.message && (
          <div style={{ fontSize: 12, color: state === 'completed' ? 'var(--text-secondary)' : '#facc15', lineHeight: 1.5 }}>
            {status.message}
          </div>
        )}

        {state === 'completed' && received != null && (
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            Received <strong>{received.toLocaleString('en-US', { maximumFractionDigits: 6 })} {toSymbol}</strong>.
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Measured on Cardano from the transaction that filled the order.</div>
          </div>
        )}

        {status.destExplorerUrl && terminal && (
          <a href={status.destExplorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
            View {state === 'refunded' ? 'cancellation' : 'fill'} transaction ↗
          </a>
        )}

        {open && (
          <div style={{
            fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)',
            background: likelyStuck ? 'rgba(250,204,21,0.08)' : 'transparent',
            border: likelyStuck ? '1px solid rgba(250,204,21,0.3)' : 'none',
            borderRadius: 'var(--radius-sm)', padding: likelyStuck ? '8px 10px' : 0,
          }}>
            {likelyStuck
              ? <>This order has not been filled yet. If the price has moved past your minimum it will <strong>not</strong> be
                  refunded automatically — cancel it on Minswap to get your tokens and deposit back.</>
              : <>If the price moves past your minimum before a batcher fills it, the order stays open until you cancel it.</>}
            <button type="button" onClick={() => openInWalletBrowser(MINSWAP_ORDERS_URL)}
              style={{ display: 'block', marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Manage or cancel on Minswap ↗
            </button>
          </div>
        )}

        {!terminal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.2s ease-in-out infinite' }} />
            You can leave this screen — the wallet keeps tracking the order.
          </div>
        )}
      </div>

      <button type="button" onClick={onDone} style={{ padding: '11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {terminal ? 'Done' : 'New Swap'}
      </button>
    </div>
  )
}
