import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses, MainTab } from './types/wallet'
import logoUrl from './assets/logo.png'
import { LoadingPage } from './pages/LoadingPage'
import { WelcomePage } from './pages/WelcomePage'
import { CreatePage } from './pages/CreatePage'
import { ConfirmPage } from './pages/ConfirmPage'
import { ImportPage } from './pages/ImportPage'
import { DashboardPage } from './pages/DashboardPage'
import { MarketPage } from './pages/MarketPage'
import { AppHubPage } from './pages/AppHubPage'
import { ProfilePage } from './pages/ProfilePage'
import { WalletConnectManager } from './pages/WalletConnectPage'

export function App() {
  const [page, setPage]           = useState<AppPage>('loading')
  const [addresses, setAddresses] = useState<WalletAddresses | null>(null)
  const [activeTab, setActiveTab] = useState<MainTab>('portfolio')
  const [browserOpen, setBrowserOpen] = useState(false)
  const [wcPanelOpen, setWcPanelOpen] = useState(false)
  const [wcActiveSessions, setWcActiveSessions] = useState(0)
  const [wcPending, setWcPending] = useState(false)

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

  // Track when the popup browser window is closed
  useEffect(() => {
    const onClosed = () => setBrowserOpen(false)
    window.wallet.onBrowserClosed(onClosed)
    return () => window.wallet.offBrowserClosed(onClosed)
  }, [])

  const handleWalletReady = (addrs: WalletAddresses) => {
    setAddresses(addrs)
    setPage('dashboard')
  }

  const handleBrowserBtn = () => {
    window.wallet.openBrowser()
    setBrowserOpen(true)
  }

  const inDashboard = page === 'dashboard'

  return (
    <div className="app-shell">
      {/* Custom titlebar — logo only, no text, no divider */}
      <div className="titlebar">
        <img src={logoUrl} alt="MagicMoney" className="titlebar-logo" draggable={false} />
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
          onWcOpen={() => setWcPanelOpen(true)}
          wcActiveSessions={wcActiveSessions}
          wcPending={wcPending}
        />
      )}
      {inDashboard && addresses && activeTab === 'market' && <MarketPage />}
      {inDashboard && activeTab === 'apphub' && <AppHubPage />}
      {inDashboard && activeTab === 'profile' && <ProfilePage />}

      {/* WalletConnect manager — proposal/request modals + session panel */}
      {inDashboard && (
        <WalletConnectManager
          panelOpen={wcPanelOpen}
          onPanelClose={() => setWcPanelOpen(false)}
          onSessionsChange={count => setWcActiveSessions(count)}
          onPendingChange={pending => setWcPending(pending)}
        />
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
            className={`bottom-nav-btn${activeTab === 'apphub' ? ' active' : ''}`}
            onClick={() => setActiveTab('apphub')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            Apps
          </button>

          <button
            type="button"
            className={`bottom-nav-btn${activeTab === 'profile' ? ' active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
            Profile
          </button>

          {/* Browser / ChainLens — opens a detached popup in Electron; new tab in extension */}
          <button
            type="button"
            className={`bottom-nav-btn${browserOpen ? ' active' : ''}`}
            onClick={handleBrowserBtn}
            style={{ position: 'relative' }}
          >
            {browserOpen && (
              <span style={{
                position: 'absolute', top: 6, right: 14,
                width: 6, height: 6, borderRadius: '50%',
                background: '#22c55e', boxShadow: '0 0 4px #22c55e'
              }} />
            )}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(globalThis as any).chrome?.tabs ? (
              // Extension: chain-link icon + ChainLens label
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            ) : (
              // Electron: globe icon
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            )}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(globalThis as any).chrome?.tabs ? 'ChainLens' : 'Browser'}
          </button>
        </nav>
      )}
    </div>
  )
}
