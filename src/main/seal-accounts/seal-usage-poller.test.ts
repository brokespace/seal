import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
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

describe('SealUsagePoller.readAll', () => {
  const pollers: SealUsagePoller[] = []
  afterEach(() => {
    for (const poller of pollers.splice(0)) {
      poller.dispose()
    }
  })

  function setup(options: { wanted: boolean; accounts: SealAccountCandidate[] }) {
    const reads: string[] = []
    const poller = new SealUsagePoller({
      now: () => START,
      candidates: (provider) => (provider === 'claude' ? options.accounts : []),
      settings: defaultSealAutoSwapSettings,
      inUse: (provider) => new Set(provider === 'claude' ? ['claude:work@acme.dev'] : []),
      wanted: () => options.wanted,
      fetch: async (candidate) => {
        reads.push(candidate.email ?? '')
        return reading(START, 20)
      }
    })
    pollers.push(poller)
    poller.sync()
    return { reads, poller }
  }

  it('asks for every account with a login, switched-off ones included, even while polling is off', async () => {
    const { reads, poller } = setup({
      wanted: false,
      accounts: [
        account('work@acme.dev'),
        { ...account('side@example.com'), disabled: true },
        { ...account('signed-out@example.com'), launchable: false }
      ]
    })

    await poller.readAll()

    expect(reads).toEqual(['work@acme.dev', 'side@example.com'])
    expect(poller.samplesFor('claude:side@example.com').latest?.at).toBe(START)
  })
})
