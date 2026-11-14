import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { defaultSealAutoSwapSettings } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { SealUsagePoller } from './seal-usage-poller'

const START = 1_800_000_000_000

function account(email: string): SealAccountCandidate {
  return {
    key: `claude:${email}`,
    provider: 'claude',
    kind: 'oauth',
    localId: email,
    email,
    label: email,
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    limits: null,
    sessionThreshold: null,
    weeklyThreshold: null
  }
}

function reading(now: number, usedPercent: number): ProviderRateLimits {
  const window = {
    usedPercent,
    windowMinutes: 300,
    resetsAt: now + 3_600_000,
    resetDescription: null
  }
  return {
    provider: 'claude',
    session: window,
    weekly: { ...window, windowMinutes: 10_080 },
    updatedAt: now,
    error: null,
    status: 'ok'
  }
}

describe('SealUsagePoller.refreshNow', () => {
  const pollers: SealUsagePoller[] = []
  afterEach(() => {
    for (const poller of pollers.splice(0)) {
      poller.dispose()
    }
  })

  function setup(answer: (email: string, now: number) => ProviderRateLimits) {
    const clock = { now: START }
    const reads: string[] = []
    const accounts = [account('work@acme.dev'), account('side@example.com')]
    const poller = new SealUsagePoller({
      now: () => clock.now,
      candidates: (provider) => (provider === 'claude' ? accounts : []),
      settings: defaultSealAutoSwapSettings,
      inUse: (provider) => new Set(provider === 'claude' ? ['claude:work@acme.dev'] : []),
      wanted: () => true,
      fetch: async (candidate) => {
        reads.push(candidate.email ?? '')
        return answer(candidate.email ?? '', clock.now)
      }
    })
    pollers.push(poller)
    poller.sync()
    return { clock, reads, poller }
  }

  it('re-reads every account ahead of its schedule, but not one read seconds ago', async () => {
    const { clock, reads, poller } = setup((_email, now) => reading(now, 20))
    await poller.refreshNow()
    expect(reads).toEqual(['work@acme.dev', 'side@example.com'])

    clock.now = START + 10_000
    await poller.refreshNow()
    expect(reads).toEqual(['work@acme.dev', 'side@example.com'])

    // Both accounts are still minutes away from their scheduled poll.
    clock.now = START + 45_000
    expect(poller.nextPollAt('claude:side@example.com')).toBeGreaterThan(clock.now)
    await poller.refreshNow()
    expect(reads).toEqual([
      'work@acme.dev',
      'side@example.com',
      'work@acme.dev',
      'side@example.com'
    ])
  })

  it('reads an account at once after a new sign-in replaced its rejected login', async () => {
    let rejected = true
    const { clock, reads, poller } = setup((email, now) =>
      email === 'side@example.com' && rejected
        ? {
            provider: 'claude',
            session: null,
            weekly: null,
            updatedAt: now,
            error: 'token revoked',
            status: 'error',
            usageMetadata: { failureKind: 'stale-token' }
          }
        : reading(now, 20)
    )
    await poller.refreshNow()

    rejected = false
    clock.now = START + 5_000
    poller.forget('claude:side@example.com')
    await poller.refreshNow()
    expect(reads).toEqual(['work@acme.dev', 'side@example.com', 'side@example.com'])
  })

  it('leaves an account alone while the provider throttles its usage checks', async () => {
    const { clock, reads, poller } = setup((email, now) =>
      email === 'side@example.com'
        ? {
            provider: 'claude',
            session: null,
            weekly: null,
            updatedAt: now,
            error: 'rate limited',
            status: 'error',
            usageMetadata: { failureKind: 'rate-limited', retryAtMs: now + 600_000 }
          }
        : reading(now, 20)
    )
    await poller.refreshNow()
    clock.now = START + 120_000
    await poller.refreshNow()
    expect(reads).toEqual(['work@acme.dev', 'side@example.com', 'work@acme.dev'])
  })
})
