import { describe, expect, it } from 'vitest'
import { resolveHomeChatMachineId } from './home-chat-machine-provider'
import type { HomeChatMachineInfo } from './home-chat-machine-types'

const machines: HomeChatMachineInfo[] = [
  { id: 'local', label: 'laptop (this computer)', kind: 'local', connected: true },
  { id: 'ssh:t1', label: 'gpu-box', kind: 'ssh', connected: true },
  { id: 'ssh:t2', label: 'gpu-box-2', kind: 'ssh', connected: false },
  { id: 'ssh:t3', label: 'build server', kind: 'ssh', connected: true }
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

  it('rejects an ambiguous partial label', () => {
    expect(() => resolveHomeChatMachineId('gpu', machines)).toThrow(
      '"gpu" matches several machines: ssh:t1, ssh:t2'
    )
  })
})
