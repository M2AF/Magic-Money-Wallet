/**
 * main.tsx — iOS/Capacitor entry point
 *
 * Deliberately identical in shape to src/capacitor/main.tsx (the Android
 * entry): the WebView-side code is the same on both native targets, and the
 * platform differences are resolved by the alias table in vite.ios.config.ts,
 * not by branching here. If this file and the Android one ever diverge beyond
 * the stylesheet import, something belongs in an alias instead.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installFetchGuard } from '../capacitor/fetch-guard'
import { createCapacitorWallet } from '../capacitor/wallet-local'
import { initWalletConnect } from '../extension/wc-ext'
import { initDappGlue } from '../capacitor/dapp-glue'
import { CapApp } from '../capacitor/CapApp'

installFetchGuard()
initDappGlue()

// Install the provider before any React code runs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).wallet = createCapacitorWallet()

// Pull in shared styles (NOT popup.css — it hard-pins the 400×600 popup size).
// cap.css carries the phone layout + safe areas for BOTH native targets;
// ios.css adds only the WKWebView-specific overrides.
import '../renderer/index.css'
import '../capacitor/cap.css'
import './ios.css'
import { initTheme } from '../renderer/theme'

initTheme()

initWalletConnect().catch(e => console.error('[WC] startup error:', e))

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <CapApp />
  </StrictMode>
)
