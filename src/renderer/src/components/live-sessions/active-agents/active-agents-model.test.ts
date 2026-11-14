import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionLink } from '../links/live-session-links'
import { sampleLiveSession as session, SAMPLE_NOW as NOW } from '../live-session.test-fixture'
import { buildActiveAgents, type ActiveAgentsFilter } from './active-agents-model'

const HOUR = 3_600_000

const BUILD_BOX = { hostId: 'ssh-1', label: 'build-box', kind: 'remote' } as const
const NO_FILTER: ActiveAgentsFilter = { query: '', chips: new Set(), scope: null }
const NO_LINKS = new Map<string, LiveSessionLink>()

const ids = (sessions: readonly LiveSession[]) => sessions.map((s) => s.id)

describe('buildActiveAgents', () => {
  it('groups by machine, this one first, each sorted attention, working, idle', () => {
    const view = buildActiveAgents(
      [
        session('remote-idle', { machine: BUILD_BOX }),
        session('idle'),
        session('waiting-on-subagents', { status: 'waiting-subagent' }),
        session('working', { status: 'working' }),
        session('asks', { status: 'waiting-input' }),
        session('permission', { status: 'needs-permission' }),
        session('remote-errored', { machine: BUILD_BOX, status: 'errored' })
      ],
      NO_FILTER,
      NO_LINKS,
      NOW
    )
    expect(view.machines.map((m) => [m.label, ids(m.sessions)])).toEqual([
      ['brian-mbp', ['permission', 'asks', 'working', 'waiting-on-subagents', 'idle']],
      ['build-box', ['remote-errored', 'remote-idle']]
    ])
    expect(view.activeCount).toBe(7)
  })

  it('puts pinned sessions above the rest of their machine', () => {
    const view = buildActiveAgents(
      [session('permission', { status: 'needs-permission' }), session('pinned', { pinned: true })],
      NO_FILTER,
      NO_LINKS,
      NOW
    )
    expect(ids(view.machines[0].sessions)).toEqual(['pinned', 'permission'])
  })

  it('lists ended sessions of the last day under finished, newest first, and drops older ones', () => {
    const ended = { alive: false, status: 'done' } as const
    const view = buildActiveAgents(
      [
        session('running'),
        session('ended-yesterday', { ...ended, lastActivityAt: NOW - 30 * HOUR }),
        session('ended-this-morning', { ...ended, lastActivityAt: NOW - 5 * HOUR }),
        session('ended-just-now', { ...ended, lastActivityAt: NOW - 60_000 })
      ],
      NO_FILTER,
      NO_LINKS,
      NOW
    )
    expect(ids(view.machines[0].sessions)).toEqual(['running'])
    expect(ids(view.finished)).toEqual(['ended-just-now', 'ended-this-morning'])
  })

  it('filters by words across name, project, machine, agent and status', () => {
    const sessions = [
      session('fix login', { project: 'shop' }),
      session('deploy', { machine: BUILD_BOX, provider: 'codex', status: 'working' }),
      session('review', { status: 'needs-permission' })
    ]
    const find = (query: string) =>
      buildActiveAgents(sessions, { ...NO_FILTER, query }, NO_LINKS, NOW).machines.flatMap((m) =>
        ids(m.sessions)
      )
    expect(find('login')).toEqual(['fix login'])
    expect(find('shop')).toEqual(['fix login'])
    expect(find('build-box')).toEqual(['deploy'])
    expect(find('codex working')).toEqual(['deploy'])
    expect(find('needs permission')).toEqual(['review'])
  })

  it('narrows with the quick chips and a Projects scope', () => {
    const sessions = [
      session('local-working', { status: 'working' }),
      session('local-asks', { status: 'waiting-input' }),
      session('local-idle'),
      session('remote-working', { machine: BUILD_BOX, status: 'waiting-task' })
    ]
    const links = new Map<string, LiveSessionLink>([
      ['local-idle', { worktreeId: 'wt-1', repoId: 'repo-1', name: 'seal' }]
    ])
    const find = (filter: Partial<ActiveAgentsFilter>) =>
      buildActiveAgents(sessions, { ...NO_FILTER, ...filter }, links, NOW).machines.flatMap((m) =>
        ids(m.sessions)
      )
    expect(find({ chips: new Set(['attention']) })).toEqual(['local-asks'])
    expect(find({ chips: new Set(['working']) })).toEqual(['local-working', 'remote-working'])
    expect(find({ chips: new Set(['working', 'mine']) })).toEqual(['local-working'])
    expect(find({ scope: { kind: 'worktree', id: 'wt-1', label: 'seal' } })).toEqual(['local-idle'])
  })
})
