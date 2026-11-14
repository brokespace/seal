import { describe, expect, it } from 'vitest'
import { homeElapsed, mergeSessionMachines } from './home-overview-derivations'

describe('mergeSessionMachines', () => {
  it('adds hosts that only appear on sessions', () => {
    const merged = mergeSessionMachines(
      [{ id: 'local', label: 'Local Mac', kind: 'local', status: 'online' }],
      [
        {
          machine: {
            hostId: 'env',
            label: 'cloud',
            kind: 'remote',
            connection: 'server',
            executionHostId: 'runtime:env'
          }
        }
      ]
    )
    expect(merged[1]).toEqual({
      id: 'runtime:env',
      label: 'cloud',
      kind: 'runtime',
      status: 'online'
    })
  })
})

describe('homeElapsed', () => {
  it('picks the largest whole unit', () => {
    expect(homeElapsed(0 + 1, 1 + 45_000)).toEqual({ value: 45, unit: 'second' })
    expect(homeElapsed(1, 1 + 3 * 3_600_000 + 10)).toEqual({ value: 3, unit: 'hour' })
    expect(homeElapsed(1, 1 + 72 * 3_600_000)).toEqual({ value: 3, unit: 'day' })
  })

  it('treats a zero start as unknown', () => {
    expect(homeElapsed(0, 10_000)).toBeNull()
  })
})
