import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { App } from './App'
import { BrowserApp } from './BrowserApp'

// Popup browser chrome uses the same index.html with ?browserChrome=1
const isBrowserChrome = new URLSearchParams(window.location.search).has('browserChrome')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isBrowserChrome ? <BrowserApp /> : <App />}
  </React.StrictMode>
)
