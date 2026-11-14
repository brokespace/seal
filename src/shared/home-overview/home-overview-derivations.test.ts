import { describe, expect, it } from 'vitest'
import {
  buildHomeAttentionItems,
  groupHomeSessions,
  homeElapsed,
  mergeSessionMachines
} from './home-overview-derivations'
import type { HomeSession } from './home-overview-types'

function session(id: string, overrides: Partial<HomeSession> = {}): HomeSession {
  return {
    id,
    state: 'working',
    unseen: false,
    machineId: 'local',
    machineLabel: 'Local Mac',
    projectId: 'p1',
    projectName: 'seal',
    workspaceName: 'main',
    title: id,
    agentType: 'claude',
    agentLabel: 'Claude',
    startedAt: 1_000,
    stateChangedAt: 1_000,
    finishedAt: null,
    target: {
      kind: 'orca-pane',
      reveal: { repoId: 'p1', worktreeId: 'w1', tabId: 't1', leafId: null }
    },
    ...overrides
  }
}

describe('groupHomeSessions', () => {
  it('puts the local machine first and orders sessions by urgency within a project', () => {
    const groups = groupHomeSessions([
      session('remote', { machineId: 'ssh:a', machineLabel: 'a' }),
      session('done', { state: 'done', stateChangedAt: 9_000 }),
      session('asking', { state: 'permission' }),
      session('other-project', { projectId: 'p2', projectName: 'orca' })
    ])
    expect(groups.map((g) => g.machineId)).toEqual(['local', 'ssh:a'])
    expect(groups[0].projects.map((p) => p.projectId)).toEqual(['p1', 'p2'])
    expect(groups[0].projects[0].sessions.map((s) => s.id)).toEqual(['asking', 'done'])
    expect(groups[0].sessionCount).toBe(3)
  })
})

describe('buildHomeAttentionItems', () => {
  it('lists only sessions blocked on the user or newly errored, each with its reason', () => {
    const items = buildHomeAttentionItems([
      session('working'),
      session('waiting', { state: 'waiting', askSummary: 'Pick a branch name' }),
      session('seen-error', { state: 'errored', unseen: false }),
      session('new-error', { state: 'errored', unseen: true, errorSummary: 'API Error: 500' })
    ])
    expect(items.map((item) => [item.id, item.reason])).toEqual([
      ['session:waiting', 'Pick a branch name'],
      ['session:new-error', 'API Error: 500']
    ])
  })
})

describe('mergeSessionMachines', () => {
  it('adds hosts that only appear on sessions', () => {
    const merged = mergeSessionMachines(
      [{ id: 'local', label: 'Local Mac', kind: 'local', status: 'online' }],
      [session('a', { machineId: 'runtime:env', machineLabel: 'cloud' })]
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
