import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from './seal-account-candidates'
import { defaultSealAutoSwapSettings, type SealAutoSwapSettings } from './seal-accounts-config'
import {
  decideSessionSwap,
  isRateLimitStop,
  type SealSessionCapability,
  type SealSessionSwapInput
} from './seal-session-swap-decision'

const NOW = 1_800_000_000_000

function account(
  key: string,
  session: number | null,
  extra: Partial<SealAccountCandidate> = {}
): SealAccountCandidate {
  return {
    key,
    provider: 'claude',
    kind: 'oauth',
    localId: key,
    email: null,
    label: key,
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    limits:
      session === null
        ? null
        : {
            provider: 'claude',
            session: {
              usedPercent: session,
              windowMinutes: 300,
              resetsAt: NOW + 3_600_000,
              resetDescription: null
            },
            weekly: null,
            updatedAt: NOW,
            error: null,
            status: 'ok'
          },
    sessionThreshold: null,
    weeklyThreshold: null,
    ...extra
  }
}

const enabled: SealAutoSwapSettings = { ...defaultSealAutoSwapSettings(), enabled: true }
const claudeHome: SealSessionCapability = {
  provider: 'claude',
  isolatedHome: true,
  resumable: true
}

function decide(
  candidates: SealAccountCandidate[],
  overrides: {
    session?: Partial<SealSessionSwapInput['session']>
    capability?: SealSessionCapability
    settings?: SealAutoSwapSettings
  } = {}
) {
  return decideSessionSwap({
    session: {
      accountKey: 'claude:a@x.io',
      liveSwap: undefined,
      lastSwapAt: null,
      rateLimited: false,
      ...overrides.session
    },
    capability: overrides.capability ?? claudeHome,
    settings: overrides.settings ?? enabled,
    candidates,
    policy: { allow: null },
    quarantine: {},
    now: NOW
  })
}

describe('decideSessionSwap', () => {
  it('swaps a Claude session over its threshold live, judged by its own account', () => {
    // The host selection (b, active) is irrelevant: the session runs on a.
    const decision = decide([
      account('claude:a@x.io', 95),
      account('claude:b@x.io', 10, { active: true })
    ])
    expect(decision).toMatchObject({
      kind: 'swap',
      from: 'claude:a@x.io',
      to: { key: 'claude:b@x.io' },
      reason: 'threshold',
      delivery: 'live'
    })
  })

  it('moves a session at 91% of its 5h window, before the limit, with no limit message', () => {
    // Defaults: claude-swap's 90% line; the host-wide auto-swap toggle stays off.
    const decision = decide([account('claude:a@x.io', 91), account('claude:b@x.io', 30)], {
      settings: defaultSealAutoSwapSettings()
    })
    expect(decision).toMatchObject({
      kind: 'swap',
      to: { key: 'claude:b@x.io' },
      reason: 'threshold',
      delivery: 'live'
    })
  })

  it('keeps a session at 89% where it is', () => {
    const decision = decide([account('claude:a@x.io', 89), account('claude:b@x.io', 0)], {
      settings: defaultSealAutoSwapSettings()
    })
    expect(decision).toEqual({ kind: 'stay', reason: 'healthy' })
  })

  it('moves a session whose 7-day window crosses its line while the 5h window has room', () => {
    const weeklyFull = account('claude:a@x.io', 20)
    const decision = decide(
      [
        {
          ...weeklyFull,
          limits: weeklyFull.limits && {
            ...weeklyFull.limits,
            weekly: {
              usedPercent: 92,
              windowMinutes: 10_080,
              resetsAt: NOW + 86_400_000,
              resetDescription: null
            }
          }
        },
        account('claude:b@x.io', 10)
      ],
      { settings: defaultSealAutoSwapSettings() }
    )
    expect(decision).toMatchObject({ kind: 'swap', to: { key: 'claude:b@x.io' } })
  })

  it('never moves onto an account that is close to its own line', () => {
    // 95% -> 88% gains 7 points of headroom, under claude-swap's 10-point margin.
    const decision = decide([account('claude:a@x.io', 95), account('claude:b@x.io', 88)], {
      settings: defaultSealAutoSwapSettings()
    })
    expect(decision).toEqual({ kind: 'stay', reason: 'no-candidate' })
  })

  it('falls back to a printed limit stop only when usage shows nothing, and only if allowed', () => {
    const accounts = [account('claude:a@x.io', 40), account('claude:b@x.io', 10)]
    expect(decide(accounts, { session: { rateLimited: true } })).toMatchObject({
      kind: 'swap',
      reason: 'rate-limit',
      delivery: 'live'
    })
    expect(
      decide(accounts, {
        session: { rateLimited: true },
        settings: { ...enabled, rateLimitFallback: false }
      })
    ).toEqual({ kind: 'stay', reason: 'healthy' })
  })

  it('resumes a Codex session near its limit, since Codex only reloads auth after a 401', () => {
    const decision = decide(
      [account('codex:a@x.io', 95, { provider: 'codex' }), account('codex:b@x.io', 5)],
      {
        session: { accountKey: 'codex:a@x.io' },
        capability: { provider: 'codex', isolatedHome: true, resumable: true }
      }
    )
    expect(decision).toMatchObject({ kind: 'swap', delivery: 'resume' })
  })

  it('swaps a Codex session with a dead login live and quarantines that login', () => {
    const decision = decide(
      [account('codex:a@x.io', 10, { authFailure: true }), account('codex:b@x.io', 5)],
      {
        session: { accountKey: 'codex:a@x.io' },
        capability: { provider: 'codex', isolatedHome: true, resumable: false }
      }
    )
    expect(decision).toMatchObject({
      kind: 'swap',
      reason: 'auth-failure',
      delivery: 'live',
      quarantine: ['codex:a@x.io']
    })
  })

  it('leaves a session it can neither rewrite nor resume', () => {
    const decision = decide([account('claude:a@x.io', 95), account('claude:b@x.io', 5)], {
      capability: { provider: 'claude', isolatedHome: false, resumable: false }
    })
    expect(decision).toEqual({ kind: 'stay', reason: 'not-swappable' })
  })

  it('honors a per-session off over the global default, and on over a global off', () => {
    const accounts = [account('claude:a@x.io', 95), account('claude:b@x.io', 5)]
    expect(decide(accounts, { session: { liveSwap: 'off' } })).toEqual({
      kind: 'stay',
      reason: 'disabled'
    })
    expect(
      decide(accounts, {
        session: { liveSwap: 'on' },
        settings: { ...enabled, liveSessionSwap: false }
      })
    ).toMatchObject({ kind: 'swap' })
    expect(decide(accounts, { settings: { ...enabled, liveSessionSwap: false } })).toEqual({
      kind: 'stay',
      reason: 'disabled'
    })
  })

  it('waits out the per-session cooldown after its own last swap', () => {
    const decision = decide([account('claude:a@x.io', 95), account('claude:b@x.io', 5)], {
      session: { lastSwapAt: NOW - 60_000 }
    })
    expect(decision).toEqual({ kind: 'stay', reason: 'cooldown' })
  })
})

describe('isRateLimitStop', () => {
  it('recognizes Claude and Codex limit stops and ignores ordinary text', () => {
    expect(isRateLimitStop('5-hour limit reached ∙ resets 3pm')).toBe(true)
    expect(isRateLimitStop("You've hit your usage limit. Upgrade to Pro")).toBe(true)
    expect(isRateLimitStop('API Error: 429 {"type":"rate_limit_error"}')).toBe(true)
    expect(isRateLimitStop('I added a rate limiter to the API handler.')).toBe(false)
    expect(isRateLimitStop(null)).toBe(false)
  })
})
