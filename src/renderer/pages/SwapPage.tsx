/**
 * SwapPage.tsx — Cross-chain swap (SwapKit)
 *
 * Stage 1: live quoting (window.wallet.swapQuote).
 * Stage 2: execution — pick a route, confirm, and sign+broadcast with the
 * wallet's own keys (window.wallet.swapExecute), then track status
 * (window.wallet.swapTrack). Execution is supported for EVM-source swaps
 * (ETH, AVAX, …); other source chains can be quoted but not yet signed here.
 */

import { useState, useRef, useEffect } from 'react'
import type { WalletAddresses, SwapQuoteResult, SwapRoute, SwapExecuteResult } from '../types/wallet'
import { HeaderToolbar } from '../components/HeaderToolbar'

// Curated set of assets with broad cross-chain liquidity (THORChain / Chainflip).
const SWAP_ASSETS = [
  { id: 'BTC.BTC',  label: 'BTC',  chain: 'Bitcoin' },
  { id: 'ETH.ETH',  label: 'ETH',  chain: 'Ethereum' },
  { id: 'ETH.USDC-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', label: 'USDC', chain: 'Ethereum' },
  { id: 'ETH.USDT-0xdAC17F958D2ee523a2206206994597C13D831ec7', label: 'USDT', chain: 'Ethereum' },
  { id: 'AVAX.AVAX', label: 'AVAX', chain: 'Avalanche' },
  { id: 'BSC.BNB',   label: 'BNB',  chain: 'BNB Chain' },
  { id: 'SOL.SOL',   label: 'SOL',  chain: 'Solana' },
  { id: 'GAIA.ATOM', label: 'ATOM', chain: 'Cosmos' },
  { id: 'DOGE.DOGE', label: 'DOGE', chain: 'Dogecoin' },
  { id: 'LTC.LTC',   label: 'LTC',  chain: 'Litecoin' },
  { id: 'BCH.BCH',   label: 'BCH',  chain: 'Bitcoin Cash' },
] as const

// SwapKit chain prefix → wallet address used to RECEIVE the buy asset.
const RECEIVE_ADDR: Record<string, 'evm' | 'bitcoin' | 'solana' | 'cardano'> = {
  ETH: 'evm', AVAX: 'evm', BSC: 'evm', ARB: 'evm', OP: 'evm', BASE: 'evm',
  MATIC: 'evm', POLYGON: 'evm', BLAST: 'evm', GNOSIS: 'evm',
  BTC: 'bitcoin', SOL: 'solana', ADA: 'cardano',
}
// EVM sell chains the wallet can sign calldata for (matches tx-sender's EVM_CHAINS).
const SIGNABLE_SELL = new Set(['ETH', 'AVAX', 'ARB', 'OP', 'BASE', 'MATIC', 'POLYGON', 'BLAST', 'GNOSIS'])

const chainOf = (asset: string) => asset.split('.')[0]
const labelFor = (id: string) => SWAP_ASSETS.find(a => a.id === id)?.label ?? id.split('.')[1]?.split('-')[0] ?? id

function fmtAmount(s: string): string {
  const n = parseFloat(s)
  if (!isFinite(n)) return s
  if (n === 0) return '0'
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return n.toPrecision(4)
}

function fmtTime(sec?: number): string | null {
  if (!sec || sec <= 0) return null
  if (sec < 60) return `~${Math.round(sec)}s`
  return `~${Math.round(sec / 60)}m`
}

const TAG_COLOR: Record<string, string> = {
  RECOMMENDED: '#22c55e', FASTEST: '#38bdf8', CHEAPEST: '#a78bfa',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending — detected in mempool', swapping: 'Swapping…',
  completed: 'Completed', refunded: 'Refunded (slippage)', failed: 'Failed',
  not_started: 'Awaiting inbound tx', unknown: 'Submitted',
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-body)',
  cursor: 'pointer', outline: 'none', minWidth: 120,
}

interface Props {
  addresses: WalletAddresses
  onWcOpen?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
  onProfile?: () => void
  onSettings?: () => void
}

export function SwapPage({ addresses, onWcOpen, wcActiveSessions, wcPending, onProfile, onSettings }: Props) {
  const [sellAsset, setSellAsset] = useState<string>('ETH.ETH')
  const [buyAsset,  setBuyAsset]  = useState<string>('BTC.BTC')
  const [amount,    setAmount]    = useState<string>('')
  const [slippage,  setSlippage]  = useState<number>(3)
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<SwapQuoteResult | null>(null)

  // Execution state
  const [confirmRoute, setConfirmRoute] = useState<SwapRoute | null>(null)
  const [execState, setExecState] = useState<'idle' | 'executing' | 'done' | 'error'>('idle')
  const [execResult, setExecResult] = useState<SwapExecuteResult | null>(null)
  const [execError, setExecError] = useState<string | null>(null)
  const [trackStatus, setTrackStatus] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const flip = () => { setSellAsset(buyAsset); setBuyAsset(sellAsset); setResult(null) }

  const getQuote = async () => {
    setLoading(true); setResult(null)
    try {
      const r = await window.wallet.swapQuote({ sellAsset, buyAsset, sellAmount: amount.trim(), slippage })
      setResult(r)
    } catch (e) {
      setResult({ quoteId: null, routes: [], error: e instanceof Error ? e.message : 'Quote failed' })
    } finally {
      setLoading(false)
    }
  }

  // null = executable; string = reason it's blocked
  const execBlockReason = (route: SwapRoute): string | null => {
    const sc = chainOf(route.sellAsset)
    const bc = chainOf(route.buyAsset)
    if (!SIGNABLE_SELL.has(sc)) return `Signing from ${sc} isn't supported yet — sell an EVM asset (ETH, AVAX) to swap.`
    const key = RECEIVE_ADDR[bc]
    if (!key || !addresses[key]) return `This wallet has no ${bc} address to receive into.`
    return null
  }

  const pollTrack = async (hash: string, chainId: string) => {
    for (let i = 0; i < 20 && alive.current; i++) {
      try {
        const t = await window.wallet.swapTrack(hash, chainId)
        if (alive.current && t.status) setTrackStatus(t.status)
        if (t.status && ['completed', 'refunded', 'failed'].includes(t.status)) return
      } catch { /* keep polling */ }
      await new Promise(r => setTimeout(r, 12_000))
    }
  }

  const runSwap = async (route: SwapRoute) => {
    setExecState('executing'); setExecError(null); setExecResult(null); setTrackStatus(null)
    const buyChain = chainOf(route.buyAsset)
    const destKey = RECEIVE_ADDR[buyChain]
    try {
      const r = await window.wallet.swapExecute({
        routeId: route.routeId,
        sourceAddress: addresses.evm,
        destinationAddress: destKey ? addresses[destKey] : '',
        sellAsset: route.sellAsset,
      })
      if (!alive.current) return
      setExecResult(r); setExecState('done')
      pollTrack(r.txHash, String(r.chainId))
    } catch (e) {
      if (!alive.current) return
      setExecError(e instanceof Error ? e.message : 'Swap failed'); setExecState('error')
    }
  }

  const closeConfirm = () => {
    if (execState === 'executing') return
    setConfirmRoute(null); setExecState('idle'); setExecResult(null); setExecError(null); setTrackStatus(null)
  }

  const canQuote = !!amount && parseFloat(amount) > 0 && sellAsset !== buyAsset && !loading
  const best: SwapRoute | undefined = result?.routes[0]

  return (
    <div className="page fade-in" style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
      {/* Fixed header + divider — keeps the titlebar logo clear of scrolling content */}
      <div style={{ padding: '16px 16px 12px', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18 }}>Swap</h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Cross-chain swaps routed by SwapKit</div>
        </div>
        <HeaderToolbar
          onWcOpen={onWcOpen}
          wcActiveSessions={wcActiveSessions}
          wcPending={wcPending}
          onRefresh={getQuote}
          refreshing={loading}
          onProfile={onProfile}
          onSettings={onSettings}
        />
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Swap card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>YOU PAY</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" inputMode="decimal" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="0.0" min="0"
              style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)', outline: 'none' }}
            />
            <select value={sellAsset} onChange={e => { setSellAsset(e.target.value); setResult(null) }} style={selectStyle}>
              {SWAP_ASSETS.map(a => <option key={a.id} value={a.id}>{a.label} · {a.chain}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" onClick={flip} title="Flip direction"
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="7 10 12 5 17 10" /><polyline points="17 14 12 19 7 14" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>YOU RECEIVE</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)', color: best ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {best ? fmtAmount(best.expectedBuyAmount) : '—'}
            </div>
            <select value={buyAsset} onChange={e => { setBuyAsset(e.target.value); setResult(null) }} style={selectStyle}>
              {SWAP_ASSETS.map(a => <option key={a.id} value={a.id}>{a.label} · {a.chain}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Slippage</span>
          {[1, 3, 5].map(s => (
            <button key={s} type="button" onClick={() => setSlippage(s)}
              style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${slippage === s ? 'var(--border-active)' : 'var(--border)'}`, background: slippage === s ? 'var(--accent-dim)' : 'transparent', color: slippage === s ? 'var(--accent)' : 'var(--text-muted)' }}>
              {s}%
            </button>
          ))}
        </div>

        <button type="button" onClick={getQuote} disabled={!canQuote}
          style={{ marginTop: 2, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-body)', cursor: canQuote ? 'pointer' : 'not-allowed', background: canQuote ? 'var(--accent)' : 'var(--border)', color: canQuote ? '#0d0d0d' : 'var(--text-muted)' }}>
          {loading ? 'Fetching routes…' : 'Get Quote'}
        </button>
      </div>

      {result?.error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>
          {result.error}
        </div>
      )}

      {result && result.routes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
            {result.routes.length} ROUTE{result.routes.length > 1 ? 'S' : ''}
          </span>
          {result.routes.map((r, i) => {
            const t = fmtTime(r.estimatedTime?.total)
            const blocked = execBlockReason(r)
            return (
              <div key={r.routeId} style={{ background: 'var(--bg-card)', border: `1px solid ${i === 0 ? 'var(--border-active)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.providers.join(' → ') || 'Route'}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                    {fmtAmount(r.expectedBuyAmount)} {labelFor(r.buyAsset)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.tags.map(tag => (
                    <span key={tag} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '2px 7px', borderRadius: 99, color: TAG_COLOR[tag] ?? 'var(--text-muted)', background: `${TAG_COLOR[tag] ?? '#64748b'}22` }}>{tag}</span>
                  ))}
                  {t && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t}</span>}
                  {r.totalSlippageBps != null && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {(r.totalSlippageBps / 100).toFixed(2)}% slip</span>}
                </div>
                <button type="button"
                  onClick={() => { setConfirmRoute(r); setExecState('idle'); setExecError(null); setExecResult(null); setTrackStatus(null) }}
                  disabled={!!blocked}
                  title={blocked ?? 'Review and swap'}
                  style={{ marginTop: 2, padding: '9px', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: 13, fontWeight: 700, cursor: blocked ? 'not-allowed' : 'pointer', background: blocked ? 'var(--border)' : (i === 0 ? 'var(--accent)' : 'var(--accent-dim)'), color: blocked ? 'var(--text-muted)' : (i === 0 ? '#0d0d0d' : 'var(--accent)') }}>
                  {blocked ? 'Sell an EVM asset to swap' : 'Swap'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      </div>{/* end scrollable content */}

      {/* Confirm / execute overlay */}
      {confirmRoute && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Confirm Swap</span>
              <button type="button" onClick={closeConfirm} disabled={execState === 'executing'}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: execState === 'executing' ? 'default' : 'pointer' }}>×</button>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>You pay</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtAmount(amount)} {labelFor(confirmRoute.sellAsset)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>You receive (est.)</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtAmount(confirmRoute.expectedBuyAmount)} {labelFor(confirmRoute.buyAsset)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Route</span>
                <span style={{ color: 'var(--text-primary)' }}>{confirmRoute.providers.join(' → ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Min received</span>
                <span style={{ color: 'var(--text-primary)' }}>{fmtAmount(confirmRoute.expectedBuyAmountMaxSlippage)} {labelFor(confirmRoute.buyAsset)}</span>
              </div>
            </div>

            {execState === 'idle' && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                  This signs and broadcasts a real on-chain transaction from your wallet. A token swap may require an approval transaction first.
                </div>
                <button type="button" onClick={() => runSwap(confirmRoute)}
                  style={{ padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#0d0d0d' }}>
                  Confirm &amp; Swap
                </button>
              </>
            )}

            {execState === 'executing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                <span style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Signing &amp; broadcasting… approve any prompts. This can take a moment.
              </div>
            )}

            {execState === 'done' && execResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✓ Swap submitted</div>
                {trackStatus && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{STATUS_LABEL[trackStatus] ?? trackStatus}</div>}
                {execResult.approvalTxHash && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Approval mined ✓</div>}
                <a href={execResult.explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  View transaction ↗
                </a>
                <button type="button" onClick={closeConfirm} style={{ marginTop: 4, padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Done</button>
              </div>
            )}

            {execState === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                  {execError}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => runSwap(confirmRoute)} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent)', color: '#0d0d0d', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                  <button type="button" onClick={closeConfirm} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
