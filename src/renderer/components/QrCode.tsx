/**
 * QrCode.tsx — canvas QR code (receive addresses, WalletConnect URIs)
 *
 * Shared across all targets. Always renders dark-on-white with a quiet zone —
 * scanability beats theme purity (dark-themed QRs fail on many camera stacks).
 */

import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    }).catch(() => { /* value too long for a QR — leave blank */ })
  }, [value, size])

  return (
    <canvas
      ref={ref}
      aria-label="QR code"
      style={{ borderRadius: 12, background: '#fff', display: 'block' }}
    />
  )
}
