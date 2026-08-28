/**
 * main.tsx — Android/Capacitor entry point
 *
 * 1. Installs the AbortSignal fetch guard over CapacitorHttp's patched fetch
 * 2. Installs window.wallet as the in-process provider (no message passing —
 *    the shared handle() router lives in this same WebView)
 * 3. Boots WalletConnect (same wc-ext module the extension uses)
 * 4. Renders CapApp (lock/password states, then delegates to the shared App)
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installFetchGuard } from './fetch-guard'
import { createCapacitorWallet } from './wallet-local'
import { initWalletConnect } from '../extension/wc-ext'
import { initDappGlue } from './dapp-glue'
import { CapApp } from './CapApp'

installFetchGuard()
initDappGlue()

// Install the provider before any React code runs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).wallet = createCapacitorWallet()

// Pull in shared styles (NOT popup.css — it hard-pins the 400×600 popup size)
import '../renderer/index.css'
import './cap.css'
import { initTheme } from '../renderer/theme'
import { initCurrency } from '../renderer/lib/currency'

initTheme()
initCurrency()

initWalletConnect().catch(e => console.error('[WC] startup error:', e))

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <CapApp />
  </StrictMode>
)
