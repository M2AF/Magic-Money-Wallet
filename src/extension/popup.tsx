/**
 * popup.tsx — Extension popup entry point
 *
 * 1. Installs window.wallet using the chrome.runtime bridge
 * 2. Injects extension-specific CSS overrides (no custom titlebar)
 * 3. Renders ExtApp (handles lock/password states, then delegates to App)
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createExtensionWallet } from './bridge'
import { ExtApp } from './ExtApp'

// Install the bridge before any React code runs
;(window as any).wallet = createExtensionWallet()

// Pull in shared styles
import '../renderer/index.css'
import './popup.css'
import { initTheme } from '../renderer/theme'

initTheme()

// The floating approval window (platform.ts opens it with ?windowed=1) has an
// OUTER size that must fit popup.css's fixed 400×600 content box PLUS the OS
// title bar and window borders — overhead that varies by system/theme/DPI, so
// a hardcoded width/height is always a guess. Measure it once here (current
// outer size minus current inner viewport = the fixed chrome overhead) and
// snap to the exact size instead. The toolbar's anchored default_popup has no
// window chrome at all, so this only runs for the windowed instance.
if (new URLSearchParams(location.search).get('windowed') === '1') {
  requestAnimationFrame(() => {
    const overheadX = window.outerWidth - window.innerWidth
    const overheadY = window.outerHeight - window.innerHeight
    try { window.resizeTo(400 + overheadX, 600 + overheadY) } catch { /* not resizable in this context */ }
  })
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ExtApp />
  </StrictMode>
)
