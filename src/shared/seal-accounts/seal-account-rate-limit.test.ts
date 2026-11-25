import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../rate-limit-types'
import { sealAccountRateLimit } from './seal-account-rate-limit'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function reading(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: 40,
      windowMinutes: 300,
      resetsAt: NOW + 2 * HOUR,
      resetDescription: null
    },
    weekly: {
      usedPercent: 50,
      windowMinutes: 10_080,
      resetsAt: NOW + 72 * HOUR,
      resetDescription: null
    },
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...overrides
  }
}

describe('sealAccountRateLimit', () => {
  it('is not rate limited at 99% of a window', () => {
    const limits = reading({ session: { ...reading().session!, usedPercent: 99 } })
    expect(sealAccountRateLimit({ limits }, { now: NOW })).toBeNull()
  })

  it('lasts until the last full window resets', () => {
    const limits = reading({
      session: { ...reading().session!, usedPercent: 100 },
      weekly: { ...reading().weekly!, usedPercent: 100 }
    })
    expect(sealAccountRateLimit({ limits }, { now: NOW })).toEqual({ resetsAt: NOW + 72 * HOUR })
    expect(sealAccountRateLimit({ limits }, { now: NOW + 3 * HOUR })).toEqual({
      resetsAt: NOW + 72 * HOUR
    })
    expect(sealAccountRateLimit({ limits }, { now: NOW + 73 * HOUR })).toBeNull()
  })

  it('ignores a failed usage check that kept the last windows', () => {
    const limits = reading({
      status: 'error',
      error: 'Claude is throttling usage checks right now.',
      usageMetadata: { failureKind: 'rate-limited', retryAtMs: NOW + 5 * MINUTE }
    })
    expect(sealAccountRateLimit({ limits }, { now: NOW })).toBeNull()
  })

  it('counts a limit stop an agent printed until the session window resets', () => {
    const limits = reading({ updatedAt: NOW - 10 * MINUTE })
    const stop = { limitStopAt: NOW - MINUTE }
    expect(sealAccountRateLimit({ limits }, { ...stop, now: NOW })).toEqual({
      resetsAt: NOW + 2 * HOUR
    })
    expect(sealAccountRateLimit({ limits }, { ...stop, now: NOW + 2 * HOUR })).toBeNull()
  })

  it('drops a limit stop once a later reading shows room', () => {
    const limits = reading({ updatedAt: NOW })
    expect(sealAccountRateLimit({ limits }, { now: NOW, limitStopAt: NOW - MINUTE })).toBeNull()
  })

  it('holds a limit stop for an hour when no reading names a reset', () => {
    const stop = { limitStopAt: NOW }
    expect(sealAccountRateLimit({ limits: null }, { ...stop, now: NOW + 59 * MINUTE })).toEqual({
      resetsAt: NOW + HOUR
    })
    expect(sealAccountRateLimit({ limits: null }, { ...stop, now: NOW + HOUR })).toBeNull()
  })

  it('does not call a full model-only window an account limit', () => {
    const limits = reading({
      fableWeekly: {
        usedPercent: 100,
        windowMinutes: 10_080,
        resetsAt: NOW + 72 * HOUR,
        resetDescription: null
      }
    })
    expect(sealAccountRateLimit({ limits }, { now: NOW })).toBeNull()
  })
})
