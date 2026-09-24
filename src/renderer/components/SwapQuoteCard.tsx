/**
 * SwapQuoteCard.tsx — what this trade actually costs and what actually arrives.
 *
 * WHAT CHANGED AND WHY
 *
 * The card used to show one row, "Fee 0.90%", derived from a single `feeBps`
 * number. That was wrong in three separate ways at once:
 *
 *   • a percentage is not an amount, and the user pays an amount
 *   • some providers take their cut from the INPUT and some from the OUTPUT, so
 *     "0.90%" did not even identify which token the number referred to
 *   • provider and bridge costs were invisible, which made the app fee look like
 *     the whole cost of the trade
 *
 * Now the Magic Money fee is shown as a real amount in its real token, material
 * external costs are listed separately as costs the app does not receive, and
 * the two numbers that decide the trade — what you receive, and the floor below
 * which it reverts — are given their own emphasis.
 *
 * Every number here comes from the privileged layer, which has already verified
 * it (src/main/swap-fee.ts). This component never computes a fee, and never
 * presents an estimate as a guarantee.
 */

import type { NormalizedSwapQuote, AppFeeRecord, ExternalFeeRecord } from '../types/swap'
import { classifyFeeStatus } from '../../shared/swap-fee-policy'
import { isGuaranteedMinimum, describeMinReceivedScope } from '../../shared/swap-destination'
import { solanaRequiredLamports } from '../../shared/solana-upfront-cost'

interface Props {
  quote: NormalizedSwapQuote
  fromSymbol: string
  toSymbol: string
  fromDecimals: number
  toDecimals: number
  autoBps: number
  isAuto: boolean
  refreshIn: number | null      // seconds until next refresh (null = paused)
  priceChanged: boolean
}

/**
 * Raw base units → a human number for DISPLAY only. Integer and fractional parts
 * are divided separately in the BigInt domain because `Number(BigInt(raw))` alone
 * loses precision above 2^53 — which an 18-decimal token passes easily.
 */
function rawToHuman(raw: string, decimals: number): number {
  if (!raw || !/^[0-9]+$/.test(raw)) return 0
  try {
    const v = BigInt(raw)
    const d = BigInt(10) ** BigInt(decimals)
    return Number(v / d) + Number(v % d) / Number(d)
  } catch { return 0 }
}
function fmt(n: number): string {
  if (!isFinite(n) || n === 0) return '0'
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return n.toPrecision(4)
}

/**
 * Render a fee amount in the token it is actually charged in.
 *
 * Falls back to the symbol/decimals of whichever side the fee came off when the
 * record does not carry its own — never to the output token by default, which
 * would mislabel every input-side fee (LI.FI's, for one).
 */
function feeAmountLabel(
  record: AppFeeRecord, fromSymbol: string, toSymbol: string, fromDecimals: number, toDecimals: number,
): string | null {
  if (!record.amountRaw || !/^[0-9]+$/.test(record.amountRaw)) return null
  const onInput = record.base === 'input'
  const decimals = record.tokenDecimals ?? (onInput ? fromDecimals : toDecimals)
  const symbol = record.tokenSymbol ?? (onInput ? fromSymbol : toSymbol)
  return `${fmt(rawToHuman(record.amountRaw, decimals))} ${symbol}`
}

function externalLabel(fee: ExternalFeeRecord, fallbackSymbol: string, fallbackDecimals: number): string | null {
  if (!fee.amountRaw || !/^[0-9]+$/.test(fee.amountRaw)) return null
  const decimals = fee.tokenDecimals ?? fallbackDecimals
  const symbol = fee.tokenSymbol ?? fallbackSymbol
  return `${fmt(rawToHuman(fee.amountRaw, decimals))} ${symbol}`
}

export function SwapQuoteCard({ quote, fromSymbol, toSymbol, fromDecimals, toDecimals, autoBps, isAuto, refreshIn, priceChanged }: Props) {
  const sell = rawToHuman(quote.sellAmountRaw, fromDecimals)
  const buy = rawToHuman(quote.buyAmountRaw, toDecimals)
  const rate = sell > 0 ? buy / sell : 0
  const impact = quote.priceImpactPct
  const minReceived = quote.minBuyAmountRaw ? rawToHuman(quote.minBuyAmountRaw, toDecimals) : null
  // What the minimum ACTUALLY guarantees, as the privileged layer computed it from
  // the route. `minReceivedSource === 'provider'` alone is not enough: a
  // provider-stated floor on a cross-chain route governs only the destination leg.
  const scope = quote.destination?.minReceivedScope ?? (quote.minReceivedSource === 'provider' ? 'atomic' : 'estimate')
  const guaranteed = isGuaranteedMinimum(scope)
  const fallback = quote.destination?.fallback ?? null

  const appFee = quote.appFee ?? null
  // Three states, never two. "No fee" and "we could not confirm the fee" are
  // different claims, and collapsing them would tell the user something we do
  // not know. `classifyFeeStatus` is the shared derivation, so the card cannot
  // drift from what the accounting counts.
  const feeStatus = classifyFeeStatus(appFee)
  const appFeeAmount = appFee ? feeAmountLabel(appFee, fromSymbol, toSymbol, fromDecimals, toDecimals) : null
  const appFeePct = appFee ? ((appFee.appliedBps ?? appFee.requestedBps) / 100).toFixed(2) : null
  const externals = (quote.externalFees ?? []).filter(f => f.amountRaw && f.amountRaw !== '0')

  const border = priceChanged ? 'rgba(250,204,21,0.5)' : 'var(--border)'
  const bg = priceChanged ? 'rgba(250,204,21,0.06)' : 'var(--bg-card)'

  const row = (l: string, r: React.ReactNode, title?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }} title={title}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{l}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', minWidth: 0 }}>{r}</span>
    </div>
  )

  const viaLabel = quote.bridgeTool ? `${quote.provider} · ${quote.bridgeTool}` : quote.provider
  const eta = quote.estimatedDurationSec && quote.estimatedDurationSec > 0
    ? (quote.estimatedDurationSec >= 60 ? `~${Math.round(quote.estimatedDurationSec / 60)} min` : `~${quote.estimatedDurationSec}s`)
    : null

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      {row('Rate', `1 ${fromSymbol} = ${fmt(rate)} ${toSymbol}`)}
      {quote.isCrossChain && row('Route', <span style={{ color: '#38bdf8' }}>Cross-chain</span>)}
      {impact > 0 && row('Price impact', <span style={{ color: impact > 3 ? '#fca5a5' : 'var(--text-primary)' }}>{impact.toFixed(2)}%</span>)}
      {/* "Via", not "best price". Routing prefers a route that pays the app fee
          before it compares price, so the served quote is the best fee-paying
          route -- which is not necessarily the best route that exists. */}
      {row('Via', viaLabel)}
      {eta && row('Est. time', eta)}

      {/* ── Costs ─────────────────────────────────────────────────────────────
          Ours first, named as ours, as an amount. The percentage stays alongside
          it because that is the policy the user agreed to, but the amount is the
          thing they actually give up. */}
      {feeStatus === 'verified' && appFee && appFeeAmount && row(
        'Magic Money fee',
        <>
          {appFeeAmount}
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {appFeePct}%</span>
        </>,
        appFee.base === 'input'
          ? 'Charged on the amount you sell, by the route provider, as part of this swap.'
          : 'Charged on the amount you receive, by the route provider, as part of this swap.',
      )}
      {/* Tier 2. Says only what is true: Magic Money takes nothing here. The
          provider and network costs below are unaffected, which is why this row
          reads "no Magic Money fee" and never "free". */}
      {feeStatus === 'confirmed-none' && row(
        'Magic Money fee',
        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>None on this route</span>,
        'This route cannot pay Magic Money a fee, so none is charged. Provider, bridge and network costs still apply.',
      )}
      {/* The honest third case. Shown rather than hidden, because the
          alternative is implying a zero we cannot substantiate. */}
      {feeStatus === 'unknown' && row(
        'Magic Money fee',
        <span style={{ fontWeight: 500, color: '#facc15' }}>Not confirmed</span>,
        'This route did not confirm whether a Magic Money fee was applied. It is not counted as charged or as free.',
      )}
      {/* Costs charged by someone else. Listed apart from ours on purpose: a
          bridge's cut is a cost to the user and is not Magic Money revenue. */}
      {externals.map((fee, i) => {
        const label = externalLabel(fee, appFee?.base === 'input' ? fromSymbol : toSymbol,
          appFee?.base === 'input' ? fromDecimals : toDecimals)
        return label ? (
          <div key={`${fee.name}-${i}`}>
            {row(fee.name, <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>,
              'Charged by the route provider, not by Magic Money. Applies whether or not this route pays an app fee.')}
          </div>
        ) : null
      })}
      {/* Solana: what THIS transaction needs up front, read from it (fees, new or
          temporary token accounts at current rent). "At least" when a program
          in the route may take more than can be read before signing. */}
      {quote.solanaCost && (() => {
        const c = quote.solanaCost
        const req = solanaRequiredLamports(c)
        const nonSale = req.lamports - BigInt(c.saleLamports)
        const temp = c.newAccounts.filter(a => a.refundedInTx).length
        const created = c.newAccounts.length - temp
        const detail = [
          `fees ${(Number(BigInt(c.baseFeeLamports) + BigInt(c.priorityFeeLamports)) / 1e9).toFixed(6)} SOL`,
          created ? `${created} new token account${created > 1 ? 's' : ''}` : '',
          temp ? `${temp} temporary account${temp > 1 ? 's' : ''} (rent returned after the swap)` : '',
          c.measuredLamports != null ? 'measured by simulation' : '',
        ].filter(Boolean).join(' · ')
        return row(
          'SOL needed up front',
          <span>
            {req.exact ? '' : 'at least '}{(Number(nonSale > 0n ? nonSale : 0n) / 1e9).toFixed(6)} SOL
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{c.saleLamports !== '0' ? ' + amount sold' : ''}</span>
          </span>,
          `${detail}.${c.incompleteReason ? ` Lower bound: ${c.incompleteReason}.` : ''}`,
        )
      })()}
      {row('Slippage', `${isAuto ? 'Auto · ' : ''}${(quote.slippageBps / 100).toFixed(2)}%`)}

      {/* ── What you end up with ──────────────────────────────────────────────
          `buyAmountRaw` is normalized to the NET receipt in every adapter, so
          this is after all the deductions listed above — not a gross figure the
          fees still have to come out of. */}
      <div style={{ height: 1, background: 'var(--border)', margin: '1px 0' }} />
      {row(
        'You receive',
        <span style={{ fontSize: 13 }}>{fmt(buy)} {toSymbol}</span>,
        'The expected amount after the fees listed above.',
      )}
      {minReceived != null && row(
        'Minimum received',
        <span style={{ color: guaranteed ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {fmt(minReceived)} {toSymbol}
          {!guaranteed && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {describeMinReceivedScope(scope)}</span>}
        </span>,
        scope === 'atomic'
          ? 'The swap reverts if it would deliver less than this, and you keep what you sold.'
          : scope === 'destination-conditional'
            ? 'This applies to the final swap on the destination chain only. Your source transaction settles first, '
              + 'so missing it does not undo the swap — see below for what you would receive instead.'
            : scope === 'provider-guaranteed'
              ? 'The provider commits to this through its own mechanism. It is not enforced by the transaction you sign.'
              : 'Calculated from the quoted output and your slippage. Nothing enforces it.',
      )}

      {/* The failure mode is part of what the user approves: shown BEFORE signing,
          bound into the stored intent, and never softened into a refund promise. */}
      {fallback && (
        <div style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)',
          background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.3)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
        }}>
          <strong style={{ color: '#facc15' }}>If the destination swap fails: </strong>{fallback.summary}
        </div>
      )}

      {priceChanged
        ? <div style={{ fontSize: 12, color: '#facc15', fontWeight: 600 }}>⚠ Price moved — review the new rate</div>
        : refreshIn != null && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>⏱ Refreshing in {refreshIn}s…</div>}
    </div>
  )
}
