import { describe, expect, it } from 'vitest'
import { resolveHomeChatMachineId } from './home-chat-machine-provider'
import type { HomeChatMachineInfo } from './home-chat-machine-types'

const machines: HomeChatMachineInfo[] = [
  {
    id: 'local',
    label: 'laptop (this computer)',
    kind: 'local',
    connected: true,
    status: 'online'
  },
  { id: 'ssh:t1', label: 'gpu-box', kind: 'ssh', connected: true, status: 'online' },
  { id: 'ssh:t2', label: 'gpu-box-2', kind: 'ssh', connected: false, status: 'offline' },
  { id: 'ssh:t3', label: 'build server', kind: 'ssh', connected: true, status: 'online' }
]

describe('resolveHomeChatMachineId', () => {
  it('prefers an exact label over a partial match', () => {
    expect(resolveHomeChatMachineId('GPU-box', machines)).toBe('ssh:t1')
  })

  it('accepts bare SSH target ids and unique partial labels', () => {
    expect(resolveHomeChatMachineId('t2', machines)).toBe('ssh:t2')
    expect(resolveHomeChatMachineId('build', machines)).toBe('ssh:t3')
  })

  it('maps empty and local spellings to this computer', () => {
    expect(resolveHomeChatMachineId('localhost', machines)).toBe('local')
  })

  it('finds a machine by its host name when its label is something else', () => {
    const named: HomeChatMachineInfo[] = [
      ...machines,
      {
        id: 'ssh:t9',
        label: 'Training rig',
        kind: 'ssh',
        address: 'brian@kessel-ml.tail1234.ts.net:22',
        connected: false,
        status: 'offline'
      },
      { id: 'runtime:env-7', label: 'studio', kind: 'runtime', connected: true, status: 'online' }
    ]
    expect(resolveHomeChatMachineId('Kessel-ML', named)).toBe('ssh:t9')
    expect(resolveHomeChatMachineId('env-7', named)).toBe('runtime:env-7')
  })

  it('names the candidates when a name is ambiguous or unknown', () => {
    expect(() => resolveHomeChatMachineId('gpu', machines)).toThrow(
      '"gpu" matches several machines: gpu-box (ssh:t1, online), gpu-box-2 (ssh:t2, offline). Use one of these ids.'
    )
    expect(() => resolveHomeChatMachineId('nas', machines)).toThrow(
      'No machine matches "nas". Machines Seal knows: laptop (this computer) (local, online), gpu-box (ssh:t1, online), gpu-box-2 (ssh:t2, offline), build server (ssh:t3, online).'
    )
  })
})
