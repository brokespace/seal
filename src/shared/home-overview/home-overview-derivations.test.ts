import { describe, expect, it } from 'vitest'
import { accountNextReset, homeElapsed, mergeSessionMachines } from './home-overview-derivations'
import type { HomeAccount } from './home-overview-types'

function account(overrides: Partial<HomeAccount> = {}): HomeAccount {
  return {
    id: 'claude:active',
    provider: 'claude',
    providerLabel: 'Claude',
    label: 'me@example.com',
    active: true,
    status: 'ok',
    windows: [],
    ...overrides
  }
}

describe('accountNextReset', () => {
  it('reports the reset of the window that is near its limit', () => {
    const near = account({
      windows: [
        { kind: 'session', usedPercent: 20, resetsAt: 5_000 },
        { kind: 'weekly', usedPercent: 85, resetsAt: 50_000 }
      ]
    })
    expect(accountNextReset(near, 1_000)).toBe(50_000)
  })

  it('reports the earliest future reset otherwise', () => {
    const relaxed = account({
      windows: [
        { kind: 'session', usedPercent: 20, resetsAt: 500 },
        { kind: 'weekly', usedPercent: 30, resetsAt: 50_000 },
        { kind: 'monthly', usedPercent: 10, resetsAt: 9_000 }
      ]
    })
    expect(accountNextReset(relaxed, 1_000)).toBe(9_000)
  })
})

describe('mergeSessionMachines', () => {
  it('adds hosts that only appear on sessions', () => {
    const merged = mergeSessionMachines(
      [{ id: 'local', label: 'Local Mac', kind: 'local', status: 'online' }],
      [
        {
          machine: {
            hostId: 'env',
            label: 'cloud',
            kind: 'remote',
            connection: 'server',
            executionHostId: 'runtime:env'
          }
        }
      ]
    )
    expect(merged[1]).toEqual({
      id: 'runtime:env',
      label: 'cloud',
      kind: 'runtime',
      status: 'online'
    })
  })
})

describe('homeElapsed', () => {
  it('picks the largest whole unit', () => {
    expect(homeElapsed(0 + 1, 1 + 45_000)).toEqual({ value: 45, unit: 'second' })
    expect(homeElapsed(1, 1 + 3 * 3_600_000 + 10)).toEqual({ value: 3, unit: 'hour' })
    expect(homeElapsed(1, 1 + 72 * 3_600_000)).toEqual({ value: 3, unit: 'day' })
  })

  it('treats a zero start as unknown', () => {
    expect(homeElapsed(0, 10_000)).toBeNull()
  })
})
