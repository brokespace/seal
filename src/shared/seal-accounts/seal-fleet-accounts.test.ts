import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate, SealAccountUsage } from './seal-account-candidates'
import { mergeFleetAccounts } from './seal-fleet-accounts'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function usage(session: number | null, updatedAt: number): SealAccountUsage {
  return {
    session: session === null ? null : { usedPercent: session, resetsAt: null },
    weekly: null,
    models: [],
    planType: null,
    updatedAt,
    error: session === null ? 'read failed' : null
  }
}

function candidate(key: string, accountUsage: SealAccountUsage | null): SealAccountCandidate {
  return {
    key,
    provider: 'claude',
    kind: 'oauth',
    localId: 'x',
    email: null,
    label: key,
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    usage: accountUsage,
    sessionThreshold: null,
    weeklyThreshold: null
  }
}

describe('mergeFleetAccounts', () => {
  it('folds the same login on two machines into one row with the newest reading', () => {
    const [row] = mergeFleetAccounts(
      [
        {
          machineKey: 'local',
          machineLabel: 'Mac',
          candidate: candidate('claude:a@x.com', usage(30, NOW - HOUR))
        },
        {
          machineKey: 'runtime:box',
          machineLabel: 'box',
          candidate: candidate('claude:a@x.com#org', usage(55, NOW - 60_000))
        }
      ],
      NOW
    )
    expect(row.usage?.session?.usedPercent).toBe(55)
    expect(row.usageMachineLabel).toBe('box')
    expect(row.machines.map((machine) => machine.machineKey)).toEqual(['local', 'runtime:box'])
  })

  it('keeps real figures under a day old over a newer failed read', () => {
    const [row] = mergeFleetAccounts(
      [
        {
          machineKey: 'local',
          machineLabel: 'Mac',
          candidate: candidate('claude:a@x.com', usage(30, NOW - HOUR))
        },
        {
          machineKey: 'runtime:box',
          machineLabel: 'box',
          candidate: candidate('claude:a@x.com', usage(null, NOW))
        }
      ],
      NOW
    )
    expect(row.usage?.session?.usedPercent).toBe(30)
  })
})
