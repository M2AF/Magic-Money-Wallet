import { useState, useEffect } from 'react'
// Copy lives in one tested module so the Settings row and the first-run prompt
// cannot drift apart — and so the two measured Chrome/own-browser facts stay
// assertable rather than buried in JSX.
import { onboardingStage, settingsRowCopy, settingsLandingNote, onboardingCopy } from '../lib/passkey-onboarding'
import type { ApprovedOrigin, BiometricMethod, DappChain, DefaultBrowserState, UpdateStatus } from '../types/wallet'
import { bioMethodLabel } from '../types/wallet'
import {
  THEMES,
  MAX_CUSTOM_THEMES,
  customSwatch,
  getCustomThemes,
  getTheme,
  getThemeSyncStatus,
  onCustomThemesChange,
  retryThemeSync,
  setTheme,
  syncCustomThemes,
  type CustomTheme,
  type ThemeId,
  type ThemeSyncStatus
} from '../theme'
import { ThemeEditorModal } from '../components/ThemeEditorModal'
import { copySeedPhrase, SEED_CLIPBOARD_TTL_MS } from '../lib/copy-seed'

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
  const [hello, setHello] = useState<{ supported: boolean; enrolled: boolean; method?: BiometricMethod | null } | null>(null)
  const [helloBusy, setHelloBusy] = useState(false)
  // Android 14+ system passkey provider (Capacitor only — capability-probed).
  const [pkProvider, setPkProvider] = useState<{ supported: boolean; androidVersion: number; enrolled: boolean; enabledInSettings: boolean | null } | null>(null)
  const [pkProviderBusy, setPkProviderBusy] = useState(false)
  const [pkProviderError, setPkProviderError] = useState<string | null>(null)
  const [pkLanding, setPkLanding] = useState<string | null>(null)
  const [helloError, setHelloError] = useState<string | null>(null)
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [passkeyLinked, setPasskeyLinked] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [theme, setThemeState] = useState<ThemeId>(getTheme)
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(getCustomThemes)
  const [themeSync, setThemeSync] = useState<ThemeSyncStatus>(getThemeSyncStatus)
  // `editing: null` with the editor open = creating a new theme.
  const [themeEditor, setThemeEditor] = useState<{ editing: CustomTheme | null } | null>(null)
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

  // Custom themes live on the ChainLens profile, so opening the picker is when
  // this device catches up with themes made elsewhere. Deliberately here rather
  // than at app start: Appearance is the only place they are visible, so there
  // is no reason to spend a request before someone looks.
  useEffect(() => {
    const refresh = () => {
      setCustomThemes(getCustomThemes())
      setThemeSync(getThemeSyncStatus())
    }
    const off = onCustomThemesChange(refresh)
    void syncCustomThemes().then(setThemeSync)
    return off
  }, [])

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
  // actionLabel/actionHint let a platform correct this copy — Android's
  // sideload updater installs an APK rather than relaunching, so "Restart to
  // Update" would be wrong there. Absent everywhere else, hence the fallbacks.
  const updateLabel = update.actionLabel
    ?? (update.state === 'checking' ? 'Checking for updates…'
    : update.state === 'available' ? 'Update available — preparing…'
    : update.state === 'downloading' ? `Downloading update… ${update.percent ?? 0}%`
    : update.state === 'downloaded' ? 'Restart to Update'
    : update.state === 'mac-available' ? `Download update${update.version ? ` v${update.version}` : ''}`
    : 'Check for Updates')
  const updateSub = update.actionHint
    ?? (update.state === 'downloaded' ? 'A new version is ready — relaunch to apply.'
    : update.state === 'mac-available' ? 'Opens the download page (macOS installs manually).'
    : update.state === 'not-available' ? (update.error ?? `You're on the latest version${appVersion ? ` (v${appVersion})` : ''}.`)
    : appVersion ? `Current version v${appVersion}` : 'Keep the wallet up to date.')

  const refreshSiteCount = () => {
    window.wallet.getConnectedSites().then(s => setSiteCount(s.length)).catch(() => setSiteCount(null))
  }
  useEffect(refreshSiteCount, [])

  const refreshHello = () => { window.wallet.helloStatus?.().then(setHello).catch(() => setHello(null)) }

  // Only Android 14+ can host a credential provider, so an absent method or
  // supported:false hides the row entirely — never a control that cannot work.
  const refreshPasskeyProvider = () => {
    const probe = window.wallet.passkeyProviderStatus
    if (typeof probe !== 'function') { setPkProvider(null); return }
    Promise.resolve(probe.call(window.wallet))
      .then(s => setPkProvider(s.supported ? s : null))
      .catch(() => setPkProvider(null))
  }
  useEffect(refreshPasskeyProvider, [])

  // Re-check when the user returns: enabling us happens in Settings, outside
  // the app, so the state we last read is stale by definition.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshPasskeyProvider() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const togglePasskeyProvider = async () => {
    if (pkProviderBusy || !pkProvider) return
    setPkProviderBusy(true)
    setPkProviderError(null)
    try {
      if (pkProvider.enrolled) {
        await window.wallet.passkeyProviderDisable?.()
        setPkLanding(null)
      } else {
        await window.wallet.passkeyProviderEnable?.()
        // Enabling only hands over the key material; Android will not let an app
        // select itself, so the user still has to pick us in Settings. The deep
        // link can fail entirely on an unseen OEM build, so report where it
        // actually landed rather than assuming the screen opened.
        const landed = await window.wallet.passkeyProviderOpenSettings?.()
        setPkLanding(settingsLandingNote(landed?.via ?? 'none', landed?.opened ?? false))
      }
      refreshPasskeyProvider()
    } catch (e) {
      setPkProviderError(e instanceof Error ? e.message : String(e))
    }
    setPkProviderBusy(false)
  }

  // Capability + current state. `fn?.()` alone would not guard an absent method:
  // optional chaining stops at the call, so `.then` on undefined would throw.
  useEffect(() => {
    const probe = window.wallet.passkeySupported
    const linked = window.wallet.passkeyLinked
    if (typeof probe !== 'function' || typeof linked !== 'function' || !window.wallet.passkeyLink) return
    let cancelled = false
    Promise.resolve(probe.call(window.wallet))
      .then(ok => { if (!cancelled) setPasskeySupported(!!ok) })
      .catch(() => { /* row stays hidden */ })
    Promise.resolve(linked.call(window.wallet))
      .then(on => { if (!cancelled) setPasskeyLinked(!!on) })
      .catch(() => { /* treat as unlinked */ })
    return () => { cancelled = true }
  }, [])

  const togglePasskeyLink = async () => {
    if (passkeyBusy) return
    setPasskeyBusy(true)
    setPasskeyError(null)
    try {
      if (passkeyLinked) {
        await window.wallet.passkeyUnlink?.()
        setPasskeyLinked(false)
      } else {
        await window.wallet.passkeyLink?.()   // prompts, then self-tests
        setPasskeyLinked(true)
      }
    } catch (e) {
      // Electron prefixes IPC rejections with
      // "Error invoking remote method 'x': Error: " — noise to a user.
      setPasskeyError(
        String((e as Error)?.message ?? e)
          .replace(/^Error invoking remote method '[^']*':\s*/, '')
          .replace(/^Error:\s*/, '')
      )
      // The handler removes the blob when its own round-trip check fails, so the
      // row must not be left claiming recovery is on.
      window.wallet.passkeyLinked?.().then(on => setPasskeyLinked(!!on)).catch(() => setPasskeyLinked(false))
    } finally {
      setPasskeyBusy(false)
    }
  }
  // Uses the SHARED bioMethodLabel (types/wallet.ts) rather than a local map.
  // The local version defaulted every unrecognised method to 'Windows Hello',
  // so iOS — which reports 'face-id' — rendered "Enable Windows Hello unlock"
  // on an iPhone, while the password-vault row below it (already on the shared
  // helper) correctly said "Face ID" two sections away.
  const bioMethodName = (m?: string | null) => bioMethodLabel(m)
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
              <ThemeSwatch
                key={t.id}
                name={t.name}
                swatch={t.swatch}
                active={theme === t.id}
                onSelect={() => { setTheme(t.id); setThemeState(t.id) }}
              />
            ))}
            {customThemes.map(t => (
              <ThemeSwatch
                key={t.id}
                name={t.name}
                swatch={customSwatch(t)}
                active={theme === t.id}
                onSelect={() => { setTheme(t.id); setThemeState(t.id) }}
                onEdit={() => setThemeEditor({ editing: t })}
              />
            ))}
            {customThemes.length < MAX_CUSTOM_THEMES && (
              <button
                type="button"
                className="theme-swatch theme-swatch-new"
                onClick={() => setThemeEditor({ editing: null })}
                title="Create your own theme"
              >
                <span className="theme-swatch-dot theme-swatch-plus" aria-hidden>+</span>
                <span className="theme-swatch-name">New</span>
              </button>
            )}
          </div>
          <p className="theme-picker-note">
            {customThemes.length === 0
              ? 'Tap + to build your own: pick a background, an accent and a text colour, and the rest of the app is derived to match.'
              : customThemes.length >= MAX_CUSTOM_THEMES
                ? `Tap the pencil to change a theme you made. All ${MAX_CUSTOM_THEMES} custom slots are used — delete one to make another.`
                : `Tap the pencil to change a theme you made. ${MAX_CUSTOM_THEMES - customThemes.length} of ${MAX_CUSTOM_THEMES} custom slots left.`}
          </p>
          <ThemeSyncNote
            status={themeSync}
            local={customThemes.length}
            onRetry={() => { setThemeSync({ ...themeSync, state: 'syncing' }); void retryThemeSync().then(setThemeSync) }}
          />
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

          {/* System passkeys (Android 14+). Distinct from both rows around it:
              biometric unlock decrypts a local copy, passkey RECOVERY is a way
              back into the wallet, and this offers the wallet's seed-derived
              site passkeys to Chrome, Brave and Samsung Internet — the thing
              other password managers refuse an in-app browser. */}
          {pkProvider && (() => {
            const row = settingsRowCopy(onboardingStage(pkProvider))
            if (!row) return null
            return (
              <SettingsRow
                icon="🪪"
                label={pkProviderBusy ? 'Please wait…' : row.label}
                sublabel={row.sublabel}
                onClick={togglePasskeyProvider}
                disabled={pkProviderBusy}
                noChevron
              />
            )
          })()}
          {/* The two facts device testing turned up, stated where the user is
              deciding — and HERE rather than in the row's sublabel, which is
              clamped to one line and ellipsised the Chrome instruction. Chrome
              puts Google first no matter what (Preferred Service was measured to
              change nothing), and the wallet's own browser skips the chooser. */}
          {pkProvider?.enrolled && (
            <div style={{ color: 'var(--muted)', fontSize: 11, padding: '2px 12px 6px', lineHeight: 1.5 }}>
              {onboardingCopy(onboardingStage(pkProvider))?.browserNote}{' '}
              {onboardingCopy(onboardingStage(pkProvider))?.ownBrowserNote}{' '}
              <button
                type="button"
                onClick={() => {
                  window.wallet.passkeyProviderOpenSettings?.()
                    .then(r => setPkLanding(settingsLandingNote(r?.via ?? 'none', r?.opened ?? false)))
                    .catch(() => setPkLanding(settingsLandingNote('none', false)))
                }}
                style={{ background: 'none', border: 0, color: 'var(--accent)', padding: 0, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
              >Open Settings</button>
            </div>
          )}
          {pkLanding && (
            <div style={{ color: 'var(--muted)', fontSize: 11, padding: '0 12px 6px', lineHeight: 1.5 }}>{pkLanding}</div>
          )}
          {pkProviderError && (
            <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px' }}>{pkProviderError}</div>
          )}

          {/* Passkey recovery — a way BACK IN, not a way to unlock. Distinct from
              biometric unlock above, which only decrypts a local copy on this
              machine. Hidden where WebAuthn is unavailable; linking additionally
              self-tests and refuses on platforms that can't read the key back. */}
          {passkeySupported && (
            <SettingsRow
              icon="🔑"
              label={passkeyBusy
                ? 'Please wait…'
                : passkeyLinked
                  ? 'Passkey recovery — On'
                  : 'Link a passkey'}
              sublabel={passkeyLinked
                ? 'This wallet can be restored with your passkey. Tap to unlink.'
                : 'Restore this wallet with a passkey instead of typing your seed phrase.'}
              onClick={togglePasskeyLink}
              disabled={passkeyBusy}
              noChevron
            />
          )}
          {passkeyError && (
            <div style={{ color: 'var(--error)', fontSize: 11, padding: '2px 12px 4px', lineHeight: 1.5 }}>{passkeyError}</div>
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
      {themeEditor && (
        <ThemeEditorModal
          editing={themeEditor.editing}
          onClose={() => setThemeEditor(null)}
          onSaved={() => setThemeState(getTheme())}
        />
      )}
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
              onClick={async () => {
                if (await copySeedPhrase(words)) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), SEED_CLIPBOARD_TTL_MS)
                }
              }}
            >
              {copied ? 'Copied — clears in 90s' : 'Copy to clipboard'}
            </button>
            {copied && (
              <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                Paste it somewhere safe now — a password manager, not a chat or notes app.
                Other programs can read your clipboard, so it’s cleared automatically.
              </p>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Whether the custom themes are actually reaching the ChainLens profile.
 *
 * This exists because the failure mode it reports is otherwise INVISIBLE: a
 * missing bridge, an unreachable Worker and an un-migrated database all end with
 * the themes sitting quietly on one device and no way to tell which. Saying
 * which one it is turns a debugging session into a glance.
 */
function ThemeSyncNote({ status, local, onRetry }: {
  status: ThemeSyncStatus
  local: number
  onRetry: () => void
}) {
  if (local === 0 && status.state === 'idle') return null

  const line =
    status.state === 'syncing' ? 'Checking your ChainLens profile…'
    : status.state === 'unavailable' ? 'Theme sync isn’t available in this build — restart the app if you just updated.'
    : status.state === 'error' ? `Not synced — ${status.error ?? 'could not reach your profile'}`
    : status.state === 'synced'
      ? status.remote === 0 && local > 0
        ? 'Your profile has no themes yet — sending them now.'
        : `Synced with your ChainLens profile${status.remote !== null ? ` · ${status.remote} there` : ''}`
      : ''
  if (!line) return null

  const bad = status.state === 'error' || status.state === 'unavailable'
  return (
    <p className={`theme-sync-note${bad ? ' bad' : ''}`}>
      {line}
      {bad && (
        <button type="button" className="theme-sync-retry" onClick={onRetry}>Retry</button>
      )}
    </p>
  )
}

/**
 * One tile in the Appearance picker. Built-in themes are select-only; a custom
 * one also carries a pencil badge, so editing is visible on the tile instead of
 * hidden behind a long-press or a second selection.
 */
function ThemeSwatch({ name, swatch, active, onSelect, onEdit }: {
  name: string
  swatch: [string, string]
  active: boolean
  onSelect: () => void
  onEdit?: () => void
}) {
  return (
    <button
      type="button"
      className={`theme-swatch${active ? ' active' : ''}`}
      onClick={onSelect}
      title={name}
    >
      <span
        className="theme-swatch-dot"
        style={{ background: `linear-gradient(135deg, ${swatch[0]} 50%, ${swatch[1]} 50%)` }}
      />
      <span className="theme-swatch-name">{name}</span>
      {onEdit && (
        // Nested interactive element: a <span role="button"> rather than a
        // <button>, which is invalid inside a button and gets dropped by React.
        <span
          role="button"
          tabIndex={0}
          className="theme-swatch-edit"
          aria-label={`Edit ${name}`}
          title={`Edit ${name}`}
          onClick={e => { e.stopPropagation(); onEdit() }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onEdit() }
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
      )}
    </button>
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
