import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../../shared/ssh-types'
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

  it('leaves out hosts Colima, Lima and OrbStack import for their own VMs', () => {
    const machines = buildMachineSummaries({
      localName: 'This computer',
      localOs: 'darwin',
      sshTargets: [
        target('colima', 'colima', {
          source: 'ssh-config',
          host: '127.0.0.1',
          identityFile: '/Users/brian/.colima/_lima/_config/user'
        }),
        target('orb', 'orb', {
          source: 'ssh-config',
          proxyCommand: '/Users/brian/.orbstack/bin/orb-ssh-proxy'
        }),
        target('box', 'box', {
          source: 'ssh-config',
          identityFile: '/Users/brian/.ssh/id_ed25519'
        }),
        target('vm', 'my vm', {
          source: 'manual',
          identityFile: '/Users/brian/.lima/_config/user'
        })
      ],
      sshStates: new Map([['colima', { status: 'error', error: 'Connection refused' }]]),
      runtimeEnvironments: [],
      runtimeStatuses: new Map()
    })

    expect(machines.map((m) => m.id)).toEqual(['local', 'ssh:box', 'ssh:vm'])
  })
})
