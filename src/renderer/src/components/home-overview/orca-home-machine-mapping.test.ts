import { describe, expect, it } from 'vitest'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { orcaLocalMachine, orcaSshMachines } from './orca-home-machine-mapping'

function sshState(
  targetId: string,
  status: SshConnectionState['status'],
  error: string | null = null
): SshConnectionState {
  return { targetId, status, error, reconnectAttempt: 0 }
}

describe('orcaSshMachines', () => {
  it('maps connection states and hides runtime-owned recipe VMs', () => {
    const machines = orcaSshMachines(
      new Map([
        ['gpu', 'gpu-box'],
        ['runtime-ssh-123', 'recipe vm'],
        ['build', 'build-box']
      ]),
      new Map([
        ['gpu', sshState('gpu', 'auth-failed', 'Permission denied')],
        ['build', sshState('build', 'connected')]
      ])
    )
    expect(machines).toEqual([
      { id: 'ssh:build', label: 'build-box', kind: 'ssh', status: 'online' },
      { id: 'ssh:gpu', label: 'gpu-box', kind: 'ssh', status: 'error', error: 'Permission denied' }
    ])
  })
})

describe('orcaLocalMachine', () => {
  it('normalizes load by core count and omits it where load average is unsupported', () => {
    const host = {
      totalMemory: 100,
      freeMemory: 40,
      availableMemory: 40,
      availableMemorySource: 'free-memory' as const,
      usedMemory: 60,
      memoryUsagePercent: 60,
      cpuCoreCount: 8,
      loadAverage1m: 2
    }
    expect(
      orcaLocalMachine({ label: 'Local Mac', host, loadAverageSupported: true })
    ).toMatchObject({
      load: 0.25,
      memoryUsedPercent: 60
    })
    expect(
      orcaLocalMachine({ label: 'Local Windows', host, loadAverageSupported: false }).load
    ).toBeUndefined()
  })
})
