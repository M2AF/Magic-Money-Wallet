/**
 * back-handler.ts — lets an open overlay claim the Android hardware Back button.
 *
 * Overlays register while mounted; the Capacitor `backButton` listener asks
 * `consumeBack()` before it backgrounds the app. Newest registration wins
 * (stack order). Harmless on targets with no hardware Back: nothing calls it.
 */

type BackHandler = () => void

const stack: BackHandler[] = []

/** Returns the unregister function. */
export function registerBackHandler(fn: BackHandler): () => void {
  stack.push(fn)
  return () => {
    const i = stack.lastIndexOf(fn)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** True when an overlay handled Back (the caller must NOT minimise the app). */
export function consumeBack(): boolean {
  const fn = stack[stack.length - 1]
  if (!fn) return false
  fn()
  return true
}
