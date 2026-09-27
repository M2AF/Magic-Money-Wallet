/**
 * auto-revoke-ui.ts — display helpers for Settings → Security → Auto-revoke.
 *
 * The limits mirror src/main/auto-revoke.ts (the renderer tsconfig can't import
 * src/main). They only shape the control: the backend clamps and validates
 * every value itself, so a drift here could never widen the real range.
 */

export const AUTO_REVOKE_MIN_MINUTES = 1
export const AUTO_REVOKE_MAX_MINUTES = 60

/** Clamp to an integer minute in [1, 60]. */
export function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return AUTO_REVOKE_MIN_MINUTES
  return Math.min(AUTO_REVOKE_MAX_MINUTES, Math.max(AUTO_REVOKE_MIN_MINUTES, Math.round(value)))
}

/** One arrow press: exactly one minute, never past either end. */
export function stepMinutes(current: number, delta: 1 | -1): number {
  return clampMinutes(clampMinutes(current) + delta)
}

/** `N min`, or `1 hour` at the top of the range. */
export function formatDuration(minutes: number): string {
  const m = clampMinutes(minutes)
  return m === 60 ? '1 hour' : `${m} min`
}

/** Time left until the next automatic disconnect, rounded up to the minute. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms < 60_000) return 'under a minute'
  const minutes = Math.ceil(ms / 60_000)
  return minutes === 60 ? '1 hour' : `${minutes} min`
}
