/**
 * sidepanel.tsx — Extension side panel entry point
 *
 * Identical to popup.tsx but marks the context as side panel so
 * ExtApp renders the "back to popup" button instead of the sidebar button.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createExtensionWallet } from './bridge'
import { ExtApp } from './ExtApp'

;(window as any).__SIDE_PANEL__ = true
;(window as any).wallet = createExtensionWallet()

import '../renderer/index.css'
import './sidepanel.css'

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ExtApp />
  </StrictMode>
)
