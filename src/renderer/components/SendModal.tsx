import { useState, useEffect, useRef } from 'react'
import type { FeeEstimate, SendResult } from '../types/wallet'

interface Props {
  chainId: string       // chain-config id, e.g. 'ethereum', 'arbitrum', 'solana'
  balance: string | null
  symbol: string
  onClose: () => void
}

type Step = 'form' | 'confirm' | 'sending' | 'success' | 'error'

function getChainType(chainId: string): 'evm' | 'solana' | 'cardano' {
  if (chainId === 'solana') return 'solana'
  if (chainId === 'cardano') return 'cardano'
  return 'evm'
}

function getAddressPlaceholder(chainId: string): string {
  if (chainId === 'solana') return 'Base58 address...'
  if (chainId === 'cardano') return 'addr1q...'
  return '0x...'
}

function getChainLabel(chainId: string, symbol: string): string {
  const labels: Record<string, string> = {
    ethereum: 'Ethereum', arbitrum: 'Arbitrum One', optimism: 'Optimism',
    base: 'Base', polygon: 'Polygon', avalanche: 'Avalanche',
    blast: 'Blast', gnosis: 'Gnosis', monad: 'Monad', abstract: 'Abstract',
    apechain: 'ApeChain', ronin: 'Ronin', soneium: 'Soneium',
    worldchain: 'WorldChain', zora: 'Zora', hyperevm: 'HyperEVM',
    solana: 'Solana', cardano: 'Cardano'
  }
  return labels[chainId] ?? `${symbol} Network`
}

export function SendModal({ chainId, balance, symbol, onClose }: Props) {
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

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isValidAddress = to.trim().length > 10
  const isValidAmount  = parseFloat(amount) > 0 && !isNaN(parseFloat(amount))
  const canEstimate    = isValidAddress && isValidAmount

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
      if (chainType === 'solana')       res = await window.wallet.sendSolana(to.trim(), amount.trim())
      else if (chainType === 'cardano') res = await window.wallet.sendCardano(to.trim(), amount.trim())
      else                              res = await window.wallet.sendEvm(chainId, to.trim(), amount.trim())
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
              {getChainLabel(chainId, symbol)}
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
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                placeholder={getAddressPlaceholder(chainId)}
                value={to}
                onChange={e => { setTo(e.target.value); setFee(null) }}
                spellCheck={false}
                disabled={step === 'confirm'}
              />
            </div>

            <div>
              <div className="label">Amount ({symbol})</div>
              <input
                className="input"
                placeholder="0.0"
                value={amount}
                type="number"
                min="0"
                step="any"
                onChange={e => { setAmount(e.target.value); setFee(null) }}
                disabled={step === 'confirm'}
              />
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

            {step === 'form' && fee && (
              <button type="button" className="btn btn-primary" onClick={() => setStep('confirm')}>
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
