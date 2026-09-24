/**
 * CrossChainStatusCard.tsx — what the bridge is actually doing with the user's
 * money after the source transaction goes out.
 *
 * WHAT THIS USED TO GET WRONG
 *
 * It read the coarse `status` field, where LI.FI reports `DONE` for three
 * completely different outcomes. A refund and a partial delivery both rendered
 * as "✓ Bridge complete — Received <the token you asked for>", using the
 * REQUESTED symbol rather than whatever actually arrived. A user whose swap had
 * been reverted and refunded was told it had succeeded.
 *
 * It also claimed "Source transaction confirmed" the instant a hash existed. A
 * broadcast hash is not a confirmation — the transaction can still revert.
 *
 * Now the canonical state from src/shared/swap-lifecycle.ts decides the heading,
 * the wording and the colour, and the delivered asset is named from what the
 * bridge says arrived.
 *
 * SURVIVING A RESTART
 *
 * The poll still runs while this card is mounted, because that is what makes the
 * screen live. It is no longer the only record: the privileged layer opened a
 * persistent session when the transaction was broadcast, and reconciles it on
 * demand. Closing this screen, locking, or restarting no longer loses the swap —
 * see src/main/swap-sessions.ts.
 */

import { useEffect, useRef, useState } from 'react'
import type { NormalizedSwapQuote, CrossSwapStatus } from '../types/wallet'
import type { SwapLifecycleState } from '../../shared/swap-lifecycle'

interface Props {
  quote: NormalizedSwapQuote
  txHash: string
  explorerUrl: string
  toSymbol: string
  toDecimals: number
  onDone: () => void
  /** Called once when the swap reaches a final state — refresh balances then. */
  onSettled?: (state: SwapLifecycleState) => void
}

function rawToHuman(raw: string | null | undefined, decimals: number): number | null {
  if (!raw) return null
  try { return Number(BigInt(raw)) / 10 ** decimals } catch { return Number(raw) / 10 ** decimals }
}

/** Heading per canonical state. Only `completed` is success, and it says so alone. */
const HEADINGS: Record<SwapLifecycleState, { text: string; color: string }> = {
  'source-submitted': { text: '⏳ Sent — waiting for confirmation', color: '#38bdf8' },
  'source-confirmed': { text: '⏳ Confirmed — bridging', color: '#38bdf8' },
  bridging: { text: '⏳ Bridging…', color: '#38bdf8' },
  completed: { text: '✓ Swap complete', color: '#22c55e' },
  partial: { text: '⚠ Delivered a different asset', color: '#facc15' },
  'refund-pending': { text: '⚠ Refund in progress', color: '#facc15' },
  refunded: { text: '↩ Refunded — the swap did not happen', color: '#facc15' },
  failed: { text: '⚠ Bridge failed', color: '#fca5a5' },
  unknown: { text: '⏳ Waiting for the bridge', color: '#38bdf8' },
}

const TERMINAL = new Set<SwapLifecycleState>(['completed', 'partial', 'refunded', 'failed'])

export function CrossChainStatusCard({ quote, txHash, explorerUrl, toSymbol, toDecimals, onDone, onSettled }: Props) {
  const [status, setStatus] = useState<CrossSwapStatus>({ status: 'pending', state: 'source-submitted', error: null })
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
          bridgeTool: quote.bridgeTool ?? null,
          requestId: quote.requestId ?? null,
          // Without this a refund is indistinguishable from a delivery: the asset
          // that comes back on a refund is the one the user SOLD.
          expectedToTokenAddress: quote.toTokenAddress,
          // So the delivery is MEASURED on-chain and checked against the floor
          // the user approved, rather than taken from the provider's figure.
          recipient: quote.toAddress ?? null,
          minBuyAmountRaw: quote.minBuyAmountRaw ?? null,
        })
        if (!alive.current) return
        setStatus(next)
        const nextState = (next.state ?? 'unknown') as SwapLifecycleState
        if (TERMINAL.has(nextState)) {
          // The poll above is read-only; this is what RECORDS the outcome in the
          // persisted session (and its fee accounting). Without it the stored
          // session stayed 'bridging' after the swap had long completed.
          window.wallet.swapReconcile?.().catch(() => { /* evidence store; never blocks the UI */ })
          onSettled?.(nextState)
        }
        // Keep polling for everything that is not terminal. `unknown` in
        // particular IS worth polling — it usually means the bridge has not
        // indexed the source transaction yet, which resolves on its own.
        if (!TERMINAL.has((next.state ?? 'unknown') as SwapLifecycleState)) timer = setTimeout(poll, 10_000)
      } catch {
        if (alive.current) timer = setTimeout(poll, 10_000)
      }
    }
    timer = setTimeout(poll, 10_000)
    return () => { alive.current = false; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash])

  const state = (status.state ?? 'source-submitted') as SwapLifecycleState
  const heading = HEADINGS[state] ?? HEADINGS.unknown
  const terminal = TERMINAL.has(state)
  const settled = state === 'completed'

  // What ACTUALLY arrived, named from the bridge's own answer. On a refund this
  // is the token that was sold, so using `toSymbol` here would relabel the user's
  // returned funds as the token they never received.
  const delivered = status.delivered ?? null
  const deliveredSymbol = delivered?.symbol ?? (settled ? toSymbol : null)
  const deliveredAmount = rawToHuman(
    delivered?.amountRaw ?? status.receivedAmountRaw,
    delivered?.decimals ?? toDecimals,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: heading.color }}>{heading.text}</div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {/* "Submitted", not "confirmed": all we know at this point is that a
              hash exists. The bridge's own status is what upgrades that. */}
          Source transaction submitted on <strong style={{ color: 'var(--text-primary)' }}>{quote.fromChain}</strong>.
          {!terminal && <> Funds are being bridged to <strong style={{ color: 'var(--text-primary)' }}>{quote.toChain}</strong>. This can take a few minutes — you can leave this screen, and it will keep tracking.</>}
        </div>

        <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
          View source transaction ↗
        </a>

        {/* The provider's explanation of a non-success outcome, verbatim from the
            lifecycle mapper rather than reworded into something reassuring. */}
        {status.message && (
          <div style={{ fontSize: 12, color: settled ? 'var(--text-secondary)' : '#facc15' }}>
            {status.message}
          </div>
        )}

        {(settled || state === 'partial' || state === 'refunded') && (
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            {deliveredAmount != null && deliveredSymbol
              ? <>
                  Received <strong>{deliveredAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {deliveredSymbol}</strong>{state === 'refunded' ? ` back on ${quote.fromChain}` : ` on ${quote.toChain}`}.
                  {/* Say where the number came from: a provider's status figure can be
                      derived from the quote rather than observed (LI.FI's is). */}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {status.deliveredAmountSource === 'onchain'
                      ? 'Confirmed on-chain from the destination transaction.'
                      : `As reported by ${quote.provider === 'lifi' ? 'LI.FI' : quote.provider}; not yet confirmed on-chain.`}
                  </div>
                </>
              : state === 'refunded'
                ? `Your original funds were returned on ${quote.fromChain}.`
                : `Delivery reported on ${quote.toChain}.`}
            {status.destExplorerUrl && (
              <div style={{ marginTop: 4 }}>
                <a href={status.destExplorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  View destination transaction ↗
                </a>
              </div>
            )}
          </div>
        )}

        {state === 'failed' && (
          <div style={{ fontSize: 12, color: '#fca5a5' }}>
            The bridge reported a failure and did not indicate a refund. Check the source explorer and your balances
            before retrying — do not assume the funds were returned.
          </div>
        )}

        {!terminal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.2s ease-in-out infinite' }} />
            {status.providerSubstatus ?? status.substatus ?? 'Waiting for destination delivery…'}
          </div>
        )}
      </div>

      <button type="button" onClick={onDone} style={{ padding: '11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {terminal ? 'Done' : 'New Swap'}
      </button>
    </div>
  )
}
