/**
 * CrossChainStatusCard.tsx — shown after a cross-chain DEX swap's source tx is
 * broadcast. The source transaction is confirmed, but the bridge delivers the
 * destination asset asynchronously, so we poll swapCrossStatus (every 10s) until
 * the bridge reports done/failed. Mirrors the SimpleSwap ExchangeStatusCard UX.
 */

import { useEffect, useRef, useState } from 'react'
import type { NormalizedSwapQuote, CrossSwapStatus } from '../types/wallet'

interface Props {
  quote: NormalizedSwapQuote
  txHash: string
  explorerUrl: string
  toSymbol: string
  toDecimals: number
  onDone: () => void
}

function rawToHuman(raw: string | null | undefined, decimals: number): number | null {
  if (!raw) return null
  try { return Number(BigInt(raw)) / 10 ** decimals } catch { return Number(raw) / 10 ** decimals }
}

export function CrossChainStatusCard({ quote, txHash, explorerUrl, toSymbol, toDecimals, onDone }: Props) {
  const [status, setStatus] = useState<CrossSwapStatus>({ status: 'pending', error: null })
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
        })
        if (!alive.current) return
        setStatus(next)
        if (next.status === 'pending' || next.status === 'unknown') timer = setTimeout(poll, 10_000)
      } catch {
        if (alive.current) timer = setTimeout(poll, 10_000)
      }
    }
    timer = setTimeout(poll, 10_000)
    return () => { alive.current = false; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash])

  const done = status.status === 'done'
  const failed = status.status === 'failed'
  const received = rawToHuman(status.receivedAmountRaw, toDecimals)
  const headColor = done ? '#22c55e' : failed ? '#fca5a5' : '#38bdf8'
  const headText = done ? '✓ Bridge complete' : failed ? '⚠ Bridge failed' : '⏳ Bridging…'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: headColor }}>{headText}</div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Source transaction confirmed on <strong style={{ color: 'var(--text-primary)' }}>{quote.fromChain}</strong>.
          {!done && !failed && ' Funds are being bridged to '}
          {!done && !failed && <strong style={{ color: 'var(--text-primary)' }}>{quote.toChain}</strong>}
          {!done && !failed && '. This can take a few minutes — you can leave this screen.'}
        </div>

        <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
          View source transaction ↗
        </a>

        {done && (
          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            Received {received != null ? <strong>{received.toLocaleString('en-US', { maximumFractionDigits: 6 })} {toSymbol}</strong> : `your ${toSymbol}`} on {quote.toChain}.
            {status.destExplorerUrl && (
              <div style={{ marginTop: 4 }}>
                <a href={status.destExplorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  View destination transaction ↗
                </a>
              </div>
            )}
          </div>
        )}

        {failed && (
          <div style={{ fontSize: 12, color: '#fca5a5' }}>
            The bridge reported a failure. Cross-chain bridges typically refund the source asset automatically — check the source explorer and your balances.
          </div>
        )}

        {!done && !failed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.2s ease-in-out infinite' }} />
            {status.substatus ? status.substatus : 'Waiting for destination delivery…'}
          </div>
        )}
      </div>

      <button type="button" onClick={onDone} style={{ padding: '11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {done || failed ? 'Done' : 'New Swap'}
      </button>
    </div>
  )
}
