import { useState, useEffect, useRef } from 'react'
import type { FeeEstimate, SendResult } from '../types/wallet'

interface Props {
  chainId: string       // chain-config id, e.g. 'ethereum', 'arbitrum', 'solana'
  balance: string | null
  symbol: string
  onClose: () => void
  source?: 'eoa' | 'agw'  // 'agw' sends from the Abstract Global Wallet (smart account)
}

type Step = 'form' | 'confirm' | 'sending' | 'success' | 'error'

function getChainType(chainId: string): 'evm' | 'solana' | 'cardano' | 'tron' | 'dogecoin' | 'bitcoin' {
  if (chainId === 'solana') return 'solana'
  if (chainId === 'cardano') return 'cardano'
  if (chainId === 'tron') return 'tron'
  if (chainId === 'dogecoin') return 'dogecoin'
  if (chainId === 'bitcoin') return 'bitcoin'
  return 'evm'
}

function getAddressPlaceholder(chainId: string): string {
  if (chainId === 'solana') return 'Base58 address...'
  if (chainId === 'cardano') return 'addr1q...'
  if (chainId === 'tron') return 'T...'
  if (chainId === 'dogecoin') return 'D...'
  if (chainId === 'bitcoin') return 'bc1q… / bc1p… / 3…'
  return '0x...'
}

function getChainLabel(chainId: string, symbol: string): string {
  const labels: Record<string, string> = {
    ethereum: 'Ethereum', arbitrum: 'Arbitrum One', optimism: 'Optimism',
    base: 'Base', polygon: 'Polygon', avalanche: 'Avalanche',
    blast: 'Blast', gnosis: 'Gnosis', monad: 'Monad', abstract: 'Abstract',
    apechain: 'ApeChain', ronin: 'Ronin', soneium: 'Soneium',
    worldchain: 'WorldChain', zora: 'Zora', hyperevm: 'HyperEVM',
    solana: 'Solana', cardano: 'Cardano', tron: 'Tron', dogecoin: 'Dogecoin'
  }
  return labels[chainId] ?? `${symbol} Network`
}

export function SendModal({ chainId, balance, symbol, onClose, source = 'eoa' }: Props) {
  const [step, setStep]             = useState<Step>('form')
  const [to, setTo]                 = useState('')
  const [amount, setAmount]         = useState('')
  const [fee, setFee]               = useState<FeeEstimate | null>(null)
  const [feeLoading, setFeeLoading] = useState(false)
  const [feeError, setFeeError]     = useState<string | null>(null)
  const [result, setResult]         = useState<SendResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const chainType = getChainType(chainId)

  // While broadcasting, ignore dismissal — closing here loses the tx hash /
  // success screen even though the transaction still lands on-chain.
  const canDismiss = step !== 'sending'

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && canDismiss) onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && canDismiss) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, canDismiss])

  // ── H-3: real per-chain address validation (main-process decode) ────────
  type AddrState = 'empty' | 'checking' | 'valid' | 'invalid'
  const [addrState, setAddrState]   = useState<AddrState>('empty')
  const [addrReason, setAddrReason] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = to.trim()
    if (!trimmed) { setAddrState('empty'); setAddrReason(null); return }
    setAddrState('checking')
    let stale = false
    // Debounced so we don't round-trip IPC on every keystroke.
    const id = setTimeout(async () => {
      try {
        const res = await window.wallet.validateAddress(chainId, trimmed)
        if (stale) return
        setAddrState(res.valid ? 'valid' : 'invalid')
        setAddrReason(res.valid ? null : (res.reason ?? 'Invalid address'))
      } catch {
        // Validator unavailable (old bridge / IPC hiccup) — don't block the
        // send; fee estimation and broadcast still reject bad addresses.
        if (!stale) { setAddrState('valid'); setAddrReason(null) }
      }
    }, 250)
    return () => { stale = true; clearTimeout(id) }
  }, [to, chainId])

  // ── H-3: amount ≤ balance, and (once the fee is known) amount + fee ≤ balance
  const parsedAmount  = parseFloat(amount)
  const parsedBalance = balance != null ? parseFloat(balance.replace(/,/g, '')) : NaN
  const exceedsBalance = Number.isFinite(parsedBalance) && parsedAmount > parsedBalance
  const isValidAmount  = parsedAmount > 0 && !isNaN(parsedAmount) && !exceedsBalance
  const feeNum = fee ? parseFloat(fee.fee) : NaN
  // Only comparable when the fee is paid in the sent asset (native sends).
  const totalExceeds = !!fee && fee.feeSymbol === symbol &&
    Number.isFinite(parsedBalance) && Number.isFinite(feeNum) &&
    parsedAmount + feeNum > parsedBalance
  const canEstimate = addrState === 'valid' && isValidAmount

  // Max = full balance, minus the estimated fee when it's in the same asset.
  const handleMax = () => {
    if (!Number.isFinite(parsedBalance)) return
    const reserve = fee && fee.feeSymbol === symbol && Number.isFinite(feeNum) ? feeNum : 0
    const v = Math.max(parsedBalance - reserve, 0)
    setAmount(String(Number(v.toFixed(8))))
    setFee(null)
  }

  const handleEstimateFee = async () => {
    if (!canEstimate) return
    setFeeLoading(true)
    setFeeError(null)
    setFee(null)
    try {
      const estimate = await window.wallet.estimateFee(chainId, to.trim(), amount.trim())
      setFee(estimate)
    } catch (err) {
      setFeeError(String(err).replace('Error: ', ''))
    } finally {
      setFeeLoading(false)
    }
  }

  const handleSend = async () => {
    setStep('sending')
    setError(null)
    try {
      let res: SendResult
      if (source === 'agw')              res = await window.wallet.sendAgw(to.trim(), amount.trim())
      else if (chainType === 'solana')   res = await window.wallet.sendSolana(to.trim(), amount.trim())
      else if (chainType === 'cardano')  res = await window.wallet.sendCardano(to.trim(), amount.trim())
      else if (chainType === 'tron')     res = await window.wallet.sendTron(to.trim(), amount.trim())
      else if (chainType === 'dogecoin') res = await window.wallet.sendDogecoin(to.trim(), amount.trim())
      else if (chainType === 'bitcoin')  res = await window.wallet.sendBitcoin(to.trim(), amount.trim())
      else                               res = await window.wallet.sendEvm(chainId, to.trim(), amount.trim())
      setResult(res)
      setStep('success')
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
      setStep('error')
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(6, 11, 24, 0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        className="fade-in"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-active)', borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
              Send {symbol}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {source === 'agw' ? 'Abstract Smart Wallet (AGW)' : getChainLabel(chainId, symbol)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Balance hint */}
        {balance && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Available: <span style={{ color: 'var(--text-secondary)' }}>{balance} {symbol}</span>
          </div>
        )}

        {/* ── FORM / CONFIRM step ── */}
        {(step === 'form' || step === 'confirm') && (
          <>
            <div>
              <div className="label">Recipient Address</div>
              <input
                className="input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, borderColor: addrState === 'invalid' ? 'var(--error)' : undefined }}
                placeholder={getAddressPlaceholder(chainId)}
                value={to}
                onChange={e => { setTo(e.target.value); setFee(null) }}
                spellCheck={false}
                disabled={step === 'confirm'}
              />
              {addrState === 'invalid' && addrReason && (
                <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>{addrReason}</div>
              )}
            </div>

            <div>
              <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Amount ({symbol})</span>
                {balance != null && step === 'form' && (
                  <button
                    type="button"
                    onClick={handleMax}
                    style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 99, background: 'var(--accent-dim)', border: '1px solid var(--border-active)', color: 'var(--accent)', cursor: 'pointer' }}
                  >
                    MAX
                  </button>
                )}
              </div>
              <input
                className="input"
                placeholder="0.0"
                value={amount}
                type="number"
                min="0"
                step="any"
                style={{ borderColor: exceedsBalance ? 'var(--error)' : undefined }}
                onChange={e => { setAmount(e.target.value); setFee(null) }}
                disabled={step === 'confirm'}
              />
              {exceedsBalance && (
                <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
                  Exceeds available balance ({balance} {symbol})
                </div>
              )}
            </div>

            {step === 'form' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleEstimateFee}
                disabled={!canEstimate || feeLoading}
                style={{ fontSize: 13, padding: '10px 16px' }}
              >
                {feeLoading ? 'Estimating…' : 'Estimate Fee'}
              </button>
            )}

            {feeError && (
              <div style={{ fontSize: 12, color: 'var(--error)' }}>{feeError}</div>
            )}

            {fee && (
              <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Network Fee</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>
                  {fee.fee} {fee.feeSymbol}
                  {fee.feeUsd && (
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>{fee.feeUsd}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Total: {amount} + {fee.fee} {fee.feeSymbol} fee
                </div>
              </div>
            )}

            {source === 'agw' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Sending from your Abstract Smart Wallet. Gas is paid in ETH from the smart wallet itself.
              </div>
            )}

            {totalExceeds && (
              <div style={{ fontSize: 11, color: 'var(--error)' }}>
                Amount + network fee exceeds your balance — use MAX to send the most it can cover.
              </div>
            )}

            {step === 'form' && (fee || source === 'agw') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep('confirm')}
                disabled={!canEstimate || totalExceeds}
              >
                Review Transaction
              </button>
            )}

            {step === 'confirm' && (
              <>
                <div className="warning-box">
                  <span className="warning-icon">⚠️</span>
                  <span>
                    Sending <strong>{amount} {symbol}</strong> to{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>{to}</span>.
                    This cannot be undone.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setStep('form')} style={{ flex: 1 }}>Back</button>
                  <button type="button" className="btn btn-primary" onClick={handleSend} style={{ flex: 1 }}>Confirm Send</button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── SENDING step ── */}
        {step === 'sending' && (
          <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div className="spinner" />
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Broadcasting transaction…</div>
          </div>
        )}

        {/* ── SUCCESS step ── */}
        {step === 'success' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--success)' }}>Transaction Sent</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Transaction Hash</div>
              <div
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all', color: 'var(--accent-text)', cursor: 'pointer' }}
                onClick={() => navigator.clipboard.writeText(result.txHash)}
                title="Click to copy"
              >
                {result.txHash}
              </div>
            </div>
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--accent)', textDecoration: 'none', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
            >
              View on Explorer ↗
            </a>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}

        {/* ── ERROR step ── */}
        {step === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 14px', lineHeight: 1.5 }}>
              {error}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('form')} style={{ flex: 1 }}>Try Again</button>
              <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
