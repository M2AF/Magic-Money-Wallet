/**
 * SwapQuoteCard.tsx — DEX quote summary: rate, price impact, provider, slippage,
 * and the 12s refresh countdown. Turns warning-yellow when the price moved.
 */

import type { NormalizedSwapQuote } from '../types/swap'

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

function rawToHuman(raw: string, decimals: number): number {
  if (!raw) return 0
  try { return Number(BigInt(raw)) / 10 ** decimals } catch { return Number(raw) / 10 ** decimals }
}
function fmt(n: number): string {
  if (!isFinite(n) || n === 0) return '0'
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return n.toPrecision(4)
}

export function SwapQuoteCard({ quote, fromSymbol, toSymbol, fromDecimals, toDecimals, autoBps, isAuto, refreshIn, priceChanged }: Props) {
  const sell = rawToHuman(quote.sellAmountRaw, fromDecimals)
  const buy = rawToHuman(quote.buyAmountRaw, toDecimals)
  const rate = sell > 0 ? buy / sell : 0
  const impact = quote.priceImpactPct

  const border = priceChanged ? 'rgba(250,204,21,0.5)' : 'var(--border)'
  const bg = priceChanged ? 'rgba(250,204,21,0.06)' : 'var(--bg-card)'

  const row = (l: string, r: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{l}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{r}</span>
    </div>
  )

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      {row('Rate', `1 ${fromSymbol} = ${fmt(rate)} ${toSymbol}`)}
      {row('Price impact', <span style={{ color: impact > 3 ? '#fca5a5' : 'var(--text-primary)' }}>{impact.toFixed(2)}%</span>)}
      {row('Via', quote.provider)}
      {row('Slippage', `${isAuto ? 'Auto · ' : ''}${(quote.slippageBps / 100).toFixed(2)}%`)}
      {priceChanged
        ? <div style={{ fontSize: 12, color: '#facc15', fontWeight: 600 }}>⚠ Price moved — review the new rate</div>
        : refreshIn != null && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>⏱ Refreshing in {refreshIn}s…</div>}
    </div>
  )
}
