import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealSessionAssignment } from '../../shared/seal-accounts/seal-accounts-status'
import { createSealLiveUsageOwnerResolver } from './seal-live-usage-owner'

const START = 1_800_000_000_000

function account(
  email: string,
  overrides: Partial<SealAccountCandidate> = {}
): SealAccountCandidate {
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
    weeklyThreshold: null,
    ...overrides
  }
}

function session(overrides: Partial<SealSessionAssignment>): SealSessionAssignment {
  return {
    id: 'session-1',
    at: START,
    provider: 'claude',
    accountKey: 'claude:side@example.com',
    accountLabel: 'side',
    reason: 'host-selection',
    worktreeId: null,
    tabId: null,
    projectLabel: null,
    machineKey: 'local',
    warnings: [],
    profileHome: '/data/seal-sessions/claude/session-1/home',
    ...overrides
  }
}

function setup(sessions: SealSessionAssignment[] = []) {
  const clock = { now: START }
  const state = { sessions }
  const resolve = createSealLiveUsageOwnerResolver({
    now: () => clock.now,
    baseCandidates: () => [
      account('work@acme.dev', { active: true }),
      account('side@example.com'),
      account('me@home.dev', { kind: 'system', localId: null, systemLogin: true })
    ],
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only `sessions`.
    store: { getState: () => state } as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the Claude router's folders.
    services: {
      claudeRuntimeAuth: {
        router: {
          userConfigDir: () => undefined,
          accountHome: (id: string) => `/data/claude-profiles/${id}/home`
        }
      }
    } as never
  })
  const report = (configDir: string | null, usedPercentage = 40) =>
    resolve({ configDir, fiveHour: { used_percentage: usedPercentage }, sevenDay: null })
  return { clock, state, report }
}

describe('whose usage a running Claude session reports', () => {
  it('names the account by the folder the session runs in', () => {
    const { report } = setup([session({})])

    expect(report('/data/seal-sessions/claude/session-1/home')).toEqual({
      kind: 'account',
      accountId: 'side@example.com'
    })
    expect(report('/data/claude-profiles/side@example.com/home/')).toEqual({
      kind: 'account',
      accountId: 'side@example.com'
    })
    expect(report('/data/claude-profiles/work@acme.dev/home')).toEqual({ kind: 'selected' })
    expect(report(null)).toEqual({ kind: 'system', identity: 'claude:me@home.dev' })
    expect(report('/some/other/tool')).toBeNull()
  })

  it("holds a moved session's report until it shows the new login's figures", () => {
    const { clock, state, report } = setup([session({})])
    const home = '/data/seal-sessions/claude/session-1/home'
    expect(report(home, 97)).toEqual({ kind: 'account', accountId: 'side@example.com' })

    state.sessions = [session({ accountKey: 'claude:work@acme.dev', lastSwapAt: START + 1_000 })]
    clock.now = START + 5_000
    expect(report(home, 97)).toBeNull()
    // Idle since the move: the statusline still repeats the outgoing login's 97%.
    clock.now = START + 10 * 60_000
    expect(report(home, 97)).toBeNull()

    expect(report(home, 12)).toEqual({ kind: 'selected' })
  })
})
