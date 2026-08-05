import { useState, useEffect } from 'react'
import type { AppPage } from '../types/wallet'
import logoMarkUrl from '../assets/logo-mark.png'

interface Props {
  onNavigate: (page: AppPage) => void
  /** Go to the create flow and start the passkey ceremony immediately. */
  onCreateWithPasskey: () => void
}

export function WelcomePage({ onNavigate, onCreateWithPasskey }: Props) {
  const [passkeyOffered, setPasskeyOffered] = useState(false)

  // Prompt-free capability check. Only reached during onboarding — once a wallet
  // exists the app routes straight to unlock — so this never runs on a normal
  // launch, which matters because on Electron the probe spins up a loopback
  // window. `fn?.()` alone would NOT guard an absent method: optional chaining
  // stops at the call and `.then` on the result would throw.
  useEffect(() => {
    const probe = window.wallet?.passkeySupported
    if (typeof probe !== 'function') return
    let cancelled = false
    Promise.resolve(probe.call(window.wallet))
      .then(ok => { if (!cancelled) setPasskeyOffered(!!ok) })
      .catch(() => { /* option stays hidden */ })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="page fade-in" style={{ justifyContent: 'center', gap: 28 }}>
      {/* Logo / wordmark */}
      <div style={{ textAlign: 'center' }}>
        {/* Circular crop, avatar style. The source is square with its own dark
            background, so object-fit:cover fills the circle edge to edge with no
            letterboxing; overflow:hidden does the actual cropping. */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          overflow: 'hidden',
          border: '1px solid var(--border-active)',
          margin: '0 auto 20px',
          boxShadow: '0 0 32px var(--accent-glow)'
        }}>
          <img
            src={logoMarkUrl}
            alt=""
            width={64}
            height={64}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <h1 className="page-title">MagicMoney Wallet</h1>
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          Self-custody across EVM · Solana · Cardano.<br />
          Your keys. Your coins.
        </p>
      </div>

      {/* Chain badges */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Ethereum', color: '#627EEA' },
          { label: 'Monad',    color: '#627EEA' },
          { label: 'Abstract', color: '#627EEA' },
          { label: 'Solana',   color: '#9945FF' },
          { label: 'Cardano',  color: '#2A7DEA' },
        ].map(c => (
          <span key={c.label} style={{
            padding: '4px 10px',
            background: `${c.color}1a`,
            border: `1px solid ${c.color}33`,
            borderRadius: 99,
            fontSize: 11,
            color: c.color,
            fontWeight: 500
          }}>{c.label}</span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className="btn btn-primary" onClick={() => onNavigate('create')}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Create New Wallet
        </button>
        <button className="btn btn-ghost" onClick={() => onNavigate('import')}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import Existing Wallet
        </button>

        {/* ChainLens SSO — re-import path for existing ChainLens users */}
        <div style={{ position: 'relative', textAlign: 'center', margin: '4px 0' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--border)', transform: 'translateY(-50%)' }} />
          <span style={{ position: 'relative', background: 'var(--bg-dark)', padding: '0 10px', fontSize: 11, color: 'var(--text-muted)' }}>or</span>
        </div>
        {/* Below the divider sit the two "identity-backed" routes: a wallet from
            a passkey, and a wallet reached through a ChainLens account. Passkey
            creation is hidden entirely where the platform can't do it (browser
            extension, iOS, older Android WebViews) rather than shown and failing. */}
        {passkeyOffered && (
          <button
            className="btn btn-ghost"
            onClick={onCreateWithPasskey}
            style={{
              background: 'linear-gradient(135deg, rgba(0,170,255,0.12) 0%, rgba(56,189,248,0.12) 100%)',
              border: '1px solid rgba(0,170,255,0.35)',
              color: '#7dd3fc'
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <circle cx="10" cy="8" r="4"/>
              <path d="M10.3 14H7a4 4 0 0 0-4 4v2"/>
              <circle cx="17" cy="15" r="2.5"/>
              <path d="M17 17.5V21l1.5-1.5"/>
            </svg>
            Generate with Passkey
          </button>
        )}

        <button
          className="btn btn-ghost"
          onClick={() => onNavigate('import')}
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.12) 100%)',
            border: '1px solid rgba(99,102,241,0.35)',
            color: '#a5b4fc'
          }}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          Sign in with ChainLens
        </button>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        {/* Deliberately platform-neutral. "encrypted with your OS keychain" is
            true only on desktop (Electron safeStorage); on Android and iOS the
            vault is AES-256-GCM under the user's password in Capacitor
            Preferences, and the OS keychain holds only the optional biometric
            wrapping key. Claiming otherwise at the moment someone creates a
            wallet is a security claim we can't back on half the targets. */}
        Your seed phrase is encrypted on this device and never leaves it.<br />
        No data is transmitted to any server.
      </p>
    </div>
  )
}
