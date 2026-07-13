import { useState } from 'react'
import { QrCode } from './QrCode'

interface Props {
  address: string
  label?: string
}

export function AddressChip({ address, label }: Props) {
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)

  const truncate = (addr: string) => {
    if (addr.length <= 20) return addr
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`
  }

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="address-chip-wrapper">
      {label && <p className="label">{label}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="address-chip" onClick={copy} title={address} style={{ flex: 1 }}>
          <span>{truncate(address)}</span>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"
            viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: copied ? 0 : 0.5 }}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          {copied && (
            <svg width="12" height="12" fill="none" stroke="#22c55e" strokeWidth="2"
              viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
        <button
          type="button"
          aria-label="Show address QR code"
          title="Show QR code"
          onClick={() => setShowQr(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '5px 7px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)'
          }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <path d="M14 14h3v3h-3zM20 14h1M14 20h1M20 20h1"/>
          </svg>
        </button>
      </div>

      {showQr && (
        <div
          onClick={() => setShowQr(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card, #111)', borderRadius: 20, padding: 22,
              border: '1px solid var(--border, #2a2a2a)', maxWidth: 320, width: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14
            }}
          >
            {label && <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>}
            <QrCode value={address} size={220} />
            <div style={{
              fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--text-muted)',
              overflowWrap: 'anywhere', textAlign: 'center', lineHeight: 1.5
            }}>
              {address}
            </div>
            <button
              type="button"
              onClick={() => { copy(); setShowQr(false) }}
              style={{
                width: '100%', padding: '10px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)'
              }}
            >
              Copy Address
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
