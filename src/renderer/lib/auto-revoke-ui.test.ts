import { describe, expect, it } from 'vitest'
import {
  AUTO_REVOKE_MAX_MINUTES, AUTO_REVOKE_MIN_MINUTES,
  clampMinutes, formatDuration, formatRemaining, stepMinutes,
} from './auto-revoke-ui'

describe('auto-revoke control helpers', () => {
  // Parity with the backend limits is pinned in
  // src/extension/auto-revoke-handlers.test.ts (the only project that sees both).
  it('spans 1 to 60 minutes', () => {
    expect(AUTO_REVOKE_MIN_MINUTES).toBe(1)
    expect(AUTO_REVOKE_MAX_MINUTES).toBe(60)
  })

  it('arrows move exactly one minute and stop at the ends', () => {
    expect(stepMinutes(15, 1)).toBe(16)
    expect(stepMinutes(15, -1)).toBe(14)
    expect(stepMinutes(1, -1)).toBe(1)
    expect(stepMinutes(60, 1)).toBe(60)
    expect(stepMinutes(59, 1)).toBe(60)
    expect(stepMinutes(2, -1)).toBe(1)
  })

  it('clamps whatever the slider reports', () => {
    expect(clampMinutes(0)).toBe(1)
    expect(clampMinutes(75)).toBe(60)
    expect(clampMinutes(12.4)).toBe(12)
    expect(clampMinutes(NaN)).toBe(1)
  })

  it('labels N min, and 1 hour at the top', () => {
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 hour')
  })

  it('rounds remaining time up to the minute', () => {
    expect(formatRemaining(0)).toBe('now')
    expect(formatRemaining(30_000)).toBe('under a minute')
    expect(formatRemaining(60_001)).toBe('2 min')
    expect(formatRemaining(60 * 60_000)).toBe('1 hour')
  })
})
