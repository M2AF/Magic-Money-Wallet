import { useState } from 'react'

interface Props {
  address: string
  label?: string
}

export function AddressChip({ address, label }: Props) {
  const [copied, setCopied] = useState(false)

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
      <div className="address-chip" onClick={copy} title={address}>
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
    </div>
  )
}