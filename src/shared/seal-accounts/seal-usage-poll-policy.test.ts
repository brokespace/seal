import { describe, expect, it } from 'vitest'
import { failureBackoffMs, planAfterFetch } from './seal-usage-poll-policy'
import type { SealWindowReading } from './seal-usage-lines'

const NOW = 1_800_000_000_000
const lines = { session: 90, weekly: 90 }
const noJitter = () => 0.5

function at(pct: number, resetsAt: number | null = null): SealWindowReading[] {
  return [{ label: '5h', pct, resetsAt }]
}

function plan(overrides: Partial<Parameters<typeof planAfterFetch>[0]>) {
  return planAfterFetch({
    prevIntervalMs: null,
    prev: null,
    next: at(10),
    inUse: true,
    lines,
    recent429: false,
    now: NOW,
    rng: noJitter,
    ...overrides
  })
}

describe('planAfterFetch (claude-swap poll_policy)', () => {
  it('polls an in-use account every minute while a window climbs within 15 points of its line', () => {
    expect(plan({ prevIntervalMs: 180_000, prev: at(74), next: at(80) })).toEqual({
      nextPollAt: NOW + 60_000,
      intervalMs: 60_000
    })
  })

  it('stays at 3 minutes for a climb still far from the line', () => {
    expect(plan({ prevIntervalMs: 300_000, prev: at(40), next: at(45) }).intervalMs).toBe(180_000)
  })

  it('backs an idle candidate off by half again, up to 10 minutes', () => {
    const idle = { inUse: false, prev: at(20), next: at(20) }
    expect(plan({ ...idle, prevIntervalMs: 300_000 }).intervalMs).toBe(450_000)
    expect(plan({ ...idle, prevIntervalMs: 450_000 }).intervalMs).toBe(600_000)
  })

  it('checks an exhausted account every 10 minutes, or just after its reset if sooner', () => {
    const reset = NOW + 120_000
    expect(plan({ prev: at(99), next: at(100, reset) })).toEqual({
      nextPollAt: reset + 60_000,
      intervalMs: 600_000
    })
  })

  it('slows to at least 6 minutes after a 429, growing by half each poll', () => {
    expect(
      plan({ recent429: true, prevIntervalMs: 180_000, prev: at(74), next: at(80) }).intervalMs
    ).toBe(360_000)
    expect(plan({ recent429: true, prevIntervalMs: 600_000 }).intervalMs).toBe(900_000)
  })
})

describe('failureBackoffMs', () => {
  it('doubles from 30s to a 10-minute cap and honours Retry-After', () => {
    const backoff = (consecutiveFailures: number, retryAfterMs: number | null = null) =>
      failureBackoffMs({ consecutiveFailures, rateLimited: true, retryAfterMs })
    expect([backoff(1), backoff(3), backoff(9)]).toEqual([30_000, 120_000, 600_000])
    expect(backoff(1, 0)).toBe(300_000)
    expect(backoff(1, 900_000)).toBe(900_000)
  })
})
