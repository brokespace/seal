import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from './seal-account-candidates'
import { defaultSealAccountsConfig } from './seal-accounts-config'
import type { SealAccountsStatus } from './seal-accounts-status'
import { buildSealFleetOverview } from './seal-fleet-overview'

function login(key: string): SealAccountCandidate {
  return {
    provider: 'claude',
    kind: 'oauth',
    localId: key,
    key,
    email: null,
    label: key,
    plan: null,
    credential: 'login',
    health: { state: 'ok' },
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    usage: null,
    sessionThreshold: null,
    weeklyThreshold: null
  }
}

function status(
  claude: SealAccountCandidate[],
  fleetCopies: Record<string, string[]> = {}
): SealAccountsStatus {
  return {
    machineKey: 'local',
    config: defaultSealAccountsConfig(),
    providers: {
      claude: { candidates: claude, machineAllow: null, machineDefault: null, lastDecision: null },
      codex: { candidates: [], machineAllow: null, machineDefault: null, lastDecision: null }
    },
    quarantine: {},
    swapLog: [],
    sessions: [],
    workspacePins: {},
    fleetCopies,
    secretStorage: { available: true, protectionGap: null }
  }
}

describe('buildSealFleetOverview', () => {
  it('lists a machine without a Seal server on the logins this computer pushed to it', () => {
    const overview = buildSealFleetOverview([
      {
        id: 'local',
        label: 'This computer',
        home: true,
        status: status([login('claude:work@acme.dev'), login('claude:me@example.com')], {
          'machine:gpu': ['claude:work@acme.dev']
        }),
        error: null
      },
      {
        id: 'machine:gpu',
        label: 'gpu-box',
        home: false,
        status: null,
        error: null,
        loginsOnly: { connected: true }
      },
      {
        id: 'machine:nas',
        label: 'nas',
        home: false,
        status: null,
        error: null,
        loginsOnly: { connected: false }
      }
    ])

    expect(
      overview.groups.claude.map((account) => [
        account.key,
        account.machines.map((machine) => [machine.machineLabel, machine.reported])
      ])
    ).toEqual([
      ['claude:me@example.com', [['This computer', true]]],
      [
        'claude:work@acme.dev',
        [
          ['This computer', true],
          ['gpu-box', false]
        ]
      ]
    ])
    expect(
      overview.machines.map((machine) => [machine.label, machine.runsSeal, machine.reachable])
    ).toEqual([
      ['This computer', true, true],
      ['gpu-box', false, true],
      ['nas', false, false]
    ])
  })
})
