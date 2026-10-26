/**
 * TokenDetailsPanel.tsx — universal details dialog for a listed token.
 *
 * Opening it never requests a signature or transaction. Send/Swap hand the
 * ORIGINAL WalletToken back to the dashboard's existing handlers (exact
 * rawBalance, source-correct); this component only displays `balance`.
 *
 * Capability/receive decisions come from src/shared/token-details — the panel
 * never invents availability. Every async receive result is compared against
 * the live selection key before it is shown.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WalletToken, ChainHistory } from '../types/wallet'
import {
  resolveTokenReceive, tokenDetailsCapabilities, tokenDetailsKey,
  type TokenCapability, type TokenDetailsContext, type TokenReceiveResult,
} from '../../shared/token-details'
import { useDisplayCurrency } from '../lib/currency'
import { BodyPortal } from './BodyPortal'
import { TxList } from './TxList'
import { TokenReceivePanel } from './TokenReceivePanel'
import { ProgrammableTokenSection } from './ProgrammableTokenSection'
import { tokenExplorerUrl, openWalletLink } from '../lib/token-explorer'
import { registerBackHandler } from '../lib/back-handler'
import './TokenDetailsPanel.css'

interface Props {
  token: WalletToken
  context: TokenDetailsContext
  networkLabel: string
  /** Existing TokenLogo / AgwBadge from the dashboard — kept there, not re-implemented. */
  logo: ReactNode
  badges?: ReactNode
  /** Existing canSendToken / swapTokenFromHolding decisions. */
  sendSupported: boolean
  swapSupported: boolean
  /** undefined = no provider entry, null = still loading. */
  history: ChainHistory | null | undefined
  onSend: () => void
  onSwap: () => void
  onClose: () => void
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function CapabilityReason({ cap, id }: { cap: TokenCapability; id: string }) {
  if (cap.state === 'available' || !cap.reason) return null
  return <div id={id} className="tdp-reason">{cap.reason}</div>
}

export function TokenDetailsPanel({
  token, context, networkLabel, logo, badges,
  sendSupported, swapSupported, history, onSend, onSwap, onClose,
}: Props) {
  const { fmt } = useDisplayCurrency()
  const [view, setView] = useState<'details' | 'receive'>('details')
  const [receive, setReceive] = useState<TokenReceiveResult | null>(null)
  const [showActivity, setShowActivity] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  const key = useMemo(() => tokenDetailsKey(token, context), [token, context])

  // Latest props for the async resolver without re-running it on every refresh
  // (a refresh yields a new token object with the SAME key).
  const latest = useRef({ token, context, key })
  latest.current = { token, context, key }

  useEffect(() => {
    let cancelled = false
    setReceive(null)
    const { token: t, context: c } = latest.current
    resolveTokenReceive(t, c, (chainId, address) => window.wallet.validateAddress(chainId, address))
      .then(r => {
        // Stale guard: a response for a previous account/mode/source/chain must
        // never reach the current panel.
        if (!cancelled && r.key === latest.current.key) setReceive(r)
      })
      .catch(() => {
        if (!cancelled) {
          setReceive({
            key, address: null, qrPayload: null,
            capability: { state: 'failed', reason: 'Could not check the receive address. Try again.' },
            identity: { accountIndex: context.accountIndex, accountAddress: context.accountAddress, mode: context.mode,
              chainId: token.chain, tokenIdentifier: token.contractAddress, source: token.source ?? 'eoa',
              sourceAddress: null, deploymentId: null },
          })
        }
      })
    return () => { cancelled = true }
    // key fully identifies account/mode/chain/token/source
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Focus: move into the dialog on open, restore to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    titleRef.current?.focus()
    return () => { if (opener && document.contains(opener)) opener.focus() }
  }, [])

  // Android hardware Back: step out of Receive first, then close the panel.
  // Refs keep one registration for the dialog's lifetime.
  const backRef = useRef<() => void>(() => {})
  backRef.current = () => { if (view === 'receive') setView('details'); else onClose() }
  useEffect(() => registerBackHandler(() => backRef.current()), [])

  // Receive/back is a view change inside the same dialog; keep focus inside it.
  useEffect(() => { titleRef.current?.focus() }, [view])

  const activityScope: 'network' | 'none' =
    history && !history.unsupported && !history.error ? 'network' : 'none'

  const caps = tokenDetailsCapabilities(token, context, {
    sendSupported, swapSupported,
    receive: receive?.capability ?? { state: 'checking', reason: 'Checking receive address.' },
    activityScope,
    // Programmable holdings: facts (or their unknown/error state) come from the
    // reader; the shared helper keeps generic Send/Swap disabled regardless.
    restrictions: token.programmable?.restrictions,
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (view === 'receive') setView('details'); else onClose()
      return
    }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]; const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialogRef.current || active === titleRef.current)) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus()
    }
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(token.contractAddress)
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 1800)
    } catch { /* clipboard blocked — identifier is still selectable text */ }
  }

  const isAgw = token.source === 'agw'
  const sourceLabel = isAgw ? 'Smart account (Abstract Global Wallet)'
    : token.source === 'cip113' ? 'Programmable holding (Cardano)' : 'Wallet address'
  const value = fmt(token.usdValue)
  const explorerUrl = tokenExplorerUrl(token, context.mode)
  const activityCap: TokenCapability = history === null
    ? { state: 'checking', reason: 'Loading network activity…' }
    : caps.activity
  const records = history?.records.slice(0, 5) ?? []

  return (
    <BodyPortal>
      <div className="tdp-overlay" onClick={onClose} onKeyDown={onKeyDown}>
        <div
          ref={dialogRef}
          className="tdp-dialog"
          role="dialog" aria-modal="true" aria-labelledby="tdp-title"
          onClick={e => e.stopPropagation()}
        >
          <header className="tdp-header">
            {logo}
            <div className="tdp-header-text">
              <h2 id="tdp-title" ref={titleRef} tabIndex={-1} className="tdp-title">{token.name}</h2>
              <div className="tdp-sub">
                <span className="tdp-mono">{token.symbol}</span>
                <span className="tdp-chip" style={{ background: `${token.chainColor}22`, color: token.chainColor }}>{token.chainLabel}</span>
                {badges}
              </div>
            </div>
            <button type="button" className="tdp-close" aria-label="Close token details" onClick={onClose}>✕</button>
          </header>

          <div className="tdp-body">
            {view === 'receive' ? (
              <TokenReceivePanel
                tokenName={token.name}
                tokenSymbol={token.symbol}
                networkLabel={networkLabel}
                receive={receive}
                accountLabel={`Account ${context.accountIndex}`}
                sourceLabel={sourceLabel}
                onBack={() => setView('details')}
              />
            ) : (
              <>
                <dl className="tdp-facts">
                  <div>
                    <dt>Holding</dt>
                    <dd className="tdp-mono">{token.balance} {token.symbol}</dd>
                  </div>
                  <div>
                    <dt>Value</dt>
                    <dd className="tdp-mono">{value ?? 'Price unavailable'}</dd>
                  </div>
                  <div><dt>Network</dt><dd>{networkLabel}</dd></div>
                  <div><dt>Holding source</dt><dd>{sourceLabel}</dd></div>
                  <div>
                    <dt>Token identifier</dt>
                    <dd className="tdp-id">
                      <span className="tdp-mono tdp-id-text">{token.contractAddress}</span>
                      <button type="button" className="tdp-link" onClick={copyId}>
                        {idCopied ? 'Copied' : 'Copy'}
                      </button>
                    </dd>
                    {explorerUrl && (
                      <button type="button" className="tdp-link" onClick={() => openWalletLink(explorerUrl)}>
                        View on Cardanoscan ↗
                      </button>
                    )}
                  </div>
                </dl>

                <div className="tdp-actions" role="group" aria-label="Token actions">
                  <button type="button" className="tdp-btn tdp-btn--primary"
                    disabled={caps.send.state !== 'available'} aria-describedby="tdp-send-reason" onClick={onSend}>
                    Send
                  </button>
                  <button type="button" className="tdp-btn"
                    disabled={caps.receive.state === 'unsupported' || caps.receive.state === 'failed'}
                    aria-describedby="tdp-receive-reason" onClick={() => setView('receive')}>
                    Receive
                  </button>
                  <button type="button" className="tdp-btn"
                    disabled={caps.swap.state !== 'available'} aria-describedby={caps.swap.reason === caps.send.reason ? "tdp-send-reason" : "tdp-swap-reason"} onClick={onSwap}>
                    Swap
                  </button>
                </div>
                <CapabilityReason cap={caps.send} id="tdp-send-reason" />
                <CapabilityReason cap={caps.receive.state === 'checking' ? { state: 'available', reason: '' } : caps.receive} id="tdp-receive-reason" />
                <CapabilityReason cap={caps.swap.reason === caps.send.reason ? { state: 'available', reason: '' } : caps.swap} id="tdp-swap-reason" />

                {token.programmable && <ProgrammableTokenSection token={token} />}

                <section className="tdp-activity" aria-label="Network activity">
                  <div className="tdp-section-title">Network activity</div>
                  {activityCap.state === 'available' ? (
                    <>
                      <p className="tdp-note">Recent activity on {networkLabel} — not filtered to this token.</p>
                      <button type="button" className="tdp-link" aria-expanded={showActivity}
                        onClick={() => setShowActivity(s => !s)}>
                        {showActivity ? 'Hide' : 'Show'} recent network activity
                      </button>
                      {showActivity && <TxList records={records} />}
                    </>
                  ) : (
                    <p className="tdp-note" role={activityCap.state === 'checking' ? 'status' : undefined}>
                      {activityCap.reason}
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </BodyPortal>
  )
}
