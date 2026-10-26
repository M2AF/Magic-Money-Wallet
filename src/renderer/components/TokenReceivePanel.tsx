/**
 * TokenReceivePanel.tsx — receive view inside the token details dialog.
 *
 * Address-only: the QR payload and the Copy string are the SAME value
 * (`receive.qrPayload`), and both are null unless the shared resolver reported
 * `available`. Nothing here derives an address itself.
 */

import { useEffect, useRef, useState } from 'react'
import type { TokenReceiveResult } from '../../shared/token-details'
import { QrCode } from './QrCode'

interface Props {
  tokenName: string
  tokenSymbol: string
  networkLabel: string
  /** Null while the shared resolver is still running. */
  receive: TokenReceiveResult | null
  accountLabel: string
  sourceLabel: string
  onBack: () => void
}

export function TokenReceivePanel({ tokenName, tokenSymbol, networkLabel, receive, accountLabel, sourceLabel, onBack }: Props) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const payload = receive?.capability.state === 'available' ? receive.qrPayload : null

  const doCopy = async () => {
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopy('idle'), 2500)
  }

  return (
    <div className="tdp-receive">
      <button type="button" className="tdp-link" onClick={onBack}>← Back to details</button>

      <dl className="tdp-facts">
        <div><dt>Token</dt><dd>{tokenName} <span className="tdp-mono">({tokenSymbol})</span></dd></div>
        <div><dt>Network</dt><dd>{networkLabel}</dd></div>
        <div><dt>Account</dt><dd>{accountLabel}</dd></div>
        <div><dt>Holding source</dt><dd>{sourceLabel}</dd></div>
      </dl>

      {receive === null && (
        <p className="tdp-note" role="status">Checking receive address…</p>
      )}

      {receive !== null && !payload && (
        <p className="tdp-note tdp-note--warn" role="alert">{receive.capability.reason}</p>
      )}

      {payload && (
        <>
          <div className="tdp-qr"><QrCode value={payload} size={208} /></div>
          <div className="tdp-address" data-testid="token-receive-address">{payload}</div>
          <button type="button" className="tdp-btn tdp-btn--primary" onClick={doCopy}>
            {copy === 'copied' ? 'Copied' : 'Copy address'}
          </button>
          <p className="tdp-note" role="status">
            {copy === 'failed'
              ? 'Copy failed — select the address above and copy it manually.'
              : receive?.capability.reason}
          </p>
        </>
      )}
    </div>
  )
}
