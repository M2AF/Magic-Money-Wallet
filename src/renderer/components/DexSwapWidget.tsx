/**
 * DexSwapWidget.tsx — Phantom-style swap with cross-chain auto-routing.
 *
 * Pick a FROM network/token and a TO network/token independently. When the two
 * networks match it's a same-chain swap (0x/1inch/Jupiter, best price); when they
 * differ it auto-routes cross-chain (LI.FI → Rango) — all via the proxy. The
 * wallet signs the source-chain tx locally (window.wallet.swapExecute) and, for
 * cross-chain, tracks bridge delivery (window.wallet.swapCrossStatus).
 *
 * Spending FROM Bitcoin/Cardano/Polkadot needs signing the executor doesn't have,
 * so those sources hand off to the Cross-Chain (SimpleSwap) tab.
 *
 * Same Phantom UX guards as before: gas preflight, 12s refresh w/ >0.5% re-accept,
 * auto-slippage, and a native dust buffer on Max.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WalletAddresses, AllBalances, TokensResult, NormalizedSwapQuote, SwapToken, SwapChain } from '../types/wallet'
import { SWAP_TOKEN_LISTS, DEX_CHAINS, takerKeyForChain, isDexSignableSource } from '../types/swap-tokens'
import { SwapQuoteCard } from './SwapQuoteCard'
import { SwapSettings } from './SwapSettings'
import { CrossChainStatusCard } from './CrossChainStatusCard'

interface Props { addresses: WalletAddresses; active: boolean; onUseCrossChain?: () => void }

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'USDP'])
const BLUE_CHIP = new Set(['SOL', 'ETH'])
// Flat native-fee reserve per chain (human units) for the gas preflight + Max buffer.
const MIN_NATIVE_FEE: Record<string, number> = {
  ethereum: 0.003, arbitrum: 0.0004, optimism: 0.0004, base: 0.0004,
  polygon: 0.05, avalanche: 0.02, bsc: 0.002, monad: 0.05, solana: 0.001,
}

function getAutoSlippageBps(fromSymbol: string, toSymbol: string): number {
  if (STABLES.has(fromSymbol) && STABLES.has(toSymbol)) return 5
  if (BLUE_CHIP.has(fromSymbol)) return 50
  return 250
}

function humanToRaw(human: string, decimals: number): string {
  if (!human || !(parseFloat(human) > 0)) return '0'
  const [i, f = ''] = human.split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  const digits = ((i || '0').replace(/^0+/, '') || '0') + frac
  try { return BigInt(digits).toString() } catch { return '0' }
}
function rawToHuman(raw: string, decimals: number): number {
  if (!raw) return 0
  try { return Number(BigInt(raw)) / 10 ** decimals } catch { return Number(raw) / 10 ** decimals }
}

type ExecState = 'idle' | 'swapping' | 'success' | 'error'

export function DexSwapWidget({ addresses, active, onUseCrossChain }: Props) {
  const [fromChain, setFromChain] = useState<SwapChain>('ethereum')
  const [toChain, setToChain] = useState<SwapChain>('ethereum')
  const fromTokens = SWAP_TOKEN_LISTS[fromChain] ?? []
  const toTokens = SWAP_TOKEN_LISTS[toChain] ?? []
  const [fromToken, setFromToken] = useState<SwapToken>(fromTokens[0])
  const [toToken, setToToken] = useState<SwapToken>(toTokens[1] ?? toTokens[0])
  const [amount, setAmount] = useState('')

  const [overrideBps, setOverrideBps] = useState<number | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [quote, setQuote] = useState<NormalizedSwapQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  const [nativeBal, setNativeBal] = useState<number>(0)
  const [fromBal, setFromBal] = useState<number | null>(null)

  const [refreshIn, setRefreshIn] = useState<number | null>(null)
  const [priceChanged, setPriceChanged] = useState(false)
  const acceptedBuyRaw = useRef<string | null>(null)

  const [execState, setExecState] = useState<ExecState>('idle')
  const [execResult, setExecResult] = useState<{ txHash: string; explorerUrl: string; approvalTxHash: string | null } | null>(null)
  const [execError, setExecError] = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const isAuto = overrideBps === null
  const autoBps = getAutoSlippageBps(fromToken.symbol, toToken.symbol)
  const slippageBps = isAuto ? autoBps : overrideBps

  const sourceSignable = isDexSignableSource(fromChain)
  const isCrossChain = fromChain !== toChain
  const addrFor = useCallback((c: SwapChain) => addresses[takerKeyForChain(c)], [addresses])

  const clearQuote = () => { setQuote(null); setQuoteError(null); acceptedBuyRaw.current = null; setPriceChanged(false) }

  // ── Network change handlers (reset the picked token; keep from/to distinct) ──
  const onFromChain = (c: SwapChain) => {
    setFromChain(c)
    const list = SWAP_TOKEN_LISTS[c] ?? []
    setFromToken(list[0])
    if (c === toChain && list[0]) {
      setToToken(prev => prev.address === list[0].address ? (list.find(t => t.address !== list[0].address) ?? list[0]) : prev)
    }
    setAmount(''); clearQuote()
  }
  const onToChain = (c: SwapChain) => {
    setToChain(c)
    const list = SWAP_TOKEN_LISTS[c] ?? []
    let next = list[0]
    if (c === fromChain && next && next.address === fromToken.address) next = list.find(t => t.address !== fromToken.address) ?? list[0]
    setToToken(next)
    clearQuote()
  }

  // ── Load balances (native + from-token) on the SOURCE chain ────────────────
  useEffect(() => {
    if (!active) return
    let on = true
    ;(async () => {
      try {
        const bals: AllBalances = await window.wallet.getBalances()
        if (on) setNativeBal(parseFloat(bals.chains[fromChain]?.native ?? '0') || 0)
      } catch { /* ignore */ }
    })()
    return () => { on = false }
  }, [fromChain, active])

  useEffect(() => {
    if (!active) return
    let on = true
    ;(async () => {
      if (fromToken.isNative) { setFromBal(nativeBal); return }
      try {
        const res: TokensResult = await window.wallet.getTokens()
        const match = res.tokens.find(t => t.chain === fromChain && t.contractAddress.toLowerCase() === fromToken.address.toLowerCase())
        if (on) setFromBal(match ? parseFloat(match.balance) || 0 : 0)
      } catch { if (on) setFromBal(null) }
    })()
    return () => { on = false }
  }, [fromToken, fromChain, nativeBal, active])

  // ── Quote fetch ───────────────────────────────────────────────────────────
  const fetchQuote = useCallback(async (silent = false): Promise<NormalizedSwapQuote | null> => {
    if (!(parseFloat(amount) > 0)) return null
    if (fromChain === toChain && fromToken.address === toToken.address) return null
    if (!silent) { setFetching(true); setQuoteError(null) }
    try {
      const r = await window.wallet.swapGetQuote({
        fromChain, toChain,
        fromToken: fromToken.address, toToken: toToken.address,
        fromSymbol: fromToken.symbol, toSymbol: toToken.symbol,
        sellAmountRaw: humanToRaw(amount, fromToken.decimals),
        slippageBps, taker: addrFor(fromChain), toAddress: addrFor(toChain),
        fromDecimals: fromToken.decimals, toDecimals: toToken.decimals,
      })
      if (!alive.current) return null
      if (r.error || !r.quote) { if (!silent) setQuoteError(r.error ?? 'No route available.'); return null }
      return r.quote
    } catch (e) {
      if (!silent) setQuoteError(e instanceof Error ? e.message : 'Quote failed')
      return null
    } finally {
      if (!silent && alive.current) setFetching(false)
    }
  }, [amount, fromChain, toChain, fromToken, toToken, slippageBps, addrFor])

  const getQuote = async () => {
    setPriceChanged(false)
    const q = await fetchQuote(false)
    if (q) { setQuote(q); acceptedBuyRaw.current = q.buyAmountRaw }
  }

  // ── Guard 2: 12s refresh ticker ───────────────────────────────────────────
  useEffect(() => {
    if (!quote || priceChanged || execState !== 'idle' || !active) { setRefreshIn(null); return }
    setRefreshIn(12)
    const countdown = setInterval(() => setRefreshIn(s => (s != null && s > 0 ? s - 1 : s)), 1000)
    const refresh = setInterval(async () => {
      const q = await fetchQuote(true)
      if (!q || !alive.current) return
      const prev = acceptedBuyRaw.current
      const dropped = prev ? rawToHuman(q.buyAmountRaw, toToken.decimals) < rawToHuman(prev, toToken.decimals) * 0.995 : false
      if (dropped) { setQuote(q); setPriceChanged(true) }
      else { setQuote(q); acceptedBuyRaw.current = q.buyAmountRaw; setRefreshIn(12) }
    }, 12_000)
    return () => { clearInterval(countdown); clearInterval(refresh) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, priceChanged, execState, active, fetchQuote, toToken.decimals])

  const acceptNewPrice = () => { if (quote) { acceptedBuyRaw.current = quote.buyAmountRaw; setPriceChanged(false) } }

  // ── Guard 4: Max with native dust buffer ──────────────────────────────────
  const onMax = () => {
    if (fromBal == null) return
    if (fromToken.isNative) {
      const buffer = (MIN_NATIVE_FEE[fromChain] ?? 0.001) * 1.5
      const safe = Math.max(0, fromBal - buffer)
      setAmount(safe > 0 ? String(safe) : '0')
    } else {
      setAmount(String(fromBal))
    }
    setQuote(null); acceptedBuyRaw.current = null
  }

  const flip = () => {
    const nfc = toChain, ntc = fromChain, nft = toToken, ntt = fromToken
    setFromChain(nfc); setToChain(ntc); setFromToken(nft); setToToken(ntt)
    setAmount(''); clearQuote()
  }

  // ── Guard 1: gas preflight (source chain) ─────────────────────────────────
  const feeReserve = MIN_NATIVE_FEE[fromChain] ?? 0.001
  const sellHuman = parseFloat(amount) || 0
  const nativeSpend = fromToken.isNative ? sellHuman : 0
  const insufficientGas = !!quote && (nativeBal < nativeSpend + feeReserve)

  const run = async () => {
    if (!quote) return
    setExecState('swapping'); setExecError(null); setExecResult(null)
    try {
      const r = await window.wallet.swapExecute(quote)
      if (!alive.current) return
      setExecResult(r); setExecState('success')
    } catch (e) {
      if (!alive.current) return
      setExecError(e instanceof Error ? e.message : 'Swap failed'); setExecState('error')
    }
  }

  const reset = () => { setExecState('idle'); setExecResult(null); setExecError(null); setQuote(null); setAmount(''); acceptedBuyRaw.current = null }

  const expectedBuy = quote ? rawToHuman(quote.buyAmountRaw, toToken.decimals) : null
  const canQuote = parseFloat(amount) > 0 && !(fromChain === toChain && fromToken.address === toToken.address) && !fetching && sourceSignable

  // ── Cross-chain success → bridge tracker ──────────────────────────────────
  if (execState === 'success' && execResult && quote?.isCrossChain) {
    return (
      <CrossChainStatusCard
        quote={quote}
        txHash={execResult.txHash}
        explorerUrl={execResult.explorerUrl}
        toSymbol={toToken.symbol}
        toDecimals={toToken.decimals}
        onDone={reset}
      />
    )
  }

  // ── Button ────────────────────────────────────────────────────────────────
  function renderButton() {
    if (execState === 'success' && execResult) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✓ Swap submitted</div>
          {execResult.approvalTxHash && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Approval mined ✓</div>}
          <a href={execResult.explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>View transaction ↗</a>
          <button type="button" onClick={reset} style={btn(true, 'transparent')}>Done</button>
        </div>
      )
    }
    if (execState === 'error') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>{execError}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={run} style={{ ...btn(true), flex: 1 }}>Retry</button>
            <button type="button" onClick={reset} style={{ ...btn(true, 'transparent'), flex: 1 }}>Close</button>
          </div>
        </div>
      )
    }
    if (execState === 'swapping') {
      return <button type="button" disabled style={btn(false)}><Spinner /> Swapping…{quote?.approvalTx ? ' (approving first)' : ''}</button>
    }
    if (!quote) {
      return <button type="button" onClick={getQuote} disabled={!canQuote} style={btn(canQuote)}>{fetching ? 'Fetching quote…' : 'Get Quote'}</button>
    }
    if (priceChanged) {
      return <button type="button" onClick={acceptNewPrice} style={btn(true, '#facc15', '#0d0d0d')}>Accept New Price</button>
    }
    if (insufficientGas) {
      return <button type="button" disabled style={btn(false)}>Insufficient {nativeSymbolFor(fromChain)} for fee</button>
    }
    const verb = isCrossChain ? 'Swap cross-chain' : 'Swap'
    return <button type="button" onClick={run} style={btn(true)}>{verb} {fromToken.symbol} → {toToken.symbol}</button>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* YOU PAY */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={labelStyle}>YOU PAY</span>
          <select aria-label="From network" value={fromChain} onChange={e => onFromChain(e.target.value as SwapChain)} style={netSelectStyle}>
            {DEX_CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" inputMode="decimal" min="0" placeholder="0.0" value={amount}
            onChange={e => { setAmount(e.target.value); setQuote(null); acceptedBuyRaw.current = null }}
            disabled={!sourceSignable}
            style={{ ...inputStyle, flex: 1, fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }} />
          <select aria-label="Pay token" value={fromToken.symbol} onChange={e => { setFromToken(fromTokens.find(t => t.symbol === e.target.value)!); setQuote(null) }} style={selectStyle}>
            {fromTokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {fromBal != null
            ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Balance: {fromBal.toLocaleString('en-US', { maximumFractionDigits: 6 })} {fromToken.symbol}</span>
            : <span />}
          {fromBal != null && sourceSignable && <button type="button" onClick={onMax} style={maxBtn}>MAX</button>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="button" onClick={flip} title="Flip" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="7 10 12 5 17 10" /><polyline points="17 14 12 19 7 14" /></svg>
        </button>
      </div>

      {/* YOU RECEIVE */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={labelStyle}>YOU RECEIVE</span>
          <select aria-label="To network" value={toChain} onChange={e => onToChain(e.target.value as SwapChain)} style={netSelectStyle}>
            {DEX_CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)', color: expectedBuy != null ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {expectedBuy != null ? expectedBuy.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
          </div>
          <select aria-label="Receive token" value={toToken.symbol} onChange={e => { setToToken(toTokens.find(t => t.symbol === e.target.value)!); setQuote(null) }} style={selectStyle}>
            {toTokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
      </div>

      {/* Source not locally signable → hand off to SimpleSwap */}
      {!sourceSignable && (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
            Spending from <strong>{fromToken.symbol}</strong> on {fromChain} uses the Cross-Chain exchange (deposit-address flow).
          </div>
          {onUseCrossChain && (
            <button type="button" onClick={onUseCrossChain} style={btn(true, 'rgba(56,189,248,0.9)', '#04121d')}>Switch to Cross-Chain</button>
          )}
        </div>
      )}

      {sourceSignable && (
        <SwapSettings open={showAdvanced} onToggle={() => setShowAdvanced(v => !v)} slippageBps={slippageBps} autoBps={autoBps} isAuto={isAuto} onSet={setOverrideBps} />
      )}

      {quoteError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>{quoteError}</div>
      )}

      {quote && (
        <SwapQuoteCard quote={quote} fromSymbol={fromToken.symbol} toSymbol={toToken.symbol} fromDecimals={fromToken.decimals} toDecimals={toToken.decimals} autoBps={autoBps} isAuto={isAuto} refreshIn={refreshIn} priceChanged={priceChanged} />
      )}

      {sourceSignable && renderButton()}
    </div>
  )
}

// ── small helpers / styles ────────────────────────────────────────────────────

function nativeSymbolFor(chain: string): string {
  return SWAP_TOKEN_LISTS[chain as SwapChain]?.find(t => t.isNative)?.symbol ?? 'gas'
}
const Spinner = () => <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0d0d0d', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }
const inputStyle: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', minWidth: 0 }
const selectStyle: React.CSSProperties = { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 14, cursor: 'pointer', outline: 'none', flexShrink: 0, width: 104 }
const netSelectStyle: React.CSSProperties = { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', fontSize: 12, cursor: 'pointer', outline: 'none', flexShrink: 0 }
const maxBtn: React.CSSProperties = { padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--accent)' }
function btn(enabled: boolean, bg = 'var(--accent)', color = '#0d0d0d'): React.CSSProperties {
  return { padding: '13px', borderRadius: 'var(--radius-sm)', border: bg === 'transparent' ? '1px solid var(--border)' : 'none', fontSize: 14, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed', background: enabled ? bg : 'var(--border)', color: enabled ? (bg === 'transparent' ? 'var(--text-primary)' : color) : 'var(--text-muted)', width: '100%' }
}
