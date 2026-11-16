import { describe, expect, it } from 'vitest'
import type { MachineRecord, MachineServerInstall, MachineStore } from './machine-record'
import { failInterruptedServerInstalls } from './machine-server-install'

function machine(id: string, serverInstall: MachineServerInstall): MachineRecord {
  return {
    id,
    name: id,
    connection: 'ssh',
    sshTargetId: `ssh-${id}`,
    environmentId: null,
    hostnames: [],
    machineIds: [],
    serverInstall,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('failInterruptedServerInstalls', () => {
  it('ends an install the app was closed in, and keeps one that waits for the machine', () => {
    const waiting = machine('waiting', {
      policy: 'auto',
      state: 'pending',
      reason: '2 terminals are still running on this machine',
      attemptedAt: 5
    })
    const installed = machine('installed', {
      policy: 'auto',
      state: 'installed',
      manager: 'systemd-user'
    })
    const store: MachineStore = {
      version: 1,
      machines: [
        machine('cut-short', { policy: 'auto', state: 'pending', manager: 'pm2' }),
        waiting,
        installed
      ],
      separations: []
    }

    expect(failInterruptedServerInstalls(store, 1000).machines).toEqual([
      {
        ...machine('cut-short', {
          policy: 'auto',
          state: 'failed',
          manager: 'pm2',
          reason: 'Seal was closed before the install finished',
          attemptedAt: 1000
        }),
        updatedAt: 1000
      },
      waiting,
      installed
    ])
  })
})
