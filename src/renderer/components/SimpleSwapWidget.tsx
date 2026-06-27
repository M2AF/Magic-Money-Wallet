/**
 * SimpleSwapWidget.tsx — the "add+add" cross-chain exchange form (SimpleSwap).
 *
 * coin + coin + destination address + refund address. Off-chain flow: estimate
 * → create exchange → hand off to <ExchangeStatusCard> (no local signing).
 * Destination/refund auto-fill from the wallet's own addresses where held.
 */

import { useEffect, useRef, useState } from 'react'
import type { WalletAddresses, AllBalances } from '../types/wallet'
import type { SsExchange, SimpleSwapRateType, ExchangeProvider } from '../types/simpleswap'
import { SS_ASSETS, ssKey, findSsAsset, ssBalanceChain } from '../types/simpleswap-assets'
import { ExchangeStatusCard } from './ExchangeStatusCard'

interface Props { addresses: WalletAddresses; active: boolean }

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 14, cursor: 'pointer', outline: 'none',
  flexShrink: 0, width: 132, maxWidth: '46%',
}
const inputStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '10px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
}

function addrFor(addresses: WalletAddresses, key: 'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot' | null): string {
  if (!key) return ''
  if (key === 'evm') return addresses.evm
  if (key === 'solana') return addresses.solana
  if (key === 'cardano') return addresses.cardano
  if (key === 'bitcoin') return addresses.bitcoin
  if (key === 'polkadot') return addresses.polkadot
  return ''
}

export function SimpleSwapWidget({ addresses, active }: Props) {
  const [fromKey, setFromKey] = useState(ssKey({ ticker: 'sol', network: 'sol' }))
  const [toKey, setToKey]     = useState(ssKey({ ticker: 'btc', network: 'btc' }))
  const [amount, setAmount]   = useState('')
  const [rateType, setRateType] = useState<SimpleSwapRateType>('floating')

  const [estimate, setEstimate] = useState<string | null>(null)
  const [range, setRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null })
  const [rateId, setRateId] = useState<string | null>(null)
  const [provider, setProvider] = useState<ExchangeProvider>('simpleswap')
  const [estLoading, setEstLoading] = useState(false)
  const [estError, setEstError] = useState<string | null>(null)

  const [destination, setDestination] = useState('')
  const [refund, setRefund] = useState('')
  const [destTouched, setDestTouched] = useState(false)
  const [refundTouched, setRefundTouched] = useState(false)

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [exchange, setExchange] = useState<SsExchange | null>(null)

  const [balances, setBalances] = useState<AllBalances | null>(null)

  const from = findSsAsset(fromKey)!
  const to = findSsAsset(toKey)!

  // Native balance of the FROM asset's chain (BTC/SOL/ADA/etc.), if the wallet holds it.
  const fromBalChain = ssBalanceChain(from)
  const fromBal = fromBalChain && balances ? (parseFloat(balances.chains[fromBalChain]?.native ?? '0') || 0) : null

  // ── Wallet balances (for the FROM balance + Max) ──────────────────────────
  useEffect(() => {
    if (!active) return
    let on = true
    window.wallet.getBalances().then(b => { if (on) setBalances(b) }).catch(() => { /* ignore */ })
    return () => { on = false }
  }, [active])

  // ── Auto-fill addresses from the wallet when the pair changes ─────────────
  useEffect(() => {
    if (!destTouched) setDestination(addrFor(addresses, to.addrKey))
    if (!refundTouched) setRefund(addrFor(addresses, from.addrKey))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, toKey])

  // ── Debounced estimate ────────────────────────────────────────────────────
  const debounce = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(debounce.current)
    setEstimate(null); setRateId(null); setEstError(null)
    const amt = parseFloat(amount)
    if (!(amt > 0) || fromKey === toKey) return
    setEstLoading(true)
    debounce.current = setTimeout(async () => {
      try {
        const r = await window.wallet.xEstimate({
          tickerFrom: from.ticker, networkFrom: from.network,
          tickerTo: to.ticker, networkTo: to.network,
          amount: amount.trim(), fixed: rateType === 'fixed',
        })
        setEstimate(r.estimatedAmount); setRateId(r.rateId); setEstError(r.error)
        setRange({ min: r.min, max: r.max }); setProvider(r.provider)
      } catch (e) {
        setEstError(e instanceof Error ? e.message : 'Estimate failed')
      } finally {
        setEstLoading(false)
      }
    }, 600)
    return () => clearTimeout(debounce.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromKey, toKey, rateType])

  const flip = () => {
    setFromKey(toKey); setToKey(fromKey); setAmount(''); setEstimate(null)
    setDestTouched(false); setRefundTouched(false)
  }

  const amt = parseFloat(amount)
  const belowMin = range.min != null && amt > 0 && amt < parseFloat(range.min)
  const aboveMax = range.max != null && amt > 0 && amt > parseFloat(range.max)
  const canExchange = amt > 0 && !!destination && !!estimate && !belowMin && !aboveMax && fromKey !== toKey && !creating

  const create = async () => {
    setCreating(true); setCreateError(null)
    try {
      const ex = await window.wallet.xCreateExchange({
        provider,
        tickerFrom: from.ticker, networkFrom: from.network,
        tickerTo: to.ticker, networkTo: to.network,
        amount: amount.trim(), fixed: rateType === 'fixed',
        addressTo: destination.trim(),
        userRefundAddress: refund.trim() || undefined,
        rateId: rateType === 'fixed' ? rateId : null,
      })
      if (ex.error) { setCreateError(ex.error); return }
      setExchange(ex)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create exchange')
    } finally {
      setCreating(false)
    }
  }

  const reset = () => {
    setExchange(null); setAmount(''); setEstimate(null); setRateId(null)
    setCreateError(null); setDestTouched(false); setRefundTouched(false)
    setDestination(addrFor(addresses, to.addrKey)); setRefund(addrFor(addresses, from.addrKey))
  }

  if (exchange) {
    return (
      <ExchangeStatusCard
        exchange={exchange}
        provider={exchange.provider ?? provider}
        fromLabel={from.label}
        toLabel={to.label}
        fromNetworkName={from.name}
        onNewExchange={reset}
      />
    )
  }

  const label = (a: typeof from) => `${a.label} · ${a.name}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* YOU SEND */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>YOU SEND</span>
          {fromBal != null && (
            <button type="button" onClick={() => setAmount(String(fromBal))}
              style={{ padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>MAX</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" inputMode="decimal" min="0" placeholder="0.0" value={amount} onChange={e => setAmount(e.target.value)}
            style={{ ...inputStyle, flex: 1, fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }} />
          <select aria-label="Send asset" value={fromKey} onChange={e => setFromKey(e.target.value)} style={selectStyle}>
            {SS_ASSETS.map(a => <option key={ssKey(a)} value={ssKey(a)}>{label(a)}</option>)}
          </select>
        </div>
        {fromBal != null && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Balance: {fromBal.toLocaleString('en-US', { maximumFractionDigits: 6 })} {from.label}
          </span>
        )}
        {range.min != null && (
          <div style={{ fontSize: 11, color: belowMin || aboveMax ? '#fca5a5' : 'var(--text-muted)' }}>
            Min {range.min} {from.label}{range.max ? ` · Max ${range.max} ${from.label}` : ''}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="button" onClick={flip} title="Flip direction"
          style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="7 10 12 5 17 10" /><polyline points="17 14 12 19 7 14" /></svg>
        </button>
      </div>

      {/* YOU RECEIVE */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>YOU RECEIVE</span>
          {estimate && (
            <span style={{ fontSize: 10, fontWeight: 700, color: provider === 'changenow' ? '#a78bfa' : 'var(--accent)' }}>
              via {provider === 'changenow' ? 'ChangeNOW' : 'SimpleSwap'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)', color: estimate ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {estLoading ? '…' : estimate ? `≈ ${estimate}` : '—'}
          </div>
          <select aria-label="Receive asset" value={toKey} onChange={e => setToKey(e.target.value)} style={selectStyle}>
            {SS_ASSETS.map(a => <option key={ssKey(a)} value={ssKey(a)}>{label(a)}</option>)}
          </select>
        </div>
      </div>

      {/* DESTINATION ADDRESS */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>+ DESTINATION ADDRESS (required)</span>
        <input value={destination} onChange={e => { setDestination(e.target.value); setDestTouched(true) }}
          placeholder={`Paste your ${to.label} address`} style={inputStyle} />
        {!destTouched && destination
          ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>✓ auto-filled from your wallet</span>
          : null}
      </div>

      {/* REFUND ADDRESS */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>+ REFUND ADDRESS (recommended)</span>
        <input value={refund} onChange={e => { setRefund(e.target.value); setRefundTouched(true) }}
          placeholder={`Your ${from.label} address`} style={inputStyle} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Used if the exchange fails</span>
      </div>

      {/* Rate type */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Rate type</span>
        {(['floating', 'fixed'] as SimpleSwapRateType[]).map(rt => (
          <button key={rt} type="button" onClick={() => setRateType(rt)}
            style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${rateType === rt ? 'var(--border-active)' : 'var(--border)'}`, background: rateType === rt ? 'var(--accent-dim)' : 'transparent', color: rateType === rt ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'capitalize' }}>
            {rt}{rt === 'fixed' ? ' (20m)' : ''}
          </button>
        ))}
      </div>

      {(estError || createError) && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>
          {createError || estError}
        </div>
      )}

      <button type="button" onClick={create} disabled={!canExchange}
        style={{ padding: '13px', borderRadius: 'var(--radius-sm)', border: 'none', fontSize: 14, fontWeight: 700, cursor: canExchange ? 'pointer' : 'not-allowed', background: canExchange ? 'var(--accent)' : 'var(--border)', color: canExchange ? '#0d0d0d' : 'var(--text-muted)' }}>
        {creating ? 'Creating exchange…' : belowMin ? `Minimum ${range.min} ${from.label}` : aboveMax ? `Maximum ${range.max} ${from.label}` : !destination ? 'Enter destination address' : 'Get Exchange'}
      </button>
    </div>
  )
}
