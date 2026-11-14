import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from './seal-account-candidates'
import { decideAutoSwap } from './seal-auto-swap-decision'
import { defaultSealAutoSwapSettings, type SealAutoSwapSettings } from './seal-accounts-config'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function account(
  key: string,
  usage: { session?: number; weekly?: number; resetsAt?: number } | null,
  extra: Partial<SealAccountCandidate> = {}
): SealAccountCandidate {
  return {
    key,
    provider: 'claude',
    kind: 'oauth',
    localId: key,
    email: key.slice('claude:'.length),
    label: key,
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    usage: usage
      ? {
          session:
            usage.session === undefined
              ? null
              : { usedPercent: usage.session, resetsAt: usage.resetsAt ?? NOW + HOUR },
          weekly: usage.weekly === undefined ? null : { usedPercent: usage.weekly, resetsAt: null },
          models: [],
          planType: null,
          updatedAt: NOW,
          error: null
        }
      : null,
    sessionThreshold: null,
    weeklyThreshold: null,
    ...extra
  }
}

const enabled: SealAutoSwapSettings = { ...defaultSealAutoSwapSettings(), enabled: true }

function decide(
  candidates: SealAccountCandidate[],
  overrides: Partial<Parameters<typeof decideAutoSwap>[0]> = {}
) {
  return decideAutoSwap({
    settings: enabled,
    candidates,
    policy: { allow: null },
    quarantine: {},
    lastSwapAt: null,
    now: NOW,
    ...overrides
  })
}

describe('decideAutoSwap', () => {
  it('moves off an account over its session threshold to the one with the most room', () => {
    const decision = decide([
      account('claude:a@x.com', { session: 92, weekly: 40 }, { active: true }),
      account('claude:b@x.com', { session: 60, weekly: 10 }),
      account('claude:c@x.com', { session: 10, weekly: 20 })
    ])
    expect(decision).toMatchObject({
      kind: 'swap',
      from: 'claude:a@x.com',
      reason: 'threshold',
      quarantine: []
    })
    expect(decision.kind === 'swap' && decision.to.key).toBe('claude:c@x.com')
  })

  it('stays inside the cooldown after a threshold swap', () => {
    const decision = decide(
      [
        account('claude:a@x.com', { session: 95 }, { active: true }),
        account('claude:b@x.com', { session: 5 })
      ],
      { lastSwapAt: NOW - 2 * 60_000 }
    )
    expect(decision).toEqual({ kind: 'stay', reason: 'cooldown' })
  })

  it('fails over a dead login during the cooldown and quarantines it', () => {
    const decision = decide(
      [
        account('claude:a@x.com', { session: 10 }, { active: true, authFailure: true }),
        account('claude:b@x.com', { session: 5 })
      ],
      { lastSwapAt: NOW - 60_000 }
    )
    expect(decision).toMatchObject({
      kind: 'swap',
      reason: 'auth-failure',
      quarantine: ['claude:a@x.com']
    })
  })

  it('refuses a target within the hysteresis band below a threshold', () => {
    const decision = decide([
      account('claude:a@x.com', { session: 91 }, { active: true }),
      account('claude:b@x.com', { session: 86 })
    ])
    expect(decision).toEqual({ kind: 'stay', reason: 'no-candidate' })
  })

  it('skips quarantined, disabled, API-key and disallowed accounts', () => {
    const decision = decide(
      [
        account('claude:a@x.com', { session: 99 }, { active: true }),
        account('claude:q@x.com', { session: 1 }),
        account('claude:d@x.com', { session: 1 }, { disabled: true }),
        account('claude-key:k1', null, { kind: 'api-key' }),
        account('claude:other@x.com', { session: 1 }),
        account('claude:ok@x.com', { session: 50 })
      ],
      {
        policy: {
          allow: ['claude:a@x.com', 'claude:q@x.com', 'claude:d@x.com', 'claude:ok@x.com']
        },
        quarantine: { 'claude:q@x.com': { until: NOW + HOUR, reason: 'dead' } }
      }
    )
    expect(decision.kind === 'swap' && decision.to.key).toBe('claude:ok@x.com')
  })

  it('treats a window past its reset time as empty', () => {
    const decision = decide([
      account('claude:a@x.com', { session: 97, resetsAt: NOW - 1 }, { active: true }),
      account('claude:b@x.com', { session: 0 })
    ])
    expect(decision).toEqual({ kind: 'stay', reason: 'healthy' })
  })

  it('leaves an account the machine policy no longer allows', () => {
    const decision = decide(
      [
        account('claude:a@x.com', { session: 10 }, { active: true }),
        account('claude:b@x.com', { session: 30 })
      ],
      { policy: { allow: ['claude:b@x.com'] } }
    )
    expect(decision).toMatchObject({ kind: 'swap', reason: 'not-allowed' })
  })

  it('honours a per-account threshold over the global one', () => {
    const decision = decide([
      account('claude:a@x.com', { session: 75 }, { active: true, sessionThreshold: 70 }),
      account('claude:b@x.com', { session: 5 })
    ])
    expect(decision).toMatchObject({ kind: 'swap', reason: 'threshold' })
  })

  it('ranks by priority under the priority strategy', () => {
    const decision = decide(
      [
        account('claude:a@x.com', { session: 99 }, { active: true }),
        account('claude:b@x.com', { session: 1 }, { priority: 50 }),
        account('claude:c@x.com', { session: 60 }, { priority: 10 })
      ],
      { settings: { ...enabled, strategy: 'priority' } }
    )
    expect(decision.kind === 'swap' && decision.to.key).toBe('claude:c@x.com')
  })
})
