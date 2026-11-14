import { describe, expect, it } from 'vitest'
import { liveSessionsOnMachine } from './live-session-machine-id'
import { countLiveSessionGroups, liveSessionsNeedingAttention } from './live-session-summary'
import type { LiveSessionMachine, LiveSessionStatus } from './live-session-types'

function session(id: string, status: LiveSessionStatus, alive = true) {
  return { id, status, alive, lastActivityAt: 1 }
}

describe('liveSessionsNeedingAttention', () => {
  it('lists running sessions that wait on the user or failed, permission prompts first', () => {
    const sessions = [
      session('busy', 'working'),
      session('failed', 'errored'),
      session('asks', 'waiting-input'),
      session('waits-on-subagents', 'waiting-subagent'),
      session('permission', 'needs-permission'),
      session('ended-with-error', 'errored', false),
      session('quiet', 'idle')
    ]
    expect(liveSessionsNeedingAttention(sessions).map((s) => s.id)).toEqual([
      'permission',
      'asks',
      'failed'
    ])
  })
})

describe('countLiveSessionGroups', () => {
  it('counts sessions waiting on their own subagents or tasks as working', () => {
    expect(
      countLiveSessionGroups([
        session('a', 'working'),
        session('b', 'waiting-subagent'),
        session('c', 'waiting-task'),
        session('d', 'needs-permission'),
        session('e', 'idle'),
        session('f', 'done')
      ])
    ).toEqual({ attention: 1, working: 3, idle: 1, finished: 1 })
  })
})

describe('liveSessionsOnMachine', () => {
  const machine = {
    id: 'machine:gpu',
    executionHostId: 'runtime:env-1',
    sshTargetId: 'ssh-gpu',
    runtimeEnvironmentId: 'env-1'
  }
  const on = (id: string, host: LiveSessionMachine) => ({ id, machine: host })

  it('finds a merged machine sessions over SSH, over its server, and from before unification', () => {
    const sessions = [
      on('unified', { hostId: 'ssh-gpu', label: 'gpu', kind: 'remote', machineId: 'machine:gpu' }),
      on('by-server', {
        hostId: 'env-1',
        label: 'gpu',
        kind: 'remote',
        executionHostId: 'runtime:env-1'
      }),
      on('legacy-ssh', { hostId: 'ssh-gpu', label: 'gpu', kind: 'remote' }),
      on('local', { hostId: 'local', label: 'mac', kind: 'local' }),
      on('other', { hostId: 'ssh-pi', label: 'pi', kind: 'remote', machineId: 'machine:pi' })
    ]
    expect(liveSessionsOnMachine(sessions, machine).map((s) => s.id)).toEqual([
      'unified',
      'by-server',
      'legacy-ssh'
    ])
  })
})
