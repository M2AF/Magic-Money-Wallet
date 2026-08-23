/**
 * ColorPicker.tsx — the colour control behind custom themes.
 *
 * Three ways in, all editing the same value:
 *  - a full HSV wheel (hue around, saturation outward) plus a brightness slider
 *  - typed values, switchable between HEX, RGB channels and HSL channels
 *  - an eyedropper that samples any pixel on screen, in any application
 *
 * The dropper is routed, not feature-sniffed. `window.EyeDropper` is a trap in
 * Electron: the binding IS present in a secure context, but open() rejects
 * immediately with `AbortError: The user canceled the selection` because the
 * browser-side picker lives in //chrome and Electron does not implement it
 * (measured on Electron 43 / Chrome 150). Sniffing for the constructor would
 * therefore look like support and behave like a user cancel — a silent
 * no-op. So the wallet bridge is tried FIRST wherever it exists (Electron;
 * see main/eyedropper.ts) and window.EyeDropper is only the fallback for the
 * extension, where it genuinely works. dropperAvailability() below decides what
 * each surface actually gets.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  hsvToRgb,
  parseColor,
  parseHex,
  rgbToHsl,
  rgbToHsv,
  hslToRgb,
  toHex,
  clamp255,
  normalizeHue,
  type HSV
} from '../lib/color'

type Format = 'hex' | 'rgb' | 'hsl'
const FORMATS: Format[] = ['hex', 'rgb', 'hsl']

/** Backing-store size of the wheel; CSS size is half, for a crisp 2x render. */
const WHEEL_PX = 320

interface Props {
  /** Current colour as `#rrggbb`. */
  value: string
  onChange: (hex: string) => void
  /** Shown above the swatch row. */
  label: string
}

/**
 * Sample a pixel from anywhere on screen. Returns null when the user cancels;
 * throws with a readable message when the platform refuses.
 */
async function sampleScreen(): Promise<string | null> {
  // Order matters — see the header note on Electron's inert EyeDropper.
  if (typeof window.wallet?.pickScreenColor === 'function') {
    return window.wallet.pickScreenColor()
  }
  const Native = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
  if (Native) {
    try {
      return (await new Native().open()).sRGBHex
    } catch {
      return null // AbortError — the user pressed Escape
    }
  }
  throw new Error('This device has no screen colour picker')
}

/**
 * Where the dropper stands on this surface:
 *  - 'bridge'        the wallet's own picker (Electron)
 *  - 'native'        Chromium's, which really works here (extension side panel
 *                    and the windowed instance)
 *  - 'popup-blocked' Chromium's picker would work, but it takes focus and an
 *                    ANCHORED extension popup closes the moment it loses focus,
 *                    which would throw away the theme being edited. Offer the
 *                    sidebar instead of a control that destroys their work.
 *  - 'none'          the Android/iOS WebViews, which implement neither
 */
export function dropperAvailability(): 'bridge' | 'native' | 'popup-blocked' | 'none' {
  if (typeof window.wallet?.pickScreenColor === 'function') return 'bridge'
  if (!('EyeDropper' in window)) return 'none'
  const inExtension = location.protocol === 'chrome-extension:'
  const isSidePanel = !!(window as unknown as { __SIDE_PANEL__?: boolean }).__SIDE_PANEL__
  const isWindowed = new URLSearchParams(location.search).get('windowed') === '1'
  return inExtension && !isSidePanel && !isWindowed ? 'popup-blocked' : 'native'
}

export function ColorPicker({ value, onChange, label }: Props) {
  const rgb = parseHex(value) ?? { r: 0, g: 0, b: 0 }
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(rgb))
  const [format, setFormat] = useState<Format>('hex')
  const [draft, setDraft] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wheelRef = useRef<HTMLDivElement | null>(null)

  // Follow the value when it is changed from OUTSIDE the wheel (typed, dropped,
  // or a different swatch selected). Comparing the rendered hex rather than the
  // HSV keeps hue and saturation alive at v = 0, where they are unrecoverable
  // from the RGB alone — otherwise dragging to black would reset the wheel.
  useEffect(() => {
    const next = parseHex(value)
    if (!next) return
    if (toHex(hsvToRgb(hsv)) !== toHex(next)) setHsv(rgbToHsv(next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // The wheel is the hue/saturation plane at FULL brightness, always — never
  // dimmed to the current value. Most themes start from a near-black background
  // (Moonlight's is 12% brightness), and a wheel rendered at that value is a
  // black disc you cannot pick a hue from. Brightness is the slider's job; the
  // knob and the chip carry the real colour. Painted once — nothing it draws
  // depends on state.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const size = WHEEL_PX
    const radius = size / 2
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius + 0.5
        const dy = y - radius + 0.5
        const dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * size + x) * 4
        if (dist > radius) { img.data[i + 3] = 0; continue }
        const c = hsvToRgb({
          h: normalizeHue(Math.atan2(dy, dx) * 180 / Math.PI),
          s: Math.min(100, dist / radius * 100),
          v: 100
        })
        img.data[i] = clamp255(c.r)
        img.data[i + 1] = clamp255(c.g)
        img.data[i + 2] = clamp255(c.b)
        // Feather the last pixel of the rim so the circle isn't jagged.
        img.data[i + 3] = dist > radius - 1 ? Math.round(255 * (radius - dist)) : 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [])

  const emit = useCallback((next: HSV) => {
    setHsv(next)
    setDraft(null)
    onChange(toHex(hsvToRgb(next)))
  }, [onChange])

  /** Map a pointer position on the wheel to hue + saturation. */
  const pickAt = useCallback((clientX: number, clientY: number) => {
    const el = wheelRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const radius = box.width / 2
    const dx = clientX - box.left - radius
    const dy = clientY - box.top - radius
    const dist = Math.sqrt(dx * dx + dy * dy)
    emit({
      h: normalizeHue(Math.atan2(dy, dx) * 180 / Math.PI),
      // Clamped, not ignored: dragging past the rim keeps tracking the hue at
      // full saturation instead of freezing the moment the pointer leaves.
      s: Math.min(100, dist / radius * 100),
      v: hsv.v
    })
  }, [emit, hsv.v])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pickAt(e.clientX, e.clientY)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return
    pickAt(e.clientX, e.clientY)
  }

  const runDropper = async () => {
    if (dropping) return
    setDropping(true); setDropError(null)
    try {
      const picked = await sampleScreen()
      if (picked) {
        const parsed = parseHex(picked)
        if (parsed) { setDraft(null); onChange(toHex(parsed)) }
      }
    } catch (e) {
      setDropError(e instanceof Error ? e.message.replace(/^Error:\s*/, '') : String(e))
    } finally {
      setDropping(false)
    }
  }

  // ── Typed input ────────────────────────────────────────────────────────────
  const hsl = rgbToHsl(rgb)
  const channels: { key: string; label: string; value: number; max: number; suffix?: string }[] =
    format === 'rgb'
      ? [
          { key: 'r', label: 'R', value: Math.round(rgb.r), max: 255 },
          { key: 'g', label: 'G', value: Math.round(rgb.g), max: 255 },
          { key: 'b', label: 'B', value: Math.round(rgb.b), max: 255 }
        ]
      : [
          { key: 'h', label: 'H', value: Math.round(hsl.h), max: 360, suffix: '°' },
          { key: 's', label: 'S', value: Math.round(hsl.s), max: 100, suffix: '%' },
          { key: 'l', label: 'L', value: Math.round(hsl.l), max: 100, suffix: '%' }
        ]

  const setChannel = (key: string, raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    if (format === 'rgb') {
      const next = { ...rgb, [key]: clamp255(n) }
      setDraft(null)
      onChange(toHex(next))
    } else {
      const next = { ...hsl, [key]: key === 'h' ? normalizeHue(n) : Math.max(0, Math.min(100, n)) }
      setDraft(null)
      onChange(toHex(hslToRgb(next)))
    }
  }

  const commitText = (raw: string) => {
    const parsed = parseColor(raw)
    if (parsed) { setDraft(null); onChange(toHex(parsed)) }
    else setDraft(raw)   // keep the half-typed value on screen rather than snapping back
  }

  const dropper = dropperAvailability()
  const hueOnly = toHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: 100 }))
  const knobRadius = hsv.s / 100 * 50
  const knobX = 50 + Math.cos(hsv.h * Math.PI / 180) * knobRadius
  const knobY = 50 + Math.sin(hsv.h * Math.PI / 180) * knobRadius

  return (
    <div className="color-picker">
      <div className="color-picker-head">
        <span className="color-picker-label">{label}</span>
        <span className="color-picker-chip" style={{ background: value }} aria-hidden />
      </div>

      <div
        ref={wheelRef}
        className="color-wheel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        role="application"
        aria-label={`${label} colour wheel`}
      >
        <canvas ref={canvasRef} width={WHEEL_PX} height={WHEEL_PX} />
        <span
          className="color-wheel-knob"
          style={{ left: `${knobX}%`, top: `${knobY}%`, background: value }}
        />
      </div>

      <label className="color-value">
        <span className="color-value-label">Brightness</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv.v)}
          onChange={e => emit({ ...hsv, v: Number(e.target.value) })}
          style={{ background: `linear-gradient(90deg, #000, ${hueOnly})` }}
          aria-label={`${label} brightness`}
        />
      </label>

      <div className="color-fields">
        <div className="color-format" role="group" aria-label="Colour format">
          {FORMATS.map(f => (
            <button
              key={f}
              type="button"
              className={`color-format-btn${format === f ? ' active' : ''}`}
              onClick={() => { setFormat(f); setDraft(null) }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {format === 'hex' ? (
          <input
            className="input color-hex"
            value={draft ?? value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`${label} hex value`}
            onChange={e => commitText(e.target.value)}
            onBlur={() => setDraft(null)}
          />
        ) : (
          <div className="color-channels">
            {channels.map(c => (
              <label key={c.key} className="color-channel">
                <span>{c.label}</span>
                <input
                  type="number"
                  min={0}
                  max={c.max}
                  value={c.value}
                  aria-label={`${label} ${c.label}`}
                  onChange={e => setChannel(c.key, e.target.value)}
                />
                {c.suffix && <em>{c.suffix}</em>}
              </label>
            ))}
          </div>
        )}

        {dropper === 'bridge' || dropper === 'native' ? (
          <button
            type="button"
            className="color-dropper"
            onClick={runDropper}
            disabled={dropping}
            title="Pick a colour from anywhere on your screen"
            aria-label="Pick a colour from the screen"
          >
            {dropping ? '…' : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2 22 1-1h3l9-9" />
                <path d="M3 21v-3l9-9" />
                <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
              </svg>
            )}
          </button>
        ) : null}
      </div>

      {dropper === 'popup-blocked' && (
        <div className="color-hint">
          Open the wallet in the sidebar to pick colours straight off your screen.
        </div>
      )}
      {dropping && (
        // The first open is slow — desktopCapturer warms up and encodes one
        // full-resolution PNG per display (measured ~5s on a four-monitor
        // setup, well under a second thereafter). Say what is happening rather
        // than leaving a disabled button.
        <div className="color-hint">Freezing the screen… then click any pixel.</div>
      )}
      {dropError && <div className="color-error">{dropError}</div>}
    </div>
  )
}
