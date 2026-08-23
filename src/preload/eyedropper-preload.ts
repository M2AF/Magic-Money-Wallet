/**
 * eyedropper-preload.ts — MagicMoney Wallet
 *
 * The whole screen-colour picker overlay (see main/eyedropper.ts). The window
 * it runs in loads an EMPTY document on purpose: building the UI from the
 * preload keeps the picker out of the renderer bundle and means the page needs
 * no script of its own — nothing but our own frozen screenshot is ever drawn.
 *
 * The preload runs in an isolated world but shares the DOM, so no contextBridge
 * surface is exposed: this file talks to main directly and the page has no
 * scriptable API at all.
 */

import { ipcRenderer } from 'electron'

interface StartPayload {
  /** One-shot reply channel minted by the main process. */
  channel: string
  /** PNG data URL of this display, at native resolution. */
  image: string
}

/** Diameter of the magnifier, in CSS px. */
const LOUPE_SIZE = 132
/** How many screen pixels across the magnifier shows. */
const LOUPE_PIXELS = 11

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

ipcRenderer.on('eyedropper:start', (_event, payload: StartPayload) => {
  if (!payload?.channel || !payload?.image) return
  const start = () => build(payload)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})

function build({ channel, image }: StartPayload): void {
  let settled = false
  const send = (hex: string | null) => {
    if (settled) return
    settled = true
    ipcRenderer.send(channel, { hex })
  }

  const style = document.createElement('style')
  style.textContent = `
    html, body { margin: 0; height: 100%; overflow: hidden; background: #000; cursor: crosshair; }
    #shot { position: fixed; inset: 0; width: 100vw; height: 100vh; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
    #loupe {
      position: fixed; width: ${LOUPE_SIZE}px; height: ${LOUPE_SIZE}px;
      border-radius: 50%; pointer-events: none; opacity: 0;
      border: 2px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 6px 22px rgba(0, 0, 0, 0.55);
      image-rendering: pixelated;
      background-repeat: no-repeat;
    }
    /* One-pixel target ring at the centre of the magnifier. */
    #target {
      position: fixed; width: ${Math.round(LOUPE_SIZE / LOUPE_PIXELS)}px; height: ${Math.round(LOUPE_SIZE / LOUPE_PIXELS)}px;
      pointer-events: none; opacity: 0;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.9);
    }
    #readout {
      position: fixed; pointer-events: none; opacity: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(10, 10, 12, 0.92); color: #fff;
      font: 600 12px/1 ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
      letter-spacing: 0.04em;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
    }
    #chip { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.35); }
    #hint {
      position: fixed; left: 50%; top: 28px; transform: translateX(-50%);
      padding: 9px 16px; border-radius: 999px; pointer-events: none;
      background: rgba(10, 10, 12, 0.9); color: rgba(255, 255, 255, 0.92);
      font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
    }
  `
  document.head.appendChild(style)

  const shot = document.createElement('img')
  shot.id = 'shot'
  shot.draggable = false

  const loupe = document.createElement('div')
  loupe.id = 'loupe'
  const target = document.createElement('div')
  target.id = 'target'

  const readout = document.createElement('div')
  readout.id = 'readout'
  const chip = document.createElement('span')
  chip.id = 'chip'
  const label = document.createElement('span')
  label.textContent = '#------'
  readout.append(chip, label)

  const hint = document.createElement('div')
  hint.id = 'hint'
  hint.textContent = 'Click to pick a colour · Esc to cancel'

  document.body.append(shot, loupe, target, readout, hint)

  // Off-screen copy of the capture at native size — the only place pixels are
  // read from. Nothing leaves this window except the final six hex digits.
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let ready = false

  shot.onload = () => {
    canvas.width = shot.naturalWidth
    canvas.height = shot.naturalHeight
    ctx?.drawImage(shot, 0, 0)
    // Magnifier shows LOUPE_PIXELS screen pixels across, so scale the same
    // bitmap up by that factor and offset it to centre on the cursor.
    const zoom = LOUPE_SIZE / LOUPE_PIXELS
    loupe.style.backgroundImage = `url("${image}")`
    loupe.style.backgroundSize = `${shot.naturalWidth * zoom}px ${shot.naturalHeight * zoom}px`
    ready = true
  }
  shot.src = image

  /** Cursor position (CSS px) → colour under it, as #rrggbb. */
  const colorAt = (clientX: number, clientY: number): { hex: string; ix: number; iy: number } | null => {
    if (!ready || !ctx) return null
    const ix = Math.min(canvas.width - 1, Math.max(0, Math.floor(clientX / window.innerWidth * canvas.width)))
    const iy = Math.min(canvas.height - 1, Math.max(0, Math.floor(clientY / window.innerHeight * canvas.height)))
    const [r, g, b] = ctx.getImageData(ix, iy, 1, 1).data
    return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, ix, iy }
  }

  let current: string | null = null
  let focusAsked = false

  const onMove = (e: MouseEvent) => {
    // The pointer is on THIS display now, so this overlay should own the
    // keyboard (Escape) and the next click. Without it, only the display the
    // picker opened on is focused: Escape does nothing on the others, and
    // Windows can eat the first click on an unfocused window as an activation.
    if (!focusAsked) {
      focusAsked = true
      ipcRenderer.send(channel, { focus: true })
    }

    const hit = colorAt(e.clientX, e.clientY)
    if (!hit) return
    current = hit.hex

    const zoom = LOUPE_SIZE / LOUPE_PIXELS
    // Keep the magnifier clear of the cursor, and inside the display.
    const lx = Math.min(window.innerWidth - LOUPE_SIZE - 8, Math.max(8, e.clientX + 18))
    const ly = Math.min(window.innerHeight - LOUPE_SIZE - 8, Math.max(8, e.clientY + 18))
    loupe.style.left = `${lx}px`
    loupe.style.top = `${ly}px`
    loupe.style.backgroundPosition =
      `${-(hit.ix * zoom) + LOUPE_SIZE / 2}px ${-(hit.iy * zoom) + LOUPE_SIZE / 2}px`
    loupe.style.opacity = '1'

    const cell = Math.round(LOUPE_SIZE / LOUPE_PIXELS)
    target.style.left = `${lx + LOUPE_SIZE / 2 - cell / 2}px`
    target.style.top = `${ly + LOUPE_SIZE / 2 - cell / 2}px`
    target.style.opacity = '1'

    chip.style.background = hit.hex
    label.textContent = hit.hex
    readout.style.left = `${lx}px`
    readout.style.top = `${Math.min(window.innerHeight - 36, ly + LOUPE_SIZE + 8)}px`
    readout.style.opacity = '1'
  }

  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    const hit = colorAt(e.clientX, e.clientY)
    send(hit?.hex ?? current)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); send(null) }
  }

  window.addEventListener('mousemove', onMove, { passive: true })
  window.addEventListener('mousedown', onClick)
  // Right-click cancels. Deliberately NOT window blur: with one overlay per
  // display, focus moves between them as the cursor crosses monitors, and
  // treating that as a cancel would close the picker the moment it opened.
  window.addEventListener('contextmenu', e => { e.preventDefault(); send(null) })
  window.addEventListener('keydown', onKey)
}
