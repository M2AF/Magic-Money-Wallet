/**
 * PasskeyProviderPrompt — the one-time offer to turn on system passkeys.
 *
 * The I/O half: probe the native provider, decide whether to show anything, and
 * drive enable → open Settings. The visuals live in PasskeyProviderSheet, which
 * takes plain props so the copy can be screenshotted in every state without a
 * device — stubbing the native layer is not possible, because `registerPlugin`
 * with no web implementation ignores CapacitorCustomPlatform entirely.
 *
 * Shown once, after unlock, only on Android 14+ where the provider API exists,
 * and only while there is something to do. "Not now" is remembered.
 */

import { useEffect, useState } from 'react'
import {
  passkeyProviderStatus, enablePasskeyProvider, openPasskeyProviderSettings,
  passkeyPromptDismissed, dismissPasskeyPrompt,
  type PasskeyProviderStatus,
} from './passkey-system-provider'
import {
  onboardingStage, onboardingCopy, shouldPromptFirstRun, settingsLandingNote,
} from '../renderer/lib/passkey-onboarding'
import { PasskeyProviderSheet } from '../renderer/components/PasskeyProviderSheet'

export function PasskeyProviderPrompt(): JSX.Element | null {
  const [status, setStatus] = useState<PasskeyProviderStatus | null>(null)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [landing, setLanding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      passkeyProviderStatus(),
      passkeyPromptDismissed(),
      // ⚠ Gate on an UNLOCKED wallet, not just on the app being open. CapApp
      // renders this branch for a brand-new user too, and enabling derives
      // webauthnRoot from the seed — so without this the prompt would nag
      // someone at the welcome screen and then fail on tap with "locked".
      Promise.resolve(window.wallet?.isUnlocked?.()).catch(() => false),
    ])
      .then(([s, dismissed, unlocked]) => {
        if (!alive) return
        setStatus(s)
        setVisible(unlocked === true && shouldPromptFirstRun(s, dismissed))
      })
      .catch(() => { /* no plugin — stay hidden */ })
    return () => { alive = false }
  }, [])

  if (!visible || !status) return null
  const copy = onboardingCopy(onboardingStage(status))
  if (!copy) return null

  const close = async () => {
    await dismissPasskeyPrompt()
    setVisible(false)
  }

  const turnOn = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await enablePasskeyProvider()
      // Enabling only hands the root over; Android never lets an app select
      // itself, so the user still has to flip the switch in Settings.
      const landed = await openPasskeyProviderSettings()
      setLanding(settingsLandingNote(landed.via, landed.opened))
      await dismissPasskeyPrompt()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <PasskeyProviderSheet
      copy={copy}
      busy={busy}
      landing={landing}
      error={error}
      onPrimary={turnOn}
      onSecondary={close}
    />
  )
}
