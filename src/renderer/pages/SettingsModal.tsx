import { useState, useEffect } from 'react'
import type { ApprovedOrigin, DappChain, DefaultBrowserState, UpdateStatus } from '../types/wallet'
import { THEMES, getTheme, setTheme, type ThemeId } from '../theme'

interface Props {
  onClose: () => void
  onDeleteWallet: () => void
}

export function SettingsModal({ onClose, onDeleteWallet }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [siteCount, setSiteCount] = useState<number | null>(null)
  const [hello, setHello] = useState<{ supported: boolean; enrolled: boolean; method?: 'windows-hello' | 'touch-id' | 'android-biometric' | null } | null>(null)
  const [helloBusy, setHelloBusy] = useState(false)
  const [helloError, setHelloError] = useState<string | null>(null)
  const [theme, setThemeState] = useState<ThemeId>(getTheme)
  const [testnet, setTestnet] = useState<boolean | null>(null)
  const [testnetBusy, setTestnetBusy] = useState(false)
  const [testnetError, setTestnetError] = useState<string | null>(null)
  const [privacy, setPrivacy] = useState<boolean | null>(null)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [defaultBrowser, setDefaultBrowser] = useState<DefaultBrowserState | null>(null)
  const [defaultBrowserBusy, setDefaultBrowserBusy] = useState(false)

  // Software update is Electron-only — the extension bridge omits these methods
  // (extensions self-update via the Chrome store), so the whole section hides.
  // Same feature-detect idiom as WindowLayout's layoutSupported().
  const updateSupported = typeof window.wallet.updateCheck === 'function'
  useEffect(() => {
    if (!updateSupported) return
    window.wallet.getAppVersion?.().then(setAppVersion).catch(() => {})
    window.wallet.updateGetState?.().then(setUpdate).catch(() => {})
    const onStatus = (s: UpdateStatus) => setUpdate(s)
    window.wallet.onUpdateStatus?.(onStatus)
    return () => window.wallet.offUpdateStatus?.(onStatus)
  }, [updateSupported])

  // Default browser — Electron on Windows and Android expose this; the extension
  // bridge omits it (a Chrome extension can't be the system browser), and the
  // main process reports supported:false on macOS/Linux and in dev, so the row
  // only appears where the action can actually do something.
  const defaultBrowserSupported = typeof window.wallet.defaultBrowserGetState === 'function'
  const refreshDefaultBrowser = () => {
    window.wallet.defaultBrowserGetState?.().then(setDefaultBrowser).catch(() => setDefaultBrowser(null))
  }
  useEffect(() => {
    if (!defaultBrowserSupported) return
    refreshDefaultBrowser()
    // Picking the default happens OUTSIDE the app (Windows Settings / the Android
    // role dialog), so re-read the state whenever the wallet regains focus.
    window.addEventListener('focus', refreshDefaultBrowser)
    return () => window.removeEventListener('focus', refreshDefaultBrowser)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBrowserSupported])

  const onDefaultBrowserClick = async () => {
    if (defaultBrowserBusy || defaultBrowser?.isDefault) return
    setDefaultBrowserBusy(true)
    try {
      setDefaultBrowser(await window.wallet.defaultBrowserRequest?.() ?? null)
    } catch {
      refreshDefaultBrowser()
    } finally {
      setDefaultBrowserBusy(false)
    }
  }

  // One adaptive button: a real terminal state (downloaded / mac-available)
  // applies the update; anything idle re-checks; busy states are non-interactive.
  const updateBusy = update.state === 'checking' || update.state === 'downloading' || update.state === 'available'
  const onUpdateClick = () => {
    if (update.state === 'downloaded' || update.state === 'mac-available') { window.wallet.updateInstall?.(); return }
    if (updateBusy) return
    window.wallet.updateCheck?.().then(setUpdate).catch(() => {})
  }
  const updateLabel = update.state === 'checking' ? 'Checking for updates…'
    : update.state === 'available' ? 'Update available — preparing…'
    : update.state === 'downloading' ? `Downloading update… ${update.percent ?? 0}%`
    : update.state === 'downloaded' ? 'Restart to Update'
    : update.state === 'mac-available' ? `Download update${update.version ? ` v${update.version}` : ''}`
    : 'Check for Updates'
  const updateSub = update.state === 'downloaded' ? 'A new version is ready — relaunch to apply.'
    : update.state === 'mac-available' ? 'Opens the download page (macOS installs manually).'
    : update.state === 'not-available' ? (update.error ?? `You're on the latest version${appVersion ? ` (v${appVersion})` : ''}.`)
    : appVersion ? `Current version v${appVersion}` : 'Keep the wallet up to date.'

  const refreshSiteCount = () => {
    window.wallet.getConnectedSites().then(s => setSiteCount(s.length)).catch(() => setSiteCount(null))
  }
  useEffect(refreshSiteCount, [])

  const refreshHello = () => { window.wallet.helloStatus?.().then(setHello).catch(() => setHello(null)) }
  const bioMethodName = (m?: 'windows-hello' | 'touch-id' | 'android-biometric' | null) =>
    m === 'touch-id' ? 'Touch ID' : m === 'android-biometric' ? 'Biometric' : 'Windows Hello'
  useEffect(refreshHello, [])

  useEffect(() => { window.wallet.getTestnetMode().then(setTestnet).catch(() => setTestnet(null)) }, [])
  useEffect(() => { window.wallet.getPrivacyMode?.().then(setPrivacy).catch(() => setPrivacy(null)) }, [])

  // Flipping the mode changes chains, addresses (BTC/ADA), balances, the swap
  // availability and the dApp network list at once — a full renderer reload is the
  // cleanest way to restart every mounted page on the new network set.
  const toggleTestnet = async () => {
    if (testnet === null || testnetBusy) return
    setTestnetBusy(true); setTestnetError(null)
    try {
      await window.wallet.setTestnetMode(!testnet)
      window.location.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTestnetError(msg.replace(/^Error:\s*/, ''))
      setTestnetBusy(false)
    }
  }

  // Privacy Mode — same reload doctrine as Testnet Mode. The two are mutually
  // exclusive: main clears the other flag, so no client-side coordination needed.
  const togglePrivacy = async () => {
    if (privacy === null || privacyBusy) return
    setPrivacyBusy(true); setPrivacyError(null)
    try {
      await window.wallet.setPrivacyMode(!privacy)
      window.location.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPrivacyError(msg.replace(/^Error:\s*/, ''))
      setPrivacyBusy(false)
    }
  }

  // Enrolling needs the wallet unlocked (it wraps a copy of the seed under a
  // biometric key) — Settings is only reachable while unlocked, so that holds here.
  // Toggling off removes the biometric copy + its platform key (TPM key on
  // Windows, keychain item on macOS); the password copy is never touched.
  const toggleHello = async () => {
    if (!hello || helloBusy) return
    setHelloBusy(true); setHelloError(null)
    try {
      if (hello.enrolled) await window.wallet.helloRemove?.()
      else await window.wallet.helloEnroll?.()   // triggers the Hello prompt
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/cancel/i.test(msg)) setHelloError(msg.replace(/^Error:\s*/, ''))
    } finally {
      setHelloBusy(false)
      refreshHello()
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await window.wallet.deleteWallet()
      onDeleteWallet()
    } finally {
      setDeleting(false)
    }
  }

  const copyAddresses = async () => {
    const addrs = await window.wallet.getAddresses().catch(() => null)
    if (!addrs) return
    const text = [
      `EVM:      ${addrs.evm}`,
      `Solana:   ${addrs.solana}`,
      `Cardano:  ${addrs.cardano}`,
      `Bitcoin (Native SegWit): ${addrs.bitcoin}`,
      `Bitcoin (Nested SegWit): ${addrs.bitcoinNested}`,
      `Bitcoin (Taproot):       ${addrs.bitcoinTaproot}`,
      `Polkadot: ${addrs.polkadot}`,
      `Tron:     ${addrs.tron ?? ''}`,
      `Dogecoin: ${addrs.dogecoin ?? ''}`
    ].join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()}>
        <div className="settings-grip" />

        <div className="settings-header">
          <div className="settings-title">Settings</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <SettingsSection label="Wallet">
          <SettingsRow
            icon="📋"
            label={copied ? 'Copied!' : 'Copy All Addresses'}
            sublabel="EVM, Solana, Cardano, Bitcoin, Polkadot, Tron, Dogecoin"
            onClick={copyAddresses}
          />
          <SettingsRow
            icon="🔑"
            label="Reveal Secret Phrase"
            sublabel="Requires your password — only in a private location"
            onClick={() => setRevealOpen(true)}
          />
          {testnet !== null && (
            <SettingsRow
              icon="🧪"
              label={testnetBusy ? 'Switching networks…' : `Testnet Mode — ${testnet ? 'On' : 'Off'}`}
              sublabel={testnet
                ? 'Sepolia · Devnet · Cardano/Midnight Preprod · BTC Testnet3/4 · Shasta. Tap for mainnet.'
                : 'Flip every chain to its testnet. No real funds involved.'}
              onClick={toggleTestnet}
              disabled={testnetBusy}
              noChevron
            />
          )}
          {testnetError && (
            <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{testnetError}</div>
          )}
          {privacy !== null && (
            <SettingsRow
              icon="🕶️"
              label={privacyBusy ? 'Switching networks…' : `Privacy Mode — ${privacy ? 'On' : 'Off'}`}
              sublabel={privacy
                ? 'Monero · Zcash · Midnight. Tap to return to the full portfolio.'
                : 'Show only privacy-focused networks (XMR, ZEC, NIGHT).'}
              onClick={togglePrivacy}
              disabled={privacyBusy}
              noChevron
            />
          )}
          {privacyError && (
            <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{privacyError}</div>
          )}
        </SettingsSection>

        <SettingsSection label="Appearance">
          <div className="theme-picker">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-swatch${theme === t.id ? ' active' : ''}`}
                onClick={() => { setTheme(t.id); setThemeState(t.id) }}
                title={t.name}
              >
                <span
                  className="theme-swatch-dot"
                  style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }}
                />
                <span className="theme-swatch-name">{t.name}</span>
              </button>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection label="Security">
          <SettingsRow
            icon="🔌"
            label="Connected Sites"
            sublabel={
              siteCount === null
                ? 'Manage dApps that can see your address'
                : siteCount === 0
                  ? 'No sites connected'
                  : `${siteCount} site${siteCount === 1 ? '' : 's'} connected`
            }
            onClick={() => setSitesOpen(true)}
          />
          {hello?.supported && (
            <SettingsRow
              icon="👋"
              label={helloBusy
                ? 'Please wait…'
                : hello.enrolled
                  ? `${bioMethodName(hello.method)} unlock — On`
                  : `Enable ${bioMethodName(hello.method)} unlock`}
              sublabel={hello.enrolled
                ? (hello.method === 'touch-id'
                  ? 'Unlock with your fingerprint. Tap to turn off.'
                  : 'Unlock with face / fingerprint / PIN. Tap to turn off.')
                : 'Skip typing your password. Password stays as backup.'}
              onClick={toggleHello}
              disabled={helloBusy}
              noChevron
            />
          )}
          {helloError && (
            <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{helloError}</div>
          )}
        </SettingsSection>

        {defaultBrowser?.supported && (
          <SettingsSection label="Browser">
            <SettingsRow
              icon="🌐"
              label={defaultBrowserBusy
                ? 'Opening system settings…'
                : defaultBrowser.isDefault
                  ? 'Default browser — MagicMoney'
                  : 'Make MagicMoney my default browser'}
              sublabel={defaultBrowser.isDefault
                ? 'Links from other apps open in the MagicMoney browser.'
                : 'Opens system settings — only you can confirm it.'}
              onClick={onDefaultBrowserClick}
              disabled={defaultBrowserBusy || defaultBrowser.isDefault}
              noChevron
            />
          </SettingsSection>
        )}

        {updateSupported && (
          <SettingsSection label="Software Update">
            <SettingsRow
              icon={update.state === 'downloaded' ? '🔄' : '⬇️'}
              label={updateLabel}
              sublabel={updateSub}
              onClick={onUpdateClick}
              disabled={updateBusy}
              noChevron
            />
            {update.state === 'error' && update.error && (
              <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{update.error}</div>
            )}
          </SettingsSection>
        )}

        <SettingsSection label="About">
          <SettingsRow icon="⚡" label="MagicMoney Wallet" sublabel={appVersion ? `Version ${appVersion}` : 'Phase 10 — WalletConnect'} noChevron />
          <SettingsRow icon="🔗" label="Powered by ChainLens" sublabel="chainlensnft.info" noChevron />
        </SettingsSection>

        <SettingsSection label="Danger Zone" danger>
          <SettingsRow
            danger
            icon="🗑"
            label={confirmDelete ? 'Tap again to confirm — cannot be undone' : 'Delete Wallet'}
            sublabel="Removes keys from this device permanently"
            onClick={handleDelete}
            disabled={deleting}
            noChevron
          />
        </SettingsSection>
      </div>

      {revealOpen && <RevealSeedModal onClose={() => setRevealOpen(false)} />}
      {sitesOpen && <ConnectedSitesModal onClose={() => { setSitesOpen(false); refreshSiteCount() }} />}
    </div>
  )
}

// ── Connected sites (revoke dApp access) ───────────────────────────────────────
// Lists every dApp origin that's been granted read access to the wallet address
// and lets the user disconnect any of them — the same pruning MetaMask/Phantom
// offer. Revoking removes the origin from the shared allowlist (all chains) and
// tells the live page it's disconnected, so a stale/forgotten connection can be
// cleared without deleting the wallet.

/** Chain grant → the label shown on its chip. Short: these sit 5-across. */
const CHAIN_LABELS: Record<string, string> = {
  evm: 'EVM', cardano: 'Cardano', bitcoin: 'Bitcoin',
  solana: 'Solana', polkadot: 'Polkadot', midnight: 'Midnight',
}

const hostOf = (origin: string) => { try { return new URL(origin).hostname } catch { return origin } }

/**
 * One connected site: favicon, hostname, the chains it may use.
 *
 * Favicons come from Google's s2 service, the same source and URL shape
 * app-hub.ts uses — it normalises size and handles sites whose own favicon.ico
 * is missing, oddly sized, or only declared via <link rel="icon">.
 *
 * The letter-tile fallback (BrowserApp's SuggestRow pattern) is for OFFLINE or
 * blocked requests only: s2 answers an unknown domain with a generic globe
 * rather than a 404, so onError does not fire for sites it doesn't recognise.
 * Allowed by the packaged CSP via `img-src https:` (WALLET_CSP, main/index.ts).
 */
function ConnectedSiteRow({ site, busy, onRevoke }: {
  site: ApprovedOrigin
  busy: string | null
  onRevoke: (origin: string, chain?: DappChain) => void
}) {
  const [iconErr, setIconErr] = useState(false)
  const host = hostOf(site.origin)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {iconErr ? (
          <div style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-raised)', border: '1px solid var(--border)',
            fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
          }}>
            {host.replace(/^www\./, '').charAt(0).toUpperCase()}
          </div>
        ) : (
          <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
            alt=""
            width={26}
            height={26}
            style={{ borderRadius: 7, flexShrink: 0, objectFit: 'contain' }}
            onError={() => setIconErr(true)}
            loading="lazy"
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={host} style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{host.replace(/^www\./, '')}</div>
          <div title={site.origin} style={{
            fontSize: 10, color: 'var(--text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{site.origin}</div>
        </div>

        {/* Styled inline, NOT `.btn` — that class sets width:100%, which made
            this button swallow the row and collapse the hostname to nothing. */}
        <button
          type="button"
          onClick={() => onRevoke(site.origin)}
          disabled={busy !== null}
          style={{
            flexShrink: 0, width: 'auto', padding: '6px 11px', borderRadius: 8,
            fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            background: 'transparent', color: 'var(--error)',
            border: '1px solid var(--border)', opacity: busy ? 0.5 : 1,
          }}
        >
          {busy === site.origin ? '…' : 'Disconnect'}
        </button>
      </div>

      {/* Which chains this site can use. Tap a chip to revoke just that one. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {site.chains.map(chain => (
          <button
            key={chain}
            type="button"
            title={`Revoke ${CHAIN_LABELS[chain] ?? chain} access`}
            onClick={() => onRevoke(site.origin, chain)}
            disabled={busy !== null}
            style={{
              width: 'auto', fontSize: 10, padding: '3px 8px', borderRadius: 999,
              border: '1px solid var(--border)', background: 'var(--surface-raised)',
              color: 'var(--text-secondary)', cursor: busy ? 'default' : 'pointer',
              whiteSpace: 'nowrap', opacity: busy ? 0.5 : 1,
            }}
          >
            {busy === `${site.origin}:${chain}` ? '…' : `${CHAIN_LABELS[chain] ?? chain} ×`}
          </button>
        ))}
      </div>
    </div>
  )
}

function ConnectedSitesModal({ onClose }: { onClose: () => void }) {
  const [sites, setSites] = useState<ApprovedOrigin[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // origin being revoked, or '*' for all
  const [confirmAll, setConfirmAll] = useState(false)

  const load = () => { window.wallet.getConnectedSites().then(setSites).catch(() => setSites([])) }
  useEffect(load, [])

  /** Revoke one chain, or the whole site when `chain` is omitted. */
  const revoke = async (origin: string, chain?: DappChain) => {
    setBusy(chain ? `${origin}:${chain}` : origin)
    try { setSites(await window.wallet.revokeSite(origin, chain)) }
    catch { load() }
    finally { setBusy(null) }
  }

  const revokeAll = async () => {
    if (!confirmAll) { setConfirmAll(true); return }
    setBusy('*')
    try { setSites(await window.wallet.revokeAllSites()) }
    catch { load() }
    finally { setBusy(null); setConfirmAll(false) }
  }

  return (
    <div className="settings-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()}>
        <div className="settings-grip" />
        <div className="settings-header">
          <div className="settings-title">Connected Sites</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            These sites can see your wallet address. They can never move funds without your approval on each transaction. Disconnect any you don't recognize.
          </div>

          {sites === null ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Loading…</div>
          ) : sites.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              No sites are connected.<br />Connecting to a dApp will add it here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sites.map(site => (
                <ConnectedSiteRow key={site.origin} site={site} busy={busy} onRevoke={revoke} />
              ))}
            </div>
          )}

          {sites && sites.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--error)' }}
              onClick={revokeAll}
              disabled={busy !== null}
            >
              {busy === '*' ? 'Disconnecting…' : confirmAll ? 'Tap again to disconnect all' : 'Disconnect All'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Password-gated seed reveal ─────────────────────────────────────────────────
// Re-verifies the password in the main process before the phrase is returned, and
// shows the words in-app instead of auto-copying them to a shared clipboard.

function RevealSeedModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Android: block screenshots/recents preview while the modal is open.
  useEffect(() => {
    window.wallet.setSecureScreen?.(true)
    return () => { window.wallet.setSecureScreen?.(false) }
  }, [])

  const reveal = async () => {
    if (!password) return
    setBusy(true); setError(null)
    try {
      setWords(await window.wallet.revealSeed(password))
      setPassword('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/incorrect/i.test(msg) ? 'Incorrect password' : msg.replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()} style={{ maxHeight: 'none' }}>
        <div className="settings-grip" />
        <div className="settings-header">
          <div className="settings-title">Reveal Secret Phrase</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!words ? (
          <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Anyone with this phrase controls your funds. Make sure no one can see your screen.
            </div>
            <input
              className="input" type="password" autoFocus placeholder="Enter your password"
              aria-label="Wallet password"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') reveal() }}
            />
            {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
            <button type="button" className="btn btn-primary" onClick={reveal} disabled={busy || !password}>
              {busy ? 'Verifying…' : 'Reveal'}
            </button>
          </div>
        ) : (
          <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 14 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{w}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => { await navigator.clipboard.writeText(words.join(' ')).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsSection({ label, danger, children }: { label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-label">{label}</div>
      <div className={`settings-group${danger ? ' danger' : ''}`}>
        {children}
      </div>
    </div>
  )
}

function SettingsRow({ icon, label, sublabel, onClick, danger, disabled, noChevron }: {
  icon: string
  label: string
  sublabel: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  noChevron?: boolean
}) {
  return (
    <button
      type="button"
      className={`settings-row${danger ? ' danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="settings-icon">{icon}</span>
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-sub">{sublabel}</div>
      </div>
      {!noChevron && (
        <svg className="settings-chevron" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      )}
    </button>
  )
}
