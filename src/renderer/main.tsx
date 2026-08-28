import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { App } from './App'
import { BrowserApp } from './BrowserApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initTheme } from './theme'
import { initCurrency } from './lib/currency'

// Stamp the saved theme on <html> before first paint to avoid a color flash
initTheme()
initCurrency()

// Popup browser chrome uses the same index.html with ?browserChrome=1
const isBrowserChrome = new URLSearchParams(window.location.search).has('browserChrome')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isBrowserChrome ? <BrowserApp /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
