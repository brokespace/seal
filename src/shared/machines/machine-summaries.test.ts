import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../ssh-types'
import { buildMachineSummaries } from './machine-summaries'

function target(id: string, label: string, extra: Partial<SshTarget> = {}): SshTarget {
  return { id, label, host: `${id}.example`, port: 22, username: 'me', ...extra }
}

describe('buildMachineSummaries', () => {
  it('lists this computer, then SSH hosts, then runtimes not reachable over SSH', () => {
    const machines = buildMachineSummaries({
      localName: 'This computer',
      localOs: 'darwin',
      sshTargets: [
        target('b', 'zeta'),
        target('a', 'alpha', { port: 2222 }),
        target('hop', 'internal hop', { owner: { type: 'on-demand-runtime', runtimeId: 'r9' } })
      ],
      sshStates: new Map([
        ['a', { status: 'connected', error: null, remotePlatform: 'linux' }],
        ['b', { status: 'auth-failed', error: 'Permission denied' }]
      ]),
      runtimeEnvironments: [
        { id: 'r1', name: 'gpu box' },
        { id: 'r2', name: 'alpha runtime', sshAccess: { sshTargetId: 'a' } }
      ],
      runtimeStatuses: new Map()
    })

    expect(machines.map((m) => [m.id, m.status])).toEqual([
      ['local', 'online'],
      ['ssh:a', 'online'],
      ['ssh:b', 'error'],
      ['runtime:r1', 'offline']
    ])
    expect(machines[1]).toMatchObject({
      address: 'me@a.example:2222',
      os: 'linux',
      hasRuntime: true,
      runtimeEnvironmentId: 'r2'
    })
    expect(machines[2]?.statusDetail).toBe('Permission denied')
  })
})
