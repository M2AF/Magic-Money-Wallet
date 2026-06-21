/// <reference lib="dom" />
/**
 * popup-chrome.ts — MagicMoney Wallet
 *
 * Preload for the frameless connect/auth popups the dApp browser opens
 * (Abstract Global Wallet cross-app connect, Google sign-in, WalletConnect web…).
 *
 * It injects a slim branded titlebar so these windows match the wallet's dark,
 * frameless look instead of the default OS chrome. This is a pure DOM OVERLAY:
 * we only append one fixed-position bar over the top of the page — we never
 * mutate the provider's own layout or content (that page is their site; we don't
 * touch it). Injecting nodes/styles programmatically is CSP-safe, so it works
 * even on strict pages.
 *
 * Drag uses `-webkit-app-region: drag` (the window is frameless). The close
 * button reuses the existing `window:close` IPC, which closes the sender's
 * window in the main process.
 */

import { ipcRenderer } from 'electron'
import { WALLET_ICON } from './wallet-icon'

const BAR_ID = '__mm_titlebar__'
const ORIGIN_ID = '__mm_titlebar_origin__'
const BAR_H = 36

function buildTitlebar(): void {
  if (!document.body || document.getElementById(BAR_ID)) return

  const bar = document.createElement('div')
  bar.id = BAR_ID
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', `height:${BAR_H}px`,
    'display:flex', 'align-items:center', 'gap:8px', 'padding:0 6px 0 10px',
    'background:#0b1220', 'color:#e5e7eb',
    "font:600 12px/1 -apple-system,'Segoe UI',system-ui,sans-serif",
    'border-bottom:1px solid rgba(255,255,255,0.08)',
    'box-shadow:0 1px 6px rgba(0,0,0,0.35)',
    'z-index:2147483647', 'box-sizing:border-box', 'user-select:none',
    '-webkit-app-region:drag'
  ].join(';')

  const logo = document.createElement('img')
  logo.src = WALLET_ICON
  logo.width = 18
  logo.height = 18
  logo.style.cssText = 'border-radius:5px;flex:0 0 auto'

  const name = document.createElement('span')
  name.textContent = 'MagicMoney'
  name.style.cssText = 'font-weight:700;letter-spacing:.2px;flex:0 0 auto;color:#f1f5f9'

  const origin = document.createElement('div')
  origin.style.cssText =
    'flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:5px;' +
    'min-width:0;color:#9aa4b2;font-weight:500'
  const lock = document.createElement('span')
  lock.textContent = '🔒'
  lock.style.cssText = 'font-size:10px;flex:0 0 auto;opacity:.85'
  const host = document.createElement('span')
  host.id = ORIGIN_ID
  host.textContent = location.hostname
  host.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  origin.appendChild(lock)
  origin.appendChild(host)

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.title = 'Close'
  close.style.cssText = [
    '-webkit-app-region:no-drag', 'flex:0 0 auto', 'cursor:pointer', 'border:0',
    'background:transparent', 'color:#9aa4b2', 'font-size:13px', 'padding:0',
    'width:28px', 'height:24px', 'border-radius:6px', 'line-height:1',
    'transition:background .12s,color .12s'
  ].join(';')
  close.addEventListener('mouseenter', () => {
    close.style.background = 'rgba(255,90,90,0.18)'
    close.style.color = '#ff6b6b'
  })
  close.addEventListener('mouseleave', () => {
    close.style.background = 'transparent'
    close.style.color = '#9aa4b2'
  })
  close.addEventListener('click', () => ipcRenderer.send('window:close'))

  bar.appendChild(logo)
  bar.appendChild(name)
  bar.appendChild(origin)
  bar.appendChild(close)
  document.body.appendChild(bar)
}

function refreshOrigin(): void {
  const el = document.getElementById(ORIGIN_ID)
  if (el) el.textContent = location.hostname
}

function run(): void {
  buildTitlebar()
  refreshOrigin()
}

// The preload re-runs on every full navigation (e.g. OAuth redirects), so the
// bar and hostname stay current. Re-assert on load in case the document swapped.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run)
} else {
  run()
}
window.addEventListener('load', run)
