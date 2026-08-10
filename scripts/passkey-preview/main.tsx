/**
 * Preview harness for the passkey-provider onboarding.
 *
 * Renders the REAL sheet and the REAL row copy against props, one state per
 * screen, so the wording can be reviewed visually. Not shipped: this lives under
 * scripts/ and is never an input to any app build.
 *
 * Why props and not a stubbed device: `registerPlugin` with no web
 * implementation ignores CapacitorCustomPlatform, so the app's native status
 * cannot be faked in a browser — and the phone can only show one state at a
 * time, behind a fingerprint.
 */
// The app's REAL stylesheet and theme tokens. ⚠ Not optional: this harness
// originally supplied its own colours, which hid a white-on-white button — the
// Mono theme sets --accent to #ffffff, and a hardcoded #fff made the primary
// button unreadable. Only a device report caught it. Importing the real tokens
// is what lets a theme bug show up here instead.
import '../../src/renderer/index.css'
import { createRoot } from 'react-dom/client'
import { PasskeyProviderSheet } from '../../src/renderer/components/PasskeyProviderSheet'
import { onboardingCopy, settingsRowCopy, settingsLandingNote, type PasskeyOnboardingStage } from '../../src/renderer/lib/passkey-onboarding'

const params = new URLSearchParams(location.search)
// Themes are data-theme overrides in index.css. Rendering the sheet under a
// named theme is how a token bug (white --accent) becomes visible here.
document.documentElement.setAttribute('data-theme', params.get('theme') || 'midnight')
const stage = (params.get('stage') || 'not-enrolled') as PasskeyOnboardingStage
const landing = params.get('landing')
const copy = onboardingCopy(stage)
const row = settingsRowCopy(stage)

function Row() {
  if (!row) return <div style={{ color: '#64748b', padding: 20, fontSize: 13 }}>Settings row: hidden (unsupported)</div>
  return (
    <div style={{ padding: '10px 0' }}>
      <div style={{ color: '#64748b', fontSize: 11, padding: '0 14px 6px', textTransform: 'uppercase', letterSpacing: .5 }}>Settings row</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', background: '#0f172a', borderTop: '1px solid rgba(255,255,255,.07)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <span style={{ fontSize: 20 }}>🪪</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}>{row.label}</span>
          <span style={{ color: '#9aa4b2', fontSize: 12, lineHeight: 1.45 }}>{row.sublabel}</span>
        </span>
      </div>
      {stage !== 'not-enrolled' && (
        <div style={{ color: '#9aa4b2', fontSize: 11, padding: '8px 14px', lineHeight: 1.5 }}>
          In Magic Money’s own browser passkeys just work — no chooser.{' '}
          <span style={{ color: '#2563eb', textDecoration: 'underline' }}>Open Settings</span>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <div style={{ minHeight: '100vh' }}>
    <Row />
    {copy && (
      <PasskeyProviderSheet
        copy={copy}
        landing={landing ? settingsLandingNote(landing, landing !== 'none') : null}
        onPrimary={() => {}}
        onSecondary={() => {}}
      />
    )}
  </div>
)
