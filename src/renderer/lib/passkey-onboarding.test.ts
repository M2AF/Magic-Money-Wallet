import { describe, it, expect } from 'vitest'
import {
  onboardingStage, shouldPromptFirstRun, onboardingCopy, settingsRowCopy, settingsLandingNote, MAX_SUBLABEL,
  type PasskeyOnboardingStage,
  type PasskeyProviderStatusLike,
} from './passkey-onboarding'

const status = (over: Partial<PasskeyProviderStatusLike> & { androidVersion?: number } = {}): PasskeyProviderStatusLike => ({
  supported: true, enrolled: false, enabledInSettings: null, ...over,
})

const ALL_STAGES: PasskeyOnboardingStage[] =
  ['unsupported', 'not-enrolled', 'enrolled-unknown', 'enrolled-not-selected', 'ready']

describe('passkey onboarding · stage', () => {
  it('is unsupported below Android 14, and on a platform with no plugin at all', () => {
    expect(onboardingStage(null)).toBe('unsupported')
    expect(onboardingStage(status({ supported: false, androidVersion: 33 }))).toBe('unsupported')
    // Even if some earlier state left `enrolled` set, an unsupported OS wins.
    expect(onboardingStage(status({ supported: false, enrolled: true }))).toBe('unsupported')
  })

  it('distinguishes not-enrolled from the three enrolled states', () => {
    expect(onboardingStage(status({ enrolled: false }))).toBe('not-enrolled')
    expect(onboardingStage(status({ enrolled: true, enabledInSettings: null }))).toBe('enrolled-unknown')
    expect(onboardingStage(status({ enrolled: true, enabledInSettings: false }))).toBe('enrolled-not-selected')
    expect(onboardingStage(status({ enrolled: true, enabledInSettings: true }))).toBe('ready')
  })

  // Measured: on Samsung/Android 15 the app cannot read the setting even when it
  // IS us, so null is the normal case. Treating null as "not selected" would nag
  // every Samsung user forever.
  it('treats an unreadable setting as unknown, never as "off"', () => {
    expect(onboardingStage(status({ enrolled: true, enabledInSettings: null })))
      .not.toBe('enrolled-not-selected')
  })
})

describe('passkey onboarding · first-run prompt', () => {
  it('appears exactly once, only when there is something to do', () => {
    expect(shouldPromptFirstRun(status({ enrolled: false }), false)).toBe(true)
    expect(shouldPromptFirstRun(status({ enrolled: false }), true)).toBe(false)   // dismissed
  })

  it('never appears below Android 14 — the control cannot work there', () => {
    expect(shouldPromptFirstRun(status({ supported: false }), false)).toBe(false)
    expect(shouldPromptFirstRun(null, false)).toBe(false)
  })

  it('does not nag once the root is handed over', () => {
    for (const enabledInSettings of [null, true, false] as const) {
      expect(shouldPromptFirstRun(status({ enrolled: true, enabledInSettings }), false)).toBe(false)
    }
  })
})

describe('passkey onboarding · copy', () => {
  it('shows nothing at all when unsupported', () => {
    expect(onboardingCopy('unsupported')).toBeNull()
    expect(settingsRowCopy('unsupported')).toBeNull()
  })

  // The finding this whole feature's copy exists for. Chrome puts Google first
  // and no setting changes it, so the wording must teach the tap.
  it('teaches the "More options" tap wherever a chooser appears', () => {
    for (const stage of ALL_STAGES.filter(s => s !== 'unsupported')) {
      const copy = onboardingCopy(stage)
      expect(copy, stage).not.toBeNull()
      expect(copy!.browserNote, stage).toMatch(/More options/)
      expect(copy!.browserNote, stage).toMatch(/Chrome/)
    }
  })

  // "Google is offered first" is the TRUE statement and must survive; what must
  // never appear is a promise that Magic Money is first or the default, since
  // setting Preferred Service was measured to change nothing.
  it('names Google as first, and never claims that slot for Magic Money', () => {
    for (const stage of ALL_STAGES.filter(s => s !== 'unsupported')) {
      const copy = onboardingCopy(stage)!
      const all = [copy.title, ...copy.body, copy.browserNote ?? '', copy.ownBrowserNote ?? ''].join(' ')
      expect(all, stage).toMatch(/Google is always offered first/i)
      expect(all, stage).not.toMatch(/\bMagic Money (is|will be) (the )?(default|first)\b/i)
      expect(all, stage).not.toMatch(/Magic Money[^.]{0,40}(offered|appears) first/i)
      expect(all, stage).not.toMatch(/\bset (it|Magic Money) as (the )?default\b/i)
    }
  })

  // The other finding: the wallet's own browser has no sheet, so the "More
  // options" instruction must not read as applying there too.
  it('says plainly that the wallet’s own browser needs no extra tap', () => {
    for (const stage of ALL_STAGES.filter(s => s !== 'unsupported')) {
      const note = onboardingCopy(stage)!.ownBrowserNote
      expect(note, stage).toMatch(/own browser/i)
      expect(note, stage).toMatch(/no chooser|just work/i)
    }
  })

  it('offers a way out of the first-run prompt', () => {
    const copy = onboardingCopy('not-enrolled')!
    expect(copy.primaryAction).toBeTruthy()
    expect(copy.secondaryAction).toMatch(/not now/i)
  })

  it('asks the user to finish in Settings only when Android says we are unselected', () => {
    expect(onboardingCopy('enrolled-not-selected')!.body.join(' ')).toMatch(/switch magic money on/i)
    // …and does NOT assert selection in the state where Android would not say.
    expect(onboardingCopy('enrolled-unknown')!.body.join(' ')).not.toMatch(/is selected/i)
    expect(onboardingCopy('ready')!.body.join(' ')).toMatch(/is selected/i)
  })

  it('gives the Settings row a distinct label per stage', () => {
    const labels = ALL_STAGES.filter(s => s !== 'unsupported').map(s => settingsRowCopy(s)!.label)
    expect(new Set(labels).size).toBeGreaterThanOrEqual(3)
    expect(settingsRowCopy('not-enrolled')!.label).not.toMatch(/On$/)
    expect(settingsRowCopy('ready')!.label).toMatch(/On$/)
  })

  // ⚠ Regression guard for a defect the device screenshot caught: SettingsRow
  // clamps the sublabel to ONE line, so the Chrome caveat living there was
  // ellipsised mid-instruction — the user read 'tap “More options”…' and never
  // learned what to do next. The caveat belongs in the wrapping note; the
  // sublabel must stay short enough to survive.
  it('keeps every sublabel short enough not to be ellipsised', () => {
    for (const stage of ALL_STAGES.filter(s => s !== 'unsupported')) {
      const { sublabel } = settingsRowCopy(stage)!
      expect(sublabel.length, `${stage}: "${sublabel}"`).toBeLessThanOrEqual(MAX_SUBLABEL)
    }
  })

  it('does not bury the Chrome caveat in the clamped sublabel', () => {
    for (const stage of ALL_STAGES.filter(s => s !== 'unsupported')) {
      expect(settingsRowCopy(stage)!.sublabel, stage).not.toMatch(/More options/)
    }
    // …it lives in the note instead, which wraps.
    expect(onboardingCopy('ready')!.browserNote).toMatch(/More options/)
  })
})

describe('passkey onboarding · landing note', () => {
  // The native ladder can fail entirely on an unseen OEM build. Claiming the
  // screen opened would leave the user staring at the wallet wondering what
  // happened, which is worse than admitting it and giving directions.
  it('gives written directions when nothing opened', () => {
    const note = settingsLandingNote('none', false)
    expect(note).toMatch(/search/i)
    expect(note).toMatch(/Passwords, passkeys/)
  })

  it('explains the extra navigation when only the settings root opened', () => {
    expect(settingsLandingNote('settings-root', true)).toMatch(/go to Passwords, passkeys/i)
  })

  it('stays short when the real picker opened', () => {
    const note = settingsLandingNote('picker-component', true)
    expect(note).toMatch(/switch magic money on/i)
    expect(note.length).toBeLessThan(60)
  })
})
