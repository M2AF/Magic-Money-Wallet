/**
 * copy-seed.ts — copying a seed phrase to the clipboard, as safely as a
 * clipboard allows.
 *
 * The clipboard is the least-protected place a seed can sit: any running app
 * can read it, clipboard managers keep history, and Windows Cloud Clipboard can
 * sync it off the device. We can't fix any of that from here, so we do the one
 * thing we can — put it there for as short a time as possible and take it back
 * automatically.
 *
 * Used by the create screen and by the password-gated reveal in Settings, so
 * both behave identically.
 */

/** Long enough to paste into a password manager, short enough to matter. */
export const SEED_CLIPBOARD_TTL_MS = 90_000

let pendingClear: ReturnType<typeof setTimeout> | null = null

/**
 * Copy the phrase and schedule its removal.
 *
 * On expiry we try to read the clipboard first and only clear when it still
 * holds the phrase, so we don't wipe something the user copied in the meantime.
 * When reading isn't permitted we clear anyway: an unrelated clipboard entry
 * being lost is a smaller harm than a seed phrase left sitting there.
 *
 * @returns true when the phrase reached the clipboard.
 */
export async function copySeedPhrase(words: string[]): Promise<boolean> {
  const phrase = words.join(' ')
  try {
    await navigator.clipboard.writeText(phrase)
  } catch {
    return false
  }

  if (pendingClear) clearTimeout(pendingClear)
  pendingClear = setTimeout(() => {
    pendingClear = null
    void (async () => {
      let stillOurs = true
      try {
        stillOurs = (await navigator.clipboard.readText()) === phrase
      } catch {
        // Can't verify — clear regardless.
      }
      if (stillOurs) await navigator.clipboard.writeText('').catch(() => {})
    })()
  }, SEED_CLIPBOARD_TTL_MS)

  return true
}

/** Drop a scheduled clear — call when the phrase is cleared for other reasons. */
export function cancelSeedClipboardClear(): void {
  if (pendingClear) {
    clearTimeout(pendingClear)
    pendingClear = null
  }
}
