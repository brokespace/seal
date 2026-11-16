import { describe, expect, it } from 'vitest'
import { clampTimerDelayMs } from './timer-delay'

describe('timer delay policy', () => {
  it.each([
    [-5, undefined, 0],
    [1_500.2, undefined, 1_501],
    [2_147_483_648, undefined, 2_147_483_647],
    [Number.MAX_SAFE_INTEGER, undefined, 2_147_483_647],
    [Number.POSITIVE_INFINITY, undefined, 2_147_483_647],
    [Number.NaN, 600_000, 600_000],
    [Number.MAX_SAFE_INTEGER, 600_000, 600_000]
  ])('clamps a %s ms delay with ceiling %s to %s', (delayMs, maxDelayMs, expected) => {
    expect(clampTimerDelayMs(delayMs, maxDelayMs)).toBe(expected)
  })
})
