import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from './seal-account-candidates'
import { pickLaunchAccount, type SealLaunchPickInput } from './seal-launch-account-pick'
import { defaultSealAutoSwapSettings } from './seal-accounts-config'

const NOW = 1_800_000_000_000

function account(key: string, session: number | null, extra: Partial<SealAccountCandidate> = {}) {
  const candidate: SealAccountCandidate = {
    key,
    provider: 'codex',
    kind: 'oauth',
    localId: `id-${key}`,
    email: key.replace('codex:', ''),
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
            provider: 'codex',
            session: {
              usedPercent: session,
              windowMinutes: 300,
              resetsAt: null,
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
  return candidate
}

const work = account('codex:work@corp.com', 20, { label: 'work' })
const personal = account('codex:me@home.com', 40, { label: 'personal', active: true })

function pick(overrides: Partial<SealLaunchPickInput>) {
  return pickLaunchAccount({
    candidates: [work, personal],
    policy: {
      allow: null,
      defaultKey: null,
      defaultSource: null,
      projectRule: null,
      machineRule: null
    },
    override: null,
    settings: defaultSealAutoSwapSettings(),
    quarantine: {},
    now: NOW,
    ...overrides
  })
}

describe('pickLaunchAccount', () => {
  it('keeps the host selection when nothing constrains the launch', () => {
    expect(pick({})).toEqual({ kind: 'unchanged', warnings: [] })
  })

  it('runs a per-session override by alias, warning when policy forbids it', () => {
    const result = pick({
      override: { ref: 'WORK', source: 'env' },
      policy: {
        allow: ['codex:me@home.com'],
        defaultKey: null,
        defaultSource: null,
        projectRule: null,
        machineRule: null
      }
    })
    expect(result).toEqual({
      kind: 'account',
      candidate: work,
      reason: 'env',
      warnings: ["work is outside this project's allowed accounts."]
    })
  })

  it('uses the project default ahead of the selected account', () => {
    const result = pick({
      policy: {
        allow: null,
        defaultKey: 'codex:work@corp.com',
        defaultSource: 'project',
        projectRule: null,
        machineRule: null
      }
    })
    expect(result).toMatchObject({ kind: 'account', reason: 'project-default', candidate: work })
  })

  it('falls back to the selected account when the default is near its limit', () => {
    const busyWork = account('codex:work@corp.com', 97, { label: 'work' })
    const result = pick({
      candidates: [busyWork, personal],
      policy: {
        allow: null,
        defaultKey: 'codex:work@corp.com',
        defaultSource: 'machine',
        projectRule: null,
        machineRule: null
      }
    })
    expect(result).toEqual({
      kind: 'account',
      candidate: personal,
      reason: 'selected',
      warnings: ['Default account work is unavailable or near its limit.']
    })
  })

  it('auto-picks the account with most room when auto-swap is on and the selection is full', () => {
    const fullPersonal = account('codex:me@home.com', 99, { label: 'personal', active: true })
    const result = pick({
      candidates: [work, fullPersonal],
      settings: { ...defaultSealAutoSwapSettings(), enabled: true }
    })
    expect(result).toMatchObject({ kind: 'account', reason: 'auto', candidate: work })
  })

  it('still runs an allowed account when every allowed one is over its limit', () => {
    const fullWork = account('codex:work@corp.com', 98, { label: 'work' })
    const fullPersonal = account('codex:me@home.com', 99, { label: 'personal', active: true })
    const result = pick({
      candidates: [fullWork, fullPersonal],
      policy: {
        allow: ['codex:work@corp.com'],
        defaultKey: null,
        defaultSource: null,
        projectRule: null,
        machineRule: null
      }
    })
    expect(result).toEqual({
      kind: 'account',
      candidate: fullWork,
      reason: 'over-limit-fallback',
      warnings: ['Every allowed account is near its usage limit.']
    })
  })

  it('falls back to policy when the override names an unknown account', () => {
    const result = pick({ override: { ref: 'nobody', source: 'workspace-pin' } })
    expect(result).toEqual({
      kind: 'unchanged',
      warnings: ['No account matches "nobody"; using the policy instead.']
    })
  })
})
