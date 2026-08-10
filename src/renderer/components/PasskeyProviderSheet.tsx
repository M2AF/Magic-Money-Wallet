/**
 * PasskeyProviderSheet — the presentation half of the system-passkey onboarding.
 *
 * Deliberately free of Capacitor, plugins and async: every input is a prop. Two
 * reasons, and the second is the one that mattered in practice:
 *
 *   1. The copy it renders carries two measured facts (Chrome always offers
 *      Google first; the wallet's own browser has no chooser) that are worth
 *      reviewing visually, not just as strings in a test.
 *   2. Stubbing the native layer to see it is not actually possible —
 *      `registerPlugin` with no web implementation ignores
 *      CapacitorCustomPlatform, so a screenshot harness cannot fake a status.
 *      Props can.
 *
 * PasskeyProviderPrompt owns the I/O and renders this.
 */

import type { OnboardingCopy } from '../lib/passkey-onboarding'

export interface PasskeyProviderSheetProps {
  copy: OnboardingCopy
  busy?: boolean
  /** Set once Settings has been opened; swaps the buttons for a single Done. */
  landing?: string | null
  error?: string | null
  onPrimary: () => void
  onSecondary: () => void
}

export function PasskeyProviderSheet({
  copy, busy = false, landing = null, error = null, onPrimary, onSecondary,
}: PasskeyProviderSheetProps): JSX.Element {
  return (
    <div style={backdrop} role="dialog" aria-modal="true" aria-label={copy.title}>
      <div style={sheet}>
        <div style={{ fontSize: 30, lineHeight: 1 }}>🪪</div>
        <h2 style={heading}>{copy.title}</h2>

        {copy.body.map((line, i) => (
          <p key={i} style={para}>{line}</p>
        ))}

        {/* The Chrome caveat, deliberately prominent. A user who expects Magic
            Money to be offered first will conclude it is broken and turn it off,
            and no setting we control changes that ordering. */}
        {copy.browserNote && <div style={noteBand}>{copy.browserNote}</div>}

        {/* …and the counterweight: the one place it is genuinely seamless. */}
        {copy.ownBrowserNote && <p style={goodNote}>{copy.ownBrowserNote}</p>}

        {landing && <div style={landingBand}>{landing}</div>}
        {error && <div style={errorBand}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {landing ? (
            <button type="button" style={primaryBtn} onClick={onSecondary}>Done</button>
          ) : (
            <>
              <button type="button" style={primaryBtn} disabled={busy} onClick={onPrimary}>
                {busy ? 'Please wait…' : copy.primaryAction}
              </button>
              <button type="button" style={secondaryBtn} disabled={busy} onClick={onSecondary}>
                {copy.secondaryAction}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(2,6,23,.72)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
}

const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 460, background: 'var(--card, #0f172a)',
  border: '1px solid rgba(255,255,255,.10)', borderRadius: '18px 18px 0 0',
  padding: '20px 18px calc(18px + env(safe-area-inset-bottom))',
  display: 'flex', flexDirection: 'column', gap: 6,
}

const heading: React.CSSProperties = {
  fontSize: 18, fontWeight: 700, color: 'var(--text, #f8fafc)', margin: '4px 0 2px',
}

const para: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted, #9aa4b2)', margin: 0,
}

const goodNote: React.CSSProperties = { ...para, color: '#34d399', marginTop: 8 }

const noteBand: React.CSSProperties = {
  marginTop: 8, padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
  background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: '#fcd34d',
}

const landingBand: React.CSSProperties = {
  marginTop: 8, padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
  background: 'rgba(37,99,235,.12)', border: '1px solid rgba(37,99,235,.35)', color: '#bfdbfe',
}

const errorBand: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#f87171' }

const primaryBtn: React.CSSProperties = {
  // --on-accent, never a hardcoded #fff: the Mono theme sets --accent to
  // #ffffff, so white-on-accent rendered a blank white button with invisible
  // text. Reported from the device; the preview harness could not catch it
  // because it supplies its own colours rather than the app's theme tokens.
  border: 0, borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 700,
  background: 'var(--accent, #2563eb)', color: 'var(--on-accent, #fff)', cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 12, fontSize: 14,
  background: 'transparent', color: 'var(--muted, #9aa4b2)', cursor: 'pointer',
}
