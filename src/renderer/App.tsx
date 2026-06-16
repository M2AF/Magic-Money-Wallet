import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses } from './types/wallet'
import { LoadingPage } from './pages/LoadingPage'
import { WelcomePage } from './pages/WelcomePage'
import { CreatePage } from './pages/CreatePage'
import { ConfirmPage } from './pages/ConfirmPage'
import { ImportPage } from './pages/ImportPage'
import { DashboardPage } from './pages/DashboardPage'

export function App() {
  const [page, setPage] = useState<AppPage>('loading')
  const [addresses, setAddresses] = useState<WalletAddresses | null>(null)

  // Determine which page to show on startup
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

  return (
    <div className="app-shell">
      {/* Custom titlebar */}
      <div className="titlebar">
        <span className="titlebar-title">MagicMoney Wallet</span>
        <div className="titlebar-controls">
          <button className="titlebar-btn min" onClick={() => window.wallet.minimize()} title="Minimize" />
          <button className="titlebar-btn close" onClick={() => window.wallet.close()} title="Close" />
        </div>
      </div>

      {/* Page router */}
      {page === 'loading'  && <LoadingPage />}
      {page === 'welcome'  && <WelcomePage onNavigate={setPage} />}
      {page === 'create'   && <CreatePage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'confirm'  && <ConfirmPage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'import'   && <ImportPage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'dashboard' && addresses && (
        <DashboardPage addresses={addresses} onNavigate={setPage} onWalletDeleted={() => { setAddresses(null); setPage('welcome') }} />
      )}
    </div>
  )
}
