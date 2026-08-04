import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses, MainTab } from './types/wallet'
import logoUrl from './assets/logo.png'
import bannerUrl from './assets/title-bar.png'
import wordmarkUrl from './assets/wordmark.png'
import { LoadingPage } from './pages/LoadingPage'
import { WelcomePage } from './pages/WelcomePage'
import { CreatePage } from './pages/CreatePage'
import { ConfirmPage } from './pages/ConfirmPage'
import { ImportPage } from './pages/ImportPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { UnlockPage } from './pages/UnlockPage'
import { DashboardPage } from './pages/DashboardPage'
import { MarketPage } from './pages/MarketPage'
import { SwapPage } from './pages/SwapPage'
import { AppHubPage } from './pages/AppHubPage'
import { ProfilePage } from './pages/ProfilePage'
import { SettingsModal } from './pages/SettingsModal'
import { WalletConnectManager } from './pages/WalletConnectPage'
import { DownloadProgressBar } from './components/DownloadProgressBar'

export function App() {
  const [page, setPage]           = useState<AppPage>('loading')
  const [addresses, setAddresses] = useState<WalletAddresses | null>(null)
  const [activeTab, setActiveTab] = useState<MainTab>('portfolio')
  const [browserOpen, setBrowserOpen] = useState(false)
  // Android persistent-tabs browser: true while the browser has open tabs even
  // when it's hidden behind the wallet — drives the "saved tabs" dot.
  const [browserHasTabs, setBrowserHasTabs] = useState(false)
  const [wcPanelOpen, setWcPanelOpen] = useState(false)
  const [wcActiveSessions, setWcActiveSessions] = useState(0)
  const [wcPending, setWcPending] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pwMode, setPwMode] = useState<'create' | 'migrate'>('create')
  // Seed length chosen on the create screen, so the backup checklist can name it.
  const [seedWordCount, setSeedWordCount] = useState<12 | 24>(12)
  // Was the pending wallet generated here or restored? Only affects the default
  // of the "sign out of websites" offer on the password step.
  const [walletOrigin, setWalletOrigin] = useState<'created' | 'imported'>('created')

  // Shared header-toolbar actions for all main tabs (Refresh is page-specific)
  const toolbarProps = {
    onWcOpen: () => setWcPanelOpen(true),
    onProfile: () => setActiveTab('profile'),
    onSettings: () => setShowSettings(true),
    wcActiveSessions,
    wcPending,
  }

  useEffect(() => {
    // Bridge guard (B-1): without the preload bridge there's nothing to route.
    if (!window.wallet) { setPage('welcome'); return }
    ;(async () => {
      try {
        if (!(await window.wallet.isSetup())) { setPage('welcome'); return }
        if (await window.wallet.isUnlocked()) {
          setAddresses(await window.wallet.getAddresses())
          setPage('dashboard')
          return
        }
        // Wallet exists but session is locked: migrate legacy wallets, else unlock.
        // Optional-chained: the browser-extension bridge (which has its own lock
        // flow in ExtApp) doesn't implement these and only mounts App when unlocked.
        if (await window.wallet.needsMigration?.()) { setPwMode('migrate'); setPage('setpassword') }
        else setPage('unlock')
      } catch {
        setPage('welcome')
      }
    })()
  }, [])

  // Track when the popup browser window is closed. Optional-chained like the
  // effects below: effects still run when the bridge is missing and the render
  // bailed to the B-1 fallback screen — an unguarded call would throw there.
  useEffect(() => {
    const onClosed = () => { setBrowserOpen(false); setBrowserHasTabs(false) }
    window.wallet?.onBrowserClosed?.(onClosed)
    // Android: hiding the browser (back to wallet, tabs kept) clears the active
    // highlight but NOT the saved-tabs dot; the tab-count drives that dot.
    const onHidden = () => setBrowserOpen(false)
    const onTabCount = (n: number) => setBrowserHasTabs(n > 0)
    window.wallet?.onBrowserHidden?.(onHidden)
    window.wallet?.onBrowserTabCount?.(onTabCount)
    return () => {
      window.wallet?.offBrowserClosed?.(onClosed)
      window.wallet?.offBrowserHidden?.(onHidden)
      window.wallet?.offBrowserTabCount?.(onTabCount)
    }
  }, [])

  // Idle auto-lock: main broadcasts 'wallet:locked' → return to the unlock screen.
  // Optional-chained so the browser-extension bridge (no onLocked) is unaffected.
  useEffect(() => {
    const onLocked = () => setPage('unlock')
    window.wallet.onLocked?.(onLocked)
    return () => window.wallet.offLocked?.(onLocked)
  }, [])

  // Inactivity-aware auto-lock: report genuine user interaction to main so its idle
  // timer only fires after real inactivity — scrolling/typing/mouse keeps the wallet
  // open. Throttled to one ping every 30s (timer is minutes), so high-frequency
  // events like mousemove/scroll cost almost nothing. Optional-chained for the
  // extension bridge (no reportActivity).
  useEffect(() => {
    if (!window.wallet.reportActivity) return
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < 30_000) return
      last = now
      window.wallet.reportActivity!()
    }
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    for (const e of events) window.addEventListener(e, ping, { capture: true, passive: true })
    return () => { for (const e of events) window.removeEventListener(e, ping, { capture: true }) }
  }, [])

  // New / imported wallet is derived; now require a password before going live.
  const handleWalletReady = (addrs: WalletAddresses) => {
    setAddresses(addrs)
    setPwMode('create')
    // Both the confirm-backup and import screens land here; `page` still holds
    // whichever one called, which is what distinguishes a fresh wallet from a
    // restored one for the sign-out default.
    setWalletOrigin(page === 'import' ? 'imported' : 'created')
    setPage('setpassword')
  }

  // Password set (create) or verified (unlock/migrate) → enter the dashboard.
  const handleUnlockedOrSet = async () => {
    let addrs = addresses
    if (!addrs) { try { addrs = await window.wallet.getAddresses() } catch { addrs = null } }
    setAddresses(addrs)
    setPage('dashboard')
  }

  const handleBrowserBtn = () => {
    // Android: reveal the persistent session (keeps existing tabs). Elsewhere
    // (Electron detached window / extension new tab), open as before.
    if (window.wallet.showBrowser) window.wallet.showBrowser()
    else window.wallet.openBrowser()
    setBrowserOpen(true)
  }

  // Switch to a wallet tab. On Android this also tucks the browser away (keeping
  // its tabs) so the wallet page shows through with the bottom nav still pinned.
  const goToWalletTab = (tab: MainTab) => {
    if (browserOpen && window.wallet.hideBrowser) window.wallet.hideBrowser()
    setBrowserOpen(false)
    setActiveTab(tab)
  }

  const inDashboard = page === 'dashboard'

  // B-1: if the preload bridge never loaded, there is no wallet to drive. Show a
  // clear message instead of a blank screen or a half-working welcome flow.
  if (typeof window.wallet === 'undefined') {
    return (
      <div className="app-shell">
        <div className="page" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <div style={{ fontSize: 38 }}>🔌</div>
          <h1 className="page-title">Wallet bridge unavailable</h1>
          <p className="page-subtitle" style={{ maxWidth: 320 }}>
            The secure wallet layer didn’t load. Please restart MagicMoney Wallet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* Thin neon-green download line pinned to the window's top edge. Mounted
          at the shell so it keeps running across tab switches and after the NFT
          sheet is closed mid-download. Self-hides when nothing is downloading. */}
      <DownloadProgressBar />

      {/* Custom titlebar — logo only, no text, no divider */}
      <div className="titlebar">
        <img src={logoUrl} alt="MagicMoney" className="titlebar-logo" draggable={false} />
        <img src={wordmarkUrl} alt="Magic Money" className="titlebar-wordmark" draggable={false} />
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn min" onClick={() => window.wallet.minimize()} title="Minimize" aria-label="Minimize window" />
          <button type="button" className="titlebar-btn close" onClick={() => window.wallet.close()} title="Close" aria-label="Close window" />
        </div>
      </div>

      {/* Brand banner — shown only on the main tabs where the titlebar is hidden
          (the extension). Hidden by default in CSS; extension overrides reveal it. */}
      {inDashboard && ['portfolio', 'market', 'swap', 'apphub'].includes(activeTab) && (
        <div className="tab-banner">
          <img src={bannerUrl} alt="Magic Money" draggable={false} />
        </div>
      )}

      {/* Page router */}
      {page === 'loading'  && <LoadingPage />}
      {page === 'welcome'  && <WelcomePage onNavigate={setPage} />}
      {page === 'create'   && <CreatePage onNavigate={setPage} onComplete={handleWalletReady} wordCount={seedWordCount} onWordCountChange={setSeedWordCount} />}
      {page === 'confirm'  && <ConfirmPage onNavigate={setPage} onComplete={handleWalletReady} wordCount={seedWordCount} />}
      {page === 'import'   && <ImportPage onNavigate={setPage} onComplete={handleWalletReady} />}
      {page === 'setpassword' && <SetPasswordPage mode={pwMode} origin={walletOrigin} onComplete={handleUnlockedOrSet} />}
      {page === 'unlock'      && <UnlockPage onUnlocked={handleUnlockedOrSet} />}
      {/* Dashboard stays mounted while in the dashboard so balances/tokens/NFTs,
          the portfolio total, scroll position and the active sub-tab survive
          switching tabs and back — no reload on return. */}
      {inDashboard && addresses && (
        <DashboardPage
          addresses={addresses}
          hidden={activeTab !== 'portfolio'}
          onNavigate={setPage}
          onWalletDeleted={() => { setAddresses(null); setPage('welcome') }}
          {...toolbarProps}
        />
      )}
      {inDashboard && addresses && activeTab === 'market' && <MarketPage {...toolbarProps} />}
      {/* Swap stays mounted while in the dashboard so in-progress swap state (and the
          SimpleSwap status poller) survive switching to other tabs and back. */}
      {inDashboard && addresses && <SwapPage addresses={addresses} hidden={activeTab !== 'swap'} {...toolbarProps} />}
      {inDashboard && activeTab === 'apphub' && (
        <AppHubPage
          {...toolbarProps}
          browserOpen={browserOpen}
          onBrowserOpened={() => setBrowserOpen(true)}
        />
      )}

      {/* Global settings sheet — opened from any tab's header toolbar */}
      {inDashboard && showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onDeleteWallet={() => { setShowSettings(false); setAddresses(null); setPage('welcome') }}
        />
      )}
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
            className={`bottom-nav-btn${activeTab === 'portfolio' && !browserOpen ? ' active' : ''}`}
            onClick={() => goToWalletTab('portfolio')}
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
            className={`bottom-nav-btn${activeTab === 'market' && !browserOpen ? ' active' : ''}`}
            onClick={() => goToWalletTab('market')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Market
          </button>

          <button
            type="button"
            className={`bottom-nav-btn${activeTab === 'swap' && !browserOpen ? ' active' : ''}`}
            onClick={() => goToWalletTab('swap')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            Swap
          </button>

          <button
            type="button"
            className={`bottom-nav-btn${activeTab === 'apphub' && !browserOpen ? ' active' : ''}`}
            onClick={() => goToWalletTab('apphub')}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            Apps
          </button>

          {/* Browser / ChainLens — opens a detached popup in Electron; new tab in extension */}
          <button
            type="button"
            className={`bottom-nav-btn${browserOpen ? ' active' : ''}`}
            onClick={handleBrowserBtn}
            style={{ position: 'relative' }}
          >
            {(browserOpen || browserHasTabs) && (
              <span style={{
                position: 'absolute', top: 6, right: 14,
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--success)', boxShadow: '0 0 4px var(--success)'
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
