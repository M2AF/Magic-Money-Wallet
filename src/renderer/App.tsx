import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses, MainTab } from './types/wallet'
import { LoadingPage } from './pages/LoadingPage'
import { WelcomePage } from './pages/WelcomePage'
import { CreatePage } from './pages/CreatePage'
import { ConfirmPage } from './pages/ConfirmPage'
import { ImportPage } from './pages/ImportPage'
import { DashboardPage } from './pages/DashboardPage'
import { MarketPage } from './pages/MarketPage'

export function App() {
  const [page, setPage]       = useState<AppPage>('loading')
  const [addresses, setAddresses] = useState<WalletAddresses | null>(null)
  const [activeTab, setActiveTab] = useState<MainTab>('portfolio')

  useEffect(() => {
    window.wallet.isSetup().then(exists => {
      if (exists) {
        window.wallet.getAddresses().then(addrs => {
          setAddresses(addrs)
          setPage('dashboard')
        })
      } else {
        setPage('welcome')
      }
    }).catch(() => setPage('welcome'))
  }, [])

  const handleWalletReady = (addrs: WalletAddresses) => {
    setAddresses(addrs)
    setPage('dashboard')
  }

  const inDashboard = page === 'dashboard'

  return (
    <div className="app-shell">
      {/* Custom titlebar */}
      <div className="titlebar">
        <span className="titlebar-title">MagicMoney Wallet</span>
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn min" onClick={() => window.wallet.minimize()} title="Minimize" />
          <button type="button" className="titlebar-btn close" onClick={() => window.wallet.close()} title="Close" />
        </div>
      </div>

      {/* Page router */}
      {page === 'loading'  && <LoadingPage />}
      {page === 'welcome'  && <WelcomePage onNavigate={setPage} />}
      {page === 'create'   && <CreatePage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'confirm'  && <ConfirmPage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'import'   && <ImportPage onNavigate={setPage} onComplete={handleWalletReady} />}
      {inDashboard && addresses && activeTab === 'portfolio' && (
        <DashboardPage
          addresses={addresses}
          onNavigate={setPage}
          onWalletDeleted={() => { setAddresses(null); setPage('welcome') }}
        />
      )}
      {inDashboard && addresses && activeTab === 'market' && (
        <MarketPage />
      )}

      {/* Bottom nav — only shown in dashboard */}
      {inDashboard && (
        <nav className="bottom-nav">
          <button
            type="button"
            className={`bottom-nav-btn${activeTab === 'portfolio' ? ' active' : ''}`}
            onClick={() => setActiveTab('portfolio')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <rect x="2" y="3" width="6" height="10" rx="1.5"/>
              <rect x="10" y="3" width="12" height="6" rx="1.5"/>
              <rect x="10" y="11" width="12" height="10" rx="1.5"/>
              <rect x="2" y="15" width="6" height="6" rx="1.5"/>
            </svg>
            Portfolio
          </button>

          <button
            type="button"
            className={`bottom-nav-btn${activeTab === 'market' ? ' active' : ''}`}
            onClick={() => setActiveTab('market')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Market
          </button>

          <button
            type="button"
            className="bottom-nav-btn"
            disabled
            title="Coming in Phase 6"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Browser
          </button>
        </nav>
      )}
    </div>
  )
}
