import { describe, expect, it } from 'vitest'
import { resolveHomeChatMachineId } from './home-chat-machine-provider'
import type { HomeChatMachineInfo } from './home-chat-machine-types'

const machines: HomeChatMachineInfo[] = [
  { id: 'local', label: 'laptop (this computer)', kind: 'local', connected: true },
  { id: 'machine:t1', label: 'gpu-box', kind: 'remote', aliases: ['ssh:t1'], connected: true },
  { id: 'machine:t2', label: 'gpu-box-2', kind: 'remote', aliases: ['ssh:t2'], connected: false },
  { id: 'machine:env-3', label: 'build server', kind: 'remote', connected: true }
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

  it('rejects an ambiguous partial label', () => {
    expect(() => resolveHomeChatMachineId('gpu', machines)).toThrow(
      '"gpu" matches several machines: machine:t1, machine:t2'
    )
  })
})
