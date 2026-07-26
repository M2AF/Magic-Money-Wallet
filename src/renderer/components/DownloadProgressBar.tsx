/**
 * DownloadProgressBar.tsx — MagicMoney Wallet
 *
 * A 2px neon-green line pinned to the very top edge of the WALLET window (never
 * the dApp browser) while an NFT download is in flight. Mounted once by App, so
 * it survives tab switches and closing the NFT sheet mid-download.
 *
 * Two modes, decided by the main process:
 *   • percent known  → the bar fills left→right.
 *   • percent null   → the source sent no Content-Length, so a short segment
 *                      sweeps across instead of faking a percentage.
 *
 * On completion it snaps to 100%, holds briefly so the finish is legible even
 * for a 40 kB image, then fades out.
 */

import { useEffect, useRef, useState } from 'react'
import type { DownloadProgress } from '../types/wallet'

const HOLD_MS = 500   // time at 100% before fading, so fast saves still register
const FADE_MS = 400

export function DownloadProgressBar() {
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [fading, setFading] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (typeof window.wallet?.onDownloadProgress !== 'function') return

    const clearTimers = () => { for (const t of timers.current) window.clearTimeout(t); timers.current = [] }

    const onProgress = (p: DownloadProgress) => {
      clearTimers()
      if (p.active) {
        setFading(false)
        setProgress(p)
        return
      }
      // Finished (or failed): complete the bar, hold, then fade it away.
      setProgress({ active: false, percent: 100 })
      timers.current.push(window.setTimeout(() => setFading(true), HOLD_MS))
      timers.current.push(window.setTimeout(() => { setProgress(null); setFading(false) }, HOLD_MS + FADE_MS))
    }

    window.wallet.onDownloadProgress(onProgress)
    return () => {
      clearTimers()
      window.wallet.offDownloadProgress?.(onProgress)
    }
  }, [])

  if (!progress) return null

  const indeterminate = progress.active && progress.percent === null

  return (
    <div
      className="download-bar-track"
      role="progressbar"
      aria-label="Downloading"
      aria-valuenow={progress.percent ?? undefined}
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}
    >
      <div
        className={`download-bar-fill${indeterminate ? ' indeterminate' : ''}`}
        style={indeterminate ? undefined : { width: `${progress.percent ?? 0}%` }}
      />
    </div>
  )
}
