/**
 * passkey-onboarding.ts — what to tell the user about system passkeys, and when
 *
 * Two things were measured on a Galaxy S21+ (Android 15) that the UI exists to
 * make obvious, because both are surprising and neither is a bug we can fix:
 *
 *   1. CHROME ALWAYS OFFERS GOOGLE PASSWORD MANAGER FIRST when creating a
 *      passkey. Magic Money is behind "More options". Setting Magic Money as the
 *      Preferred Service changed nothing, and `credential_service_primary` was
 *      already ours. Chrome privileges Google here; 1Password and Bitwarden are
 *      behind the same tap. So the onboarding TEACHES the tap rather than
 *      promising a default it cannot deliver.
 *
 *   2. MAGIC MONEY'S OWN BROWSER SHOWS NO SYSTEM SHEET AT ALL. The Phase 3 shim
 *      makes the wallet the authenticator directly, so there is nothing to pick
 *      and nothing to enable. Saying so matters: otherwise the "More options"
 *      instruction reads as applying everywhere, and the wallet's own browser —
 *      the one place the experience is genuinely clean — looks equally clumsy.
 *
 * Pure: no Capacitor, no React, no DOM. The copy is data so the wording can be
 * asserted in tests, which is the only way a claim like "tap More options" stays
 * true to what the device actually does.
 */

/**
 * The bits of the native status this module reasons about.
 *
 * Declared structurally rather than imported from src/capacitor: this file is
 * shared renderer code (Electron, extension and Android all compile it), and
 * tsconfig.web.json deliberately cannot see the Capacitor tree. The real
 * PasskeyProviderStatus is assignable to this.
 */
export interface PasskeyProviderStatusLike {
  supported: boolean
  enrolled: boolean
  enabledInSettings: boolean | null
}

/** Where a user is in the enable flow, from the wallet's point of view. */
export type PasskeyOnboardingStage =
  /** Below Android 14 — no provider API exists. Show nothing at all. */
  | 'unsupported'
  /** Supported, no root handed over yet. The one action worth prompting for. */
  | 'not-enrolled'
  /** Root handed over; Android will not tell us whether we are selected. */
  | 'enrolled-unknown'
  /** Root handed over and Android confirms we are NOT selected in Settings. */
  | 'enrolled-not-selected'
  /** Root handed over and Android confirms we are selected. */
  | 'ready'

export function onboardingStage(status: PasskeyProviderStatusLike | null): PasskeyOnboardingStage {
  if (!status || !status.supported) return 'unsupported'
  if (!status.enrolled) return 'not-enrolled'
  if (status.enabledInSettings === false) return 'enrolled-not-selected'
  if (status.enabledInSettings === true) return 'ready'
  return 'enrolled-unknown'
}

/**
 * Should the first-run prompt appear?
 *
 * Only for a stage where there is something to do, only when the user has not
 * already dismissed it, and never below Android 14 — the plan's rule is to hide
 * a control that cannot work rather than show one that fails.
 */
export function shouldPromptFirstRun(
  status: PasskeyProviderStatusLike | null, dismissed: boolean,
): boolean {
  if (dismissed) return false
  return onboardingStage(status) === 'not-enrolled'
}

export interface OnboardingCopy {
  title: string
  /** Short lines, in order. Rendered as a list, not a paragraph. */
  body: string[]
  primaryAction: string
  secondaryAction: string
  /** The Chrome caveat. Null where it does not apply. */
  browserNote: string | null
  /** The own-browser exemption. Always present once supported. */
  ownBrowserNote: string | null
}

/**
 * ⚠ The two notes below are load-bearing and were written against measured
 * behaviour. Do not soften "More options" into "choose Magic Money" — the whole
 * point is that Magic Money is NOT the first thing offered, and a user told
 * otherwise will conclude the feature is broken and turn it off.
 */
const MORE_OPTIONS_NOTE =
  'In Chrome, Brave and Samsung Internet, Google is always offered first — '
  + 'tap “More options” to pick Magic Money. Every third-party provider sits '
  + 'behind that tap; it is not something the wallet can change.'

const OWN_BROWSER_NOTE =
  'In Magic Money’s own browser there is no chooser at all — passkeys just work.'

export function onboardingCopy(stage: PasskeyOnboardingStage): OnboardingCopy | null {
  switch (stage) {
    case 'unsupported':
      return null

    case 'not-enrolled':
      return {
        title: 'Use your passkeys everywhere',
        body: [
          'Magic Money can sign you in to websites in Chrome, Brave and Samsung Internet, using passkeys built from your seed phrase.',
          'Nothing is uploaded. The same 12 or 24 words restore them on any device.',
        ],
        primaryAction: 'Turn on',
        secondaryAction: 'Not now',
        browserNote: MORE_OPTIONS_NOTE,
        ownBrowserNote: OWN_BROWSER_NOTE,
      }

    case 'enrolled-not-selected':
      return {
        title: 'One step left',
        body: [
          'Magic Money is ready, but Android has not selected it yet.',
          'Open Settings → Passwords, passkeys & accounts and switch Magic Money on.',
        ],
        primaryAction: 'Open Settings',
        secondaryAction: 'Later',
        browserNote: MORE_OPTIONS_NOTE,
        ownBrowserNote: OWN_BROWSER_NOTE,
      }

    case 'enrolled-unknown':
      return {
        title: 'System passkeys are on',
        body: [
          'Magic Money is ready to sign you in to other browsers.',
          // Android does not expose whether a provider is selected (measured:
          // unreadable by the app on Samsung even when it IS us), so this must
          // not assert that it is — it tells the user how to check instead.
          'If a site never offers it, check Settings → Passwords, passkeys & accounts.',
        ],
        primaryAction: 'Open Settings',
        secondaryAction: 'Done',
        browserNote: MORE_OPTIONS_NOTE,
        ownBrowserNote: OWN_BROWSER_NOTE,
      }

    case 'ready':
      return {
        title: 'System passkeys are on',
        body: ['Magic Money is selected and will sign you in to other browsers.'],
        primaryAction: 'Open Settings',
        secondaryAction: 'Done',
        browserNote: MORE_OPTIONS_NOTE,
        ownBrowserNote: OWN_BROWSER_NOTE,
      }
  }
}

/** The Settings-row label and sublabel for each stage. */
export function settingsRowCopy(stage: PasskeyOnboardingStage): { label: string; sublabel: string } | null {
  switch (stage) {
    case 'unsupported':
      return null
    case 'not-enrolled':
      return {
        label: 'Use your passkeys in other browsers',
        sublabel: 'Adds Magic Money to Settings → Passwords, passkeys & accounts.',
      }
    case 'enrolled-not-selected':
      return {
        label: 'System passkeys — finish setup',
        sublabel: 'Ready, but not selected yet. Tap to open Settings.',
      }
    case 'enrolled-unknown':
    case 'ready':
      return {
        label: 'System passkeys — On',
        sublabel: 'Chrome shows Google first — tap “More options” for Magic Money. Tap to turn off.',
      }
  }
}

/**
 * What to say after tapping through to Settings.
 *
 * `via` comes from the native fallback ladder. On a build where nothing resolved
 * the user has to be given written directions — claiming a screen opened when it
 * did not is how an onboarding step becomes a dead end.
 */
export function settingsLandingNote(via: string, opened: boolean): string {
  if (!opened) {
    return 'This device would not open that screen. Open Settings and search for '
      + '“Passwords, passkeys” — then switch Magic Money on.'
  }
  if (via === 'settings-root') {
    return 'Settings is open — go to Passwords, passkeys & accounts and switch Magic Money on.'
  }
  return 'Switch Magic Money on, then come back.'
}
