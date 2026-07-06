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

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ExtApp />
  </StrictMode>
)
