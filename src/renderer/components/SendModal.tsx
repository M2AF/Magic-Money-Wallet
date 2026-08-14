import { useState, useEffect, useRef } from 'react'
import type { FeeEstimate, SendResult, SendAsset } from '../types/wallet'
import { formatUnits, parseUnits, getChainType } from '../lib/asset-send'

interface Props {
  chainId: string       // chain-config id, e.g. 'ethereum', 'arbitrum', 'solana'
  balance: string | null
  symbol: string
  onClose: () => void
  source?: 'eoa' | 'agw'  // 'agw' sends from the Abstract Global Wallet (smart account)
  /**
   * Omitted for a native send — the original and still the default behaviour.
   * Set when sending a token or NFT held on `chainId`, in which case `balance`
   * and `symbol` describe that asset rather than the chain's native coin.
   */
  asset?: SendAsset
  /** Exact holding in base units. Token sends validate against this, never `balance`. */
  rawBalance?: string
  /** Shown instead of the amount field for a 1-of-1 NFT. */
  assetLabel?: string
  /**
   * Human name of the network. Supplied for token/NFT sends, where `symbol`
   * describes the ASSET — so getChainLabel's `${symbol} Network` fallback would
   * otherwise render nonsense like "FUSD Network" on a custom chain.
   */
  chainLabel?: string
  /** Fired after a broadcast succeeds, so the portfolio can refresh. */
  onSent?: () => void
}

// 'registering' is Midnight-only: a one-time (per wallet) DUST-registration
// transaction that must land before the send itself can be proven — shown as
// its own phase so the user isn't staring at "Broadcasting transaction…"
// while something else entirely is actually happening. Every other chain
// skips straight from 'confirm' to 'sending'.
type Step = 'form' | 'confirm' | 'registering' | 'sending' | 'success' | 'error'


function getAddressPlaceholder(chainId: string): string {
  if (chainId === 'solana') return 'Base58 address...'
  if (chainId === 'cardano') return 'addr1q...'
  if (chainId === 'tron') return 'T...'
  if (chainId === 'dogecoin') return 'D...'
  if (chainId === 'bitcoin') return 'bc1q… / bc1p… / 3…'
  if (chainId === 'monero') return '4… / 8…'
  if (chainId === 'zcash') return 't1… / t3…'
  if (chainId === 'midnight') return 'mn_addr1… / mn_addr_preprod1…'
  return '0x...'
}

function getChainLabel(chainId: string, symbol: string): string {
  const labels: Record<string, string> = {
    ethereum: 'Ethereum', arbitrum: 'Arbitrum One', optimism: 'Optimism',
    base: 'Base', polygon: 'Polygon', avalanche: 'Avalanche',
    blast: 'Blast', gnosis: 'Gnosis', monad: 'Monad', abstract: 'Abstract',
    apechain: 'ApeChain', robinhood: 'Robinhood', ronin: 'Ronin', soneium: 'Soneium',
    worldchain: 'WorldChain', zora: 'Zora', hyperevm: 'HyperEVM',
    solana: 'Solana', cardano: 'Cardano', tron: 'Tron', dogecoin: 'Dogecoin',
    monero: 'Monero', zcash: 'Zcash', midnight: 'Midnight'
  }
  return labels[chainId] ?? `${symbol} Network`
}

export function SendModal({
  chainId, balance, symbol, onClose, source = 'eoa',
  asset, rawBalance, assetLabel, chainLabel, onSent,
}: Props) {
  const networkName = chainLabel ?? getChainLabel(chainId, symbol)
  // A 1-of-1 NFT has no amount to choose — the quantity is fixed at 1, so the
  // amount field and MAX button are omitted entirely rather than shown disabled.
  const isNft = asset?.kind === 'nft'
  const isMultiEdition = isNft && asset.standard === 'erc1155'
  const needsAmount = !isNft || isMultiEdition
  // ERC-1155 editions are whole units; a token uses the asset's own decimals.
  const amountDecimals = asset?.kind === 'token' ? asset.decimals : 0
  const [step, setStep]             = useState<Step>('form')
  const [to, setTo]                 = useState('')
  const [amount, setAmount]         = useState('')
  const [fee, setFee]               = useState<FeeEstimate | null>(null)
  const [feeLoading, setFeeLoading] = useState(false)
  const [feeError, setFeeError]     = useState<string | null>(null)
  const [result, setResult]         = useState<SendResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Midnight only: live DUST-sync/registration progress, polled ONLY while
  // this modal is actually in the 'registering' step (bounded, user-initiated
  // — never fires just because Privacy/Testnet Mode is on, which used to
  // freeze the app by opening the whole Midnight wallet on every login).
  const [dustStatus, setDustStatus] = useState<{ ready: boolean; percent: number; error: string | null } | null>(null)
  useEffect(() => {
    if (step !== 'registering' || typeof window.wallet.getMidnightDustStatus !== 'function') return
    let cancelled = false
    const poll = () => {
      window.wallet.getMidnightDustStatus!().then(s => { if (!cancelled) setDustStatus(s) }).catch(() => {})
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => { cancelled = true; clearInterval(id) }
  }, [step])

  const chainType = getChainType(chainId)

  // While broadcasting (or, for Midnight, registering), ignore dismissal —
  // closing here loses the tx hash / success screen even though the
  // transaction still lands on-chain.
  const canDismiss = step !== 'sending' && step !== 'registering'

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
  //
  // For a token/NFT this compares EXACT base units. `balance` is a rounded,
  // comma-grouped display string, so comparing against it would let a user
  // overdraw by whatever the rounding hid — hence rawBalance.
  const parsedAmount  = parseFloat(amount)
  const rawAmount     = needsAmount ? parseUnits(amount, amountDecimals) : '1'
  const exceedsBalance = asset
    ? rawBalance != null && rawAmount != null && BigInt(rawAmount) > BigInt(rawBalance)
    : (() => {
        const parsedBalance = balance != null ? parseFloat(balance.replace(/,/g, '')) : NaN
        return Number.isFinite(parsedBalance) && parsedAmount > parsedBalance
      })()
  const isValidAmount = !needsAmount
    ? true
    : asset
      ? rawAmount != null && BigInt(rawAmount) > 0n && !exceedsBalance
      : parsedAmount > 0 && !isNaN(parsedAmount) && !exceedsBalance

  const parsedBalance = balance != null ? parseFloat(balance.replace(/,/g, '')) : NaN
  const feeNum = fee ? parseFloat(fee.fee) : NaN
  // Only comparable when the fee is paid in the sent asset — i.e. native sends.
  // A token/NFT send pays gas in the chain's native coin, which is a different
  // balance entirely, so there is nothing to add up here.
  const totalExceeds = !asset && !!fee && fee.feeSymbol === symbol &&
    Number.isFinite(parsedBalance) && Number.isFinite(feeNum) &&
    parsedAmount + feeNum > parsedBalance
  const canEstimate = addrState === 'valid' && isValidAmount

  // Max = full balance, minus the estimated fee when it's in the same asset.
  const handleMax = () => {
    // Token: the whole holding, exactly. No fee reserve — gas comes out of the
    // native coin, not out of the token being sent.
    if (asset) {
      if (rawBalance == null) return
      setAmount(formatUnits(rawBalance, amountDecimals))
      setFee(null)
      return
    }
    if (!Number.isFinite(parsedBalance)) return
    const reserve = fee && fee.feeSymbol === symbol && Number.isFinite(feeNum) ? feeNum : 0
    const v = Math.max(parsedBalance - reserve, 0)
    setAmount(String(Number(v.toFixed(8))))
    setFee(null)
  }

  // A 1-of-1 NFT carries no user-entered amount; the backend ignores the value
  // for that case but the bridge signature still wants a string.
  const sendAmount = () => (needsAmount ? amount.trim() : '1')

  const handleEstimateFee = async () => {
    if (!canEstimate) return
    setFeeLoading(true)
    setFeeError(null)
    setFee(null)
    try {
      const estimate = await window.wallet.estimateFee(chainId, to.trim(), sendAmount(), asset)
      setFee(estimate)
    } catch (err) {
      setFeeError(String(err).replace('Error: ', ''))
    } finally {
      setFeeLoading(false)
    }
  }

  const handleSend = async () => {
    setError(null)
    try {
      // Midnight: the Send button has no pre-check — DUST may still need to
      // finish its first sync (a background wallet-open only starts here,
      // on explicit send intent, never eagerly on login) plus a one-time
      // registration transaction. Both happen inside registerMidnightDust,
      // shown as its own phase rather than silently folded into
      // "Broadcasting transaction…"; dustStatus (polled above) drives the
      // live percentage once the sync is underway.
      if (chainType === 'midnight') {
        setStep('registering')
        await window.wallet.registerMidnightDust?.()
        setStep('sending')
        const res = await window.wallet.sendMidnight!(to.trim(), amount.trim())
        setResult(res)
        setStep('success')
        return
      }

      setStep('sending')
      const amt = sendAmount()
      let res: SendResult
      if (source === 'agw')              res = await window.wallet.sendAgw(to.trim(), amt, asset)
      else if (chainType === 'solana')   res = await window.wallet.sendSolana(to.trim(), amt, asset)
      else if (chainType === 'cardano')  res = await window.wallet.sendCardano(to.trim(), amt, asset)
      else if (chainType === 'tron')     res = await window.wallet.sendTron(to.trim(), amt, asset)
      else if (chainType === 'dogecoin') res = await window.wallet.sendDogecoin(to.trim(), amt)
      else if (chainType === 'bitcoin')  res = await window.wallet.sendBitcoin(to.trim(), amt)
      else if (chainType === 'monero')   res = await window.wallet.sendMonero(to.trim(), amt)
      else if (chainType === 'zcash')    res = await window.wallet.sendZcash(to.trim(), amt)
      else                               res = await window.wallet.sendEvm(chainId, to.trim(), amt, asset)
      setResult(res)
      setStep('success')
      // Balances and holdings have moved — let the dashboard refetch. Fired
      // after the success screen renders so a slow refresh can't delay it.
      onSent?.()
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
              Send {isNft ? (assetLabel || 'NFT') : symbol}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {source === 'agw' ? 'Abstract Smart Wallet (AGW)' : networkName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close send dialog"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Balance hint — for a 1-of-1 NFT there is nothing to quantify, so we
            identify the token instead of showing "Available: 1". */}
        {isNft && !isMultiEdition ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Sending <span style={{ color: 'var(--text-secondary)' }}>1 of 1</span>
            {asset.tokenId && (
              <span style={{ fontFamily: 'var(--font-mono)' }}> · #{asset.tokenId.length > 12 ? `${asset.tokenId.slice(0, 10)}…` : asset.tokenId}</span>
            )}
          </div>
        ) : balance && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Available: <span style={{ color: 'var(--text-secondary)' }}>{balance} {isMultiEdition ? 'editions' : symbol}</span>
          </div>
        )}

        {/* ── FORM / CONFIRM step ── */}
        {(step === 'form' || step === 'confirm') && (
          <>
            <div>
              <div className="label">Recipient Address</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, borderColor: addrState === 'invalid' ? 'var(--error)' : undefined }}
                  placeholder={getAddressPlaceholder(chainId)}
                  value={to}
                  onChange={e => { setTo(e.target.value); setFee(null) }}
                  spellCheck={false}
                  disabled={step === 'confirm'}
                />
                {typeof window.wallet.scanQr === 'function' && step === 'form' && (
                  <button
                    type="button"
                    aria-label="Scan address QR code"
                    onClick={async () => {
                      const text = await window.wallet.scanQr!().catch(() => null)
                      if (!text) return
                      // Payment-URI QRs (ethereum:0x…?value=…, bitcoin:bc1…?amount=…)
                      // carry the address after the scheme, before any query.
                      const addr = text.replace(/^[a-z][a-z0-9+.-]*:/i, '').split('?')[0].trim()
                      if (addr) { setTo(addr); setFee(null) }
                    }}
                    style={{ padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text)', fontSize: 15, cursor: 'pointer' }}
                  >
                    📷
                  </button>
                )}
              </div>
              {addrState === 'invalid' && addrReason && (
                <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>{addrReason}</div>
              )}
            </div>

            {needsAmount && (
              <div>
                <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{isMultiEdition ? 'Editions to send' : `Amount (${symbol})`}</span>
                  {(asset ? rawBalance != null : balance != null) && step === 'form' && (
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
                  placeholder={isMultiEdition ? '1' : '0.0'}
                  value={amount}
                  type="number"
                  min="0"
                  step={isMultiEdition ? '1' : 'any'}
                  style={{ borderColor: exceedsBalance ? 'var(--error)' : undefined }}
                  onChange={e => { setAmount(e.target.value); setFee(null) }}
                  disabled={step === 'confirm'}
                />
                {exceedsBalance && (
                  <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
                    Exceeds available balance ({balance} {isMultiEdition ? 'editions' : symbol})
                  </div>
                )}
                {/* parseUnits returns null when the input carries more decimal
                    places than the token actually has — silently truncating
                    would send a different amount than the one on screen. */}
                {asset && amount.trim() !== '' && rawAmount == null && (
                  <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
                    {isMultiEdition
                      ? 'Editions must be a whole number.'
                      : `${symbol} supports at most ${amountDecimals} decimal place${amountDecimals === 1 ? '' : 's'}.`}
                  </div>
                )}
              </div>
            )}

            {step === 'form' && chainType !== 'midnight' && (
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

            {asset && chainType === 'cardano' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Cardano requires a small amount of ADA to travel with any token. The wallet
                works out the minimum and attaches it automatically — it stays spendable by
                the recipient.
              </div>
            )}

            {asset && chainType !== 'cardano' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                The network fee is paid in {networkName}’s native coin, not in
                the asset you’re sending — keep a little of it in this wallet.
              </div>
            )}

            {chainType === 'midnight' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Fees are paid automatically in DUST, generated by holding NIGHT — never deducted from the amount you're sending. First send from a wallet includes a one-time registration step.
              </div>
            )}

            {totalExceeds && (
              <div style={{ fontSize: 11, color: 'var(--error)' }}>
                Amount + network fee exceeds your balance — use MAX to send the most it can cover.
              </div>
            )}

            {step === 'form' && (fee || source === 'agw' || chainType === 'midnight') && (
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
                    Sending{' '}
                    <strong>
                      {isNft
                        ? (isMultiEdition ? `${amount} × ${assetLabel || 'NFT'}` : (assetLabel || 'NFT'))
                        : `${amount} ${symbol}`}
                    </strong>
                    {' '}to{' '}
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

        {/* ── REGISTERING step (Midnight only, usually one-time) ── */}
        {step === 'registering' && (
          <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div className="spinner" />
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {dustStatus && !dustStatus.ready && !dustStatus.error
                ? `Preparing Midnight fees — ${dustStatus.percent.toFixed(0)}%`
                : 'Preparing Midnight fees…'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>First time can take a few minutes — this only happens once.</div>
          </div>
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
            {result.explorerUrl && (
              <a
                href={result.explorerUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--accent)', textDecoration: 'none', padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
              >
                View on Explorer ↗
              </a>
            )}
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
