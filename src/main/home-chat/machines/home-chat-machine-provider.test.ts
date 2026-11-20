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
  {
    id: 'machine:t1',
    label: 'gpu-box',
    kind: 'remote',
    aliases: ['ssh:t1'],
    connected: true,
    status: 'online'
  },
  {
    id: 'machine:t2',
    label: 'gpu-box-2',
    kind: 'remote',
    aliases: ['ssh:t2'],
    connected: false,
    status: 'offline'
  },
  { id: 'machine:env-3', label: 'build server', kind: 'remote', connected: true, status: 'online' }
]

describe('resolveHomeChatMachineId', () => {
  it('prefers an exact label over a partial match', () => {
    expect(resolveHomeChatMachineId('GPU-box', machines)).toBe('machine:t1')
  })

  it('still resolves the ssh: ids older notes and chats used, and unique partial labels', () => {
    expect(resolveHomeChatMachineId('ssh:t2', machines)).toBe('machine:t2')
    expect(resolveHomeChatMachineId('t2', machines)).toBe('machine:t2')
    expect(resolveHomeChatMachineId('build', machines)).toBe('machine:env-3')
  })

  it('maps empty and local spellings to this computer', () => {
    expect(resolveHomeChatMachineId('localhost', machines)).toBe('local')
  })

  it('finds a machine by its host name when its label is something else', () => {
    const named: HomeChatMachineInfo[] = [
      ...machines,
      {
        id: 'machine:t9',
        label: 'Training rig',
        kind: 'remote',
        address: 'brian@kessel-ml.tail1234.ts.net:22',
        connected: false,
        status: 'offline'
      },
      {
        id: 'machine:env-7',
        label: 'studio',
        kind: 'remote',
        aliases: ['runtime:env-7'],
        connected: true,
        status: 'online'
      }
    ]
    expect(resolveHomeChatMachineId('Kessel-ML', named)).toBe('machine:t9')
    expect(resolveHomeChatMachineId('runtime:env-7', named)).toBe('machine:env-7')
  })

  it('names the candidates when a name is ambiguous or unknown', () => {
    expect(() => resolveHomeChatMachineId('gpu', machines)).toThrow(
      '"gpu" matches several machines: gpu-box (machine:t1, online), gpu-box-2 (machine:t2, offline). Use one of these ids.'
    )
    expect(() => resolveHomeChatMachineId('nas', machines)).toThrow(
      'No machine matches "nas". Machines Seal knows: laptop (this computer) (local, online), gpu-box (machine:t1, online), gpu-box-2 (machine:t2, offline), build server (machine:env-3, online).'
    )
  })
})
