import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  buildActiveAgents,
  linkLiveSessions,
  liveSessionBadges,
  type ActiveAgentsFilter,
  type LiveSessionLink
} from './active-agents-model'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

function session(id: string, patch: Partial<LiveSession> = {}): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
    origin: 'external',
    cwd: '/code/seal',
    project: 'seal',
    title: id,
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: NOW - 60_000,
    startedAt: NOW - HOUR,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}

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

describe('linkLiveSessions', () => {
  const worktrees = [
    { id: 'wt-main', repoId: 'repo-1', path: '/code/seal', name: 'seal', hostId: 'local' },
    { id: 'wt-feat', repoId: 'repo-1', path: '/code/seal/.wt/feat', name: 'feat', hostId: 'local' },
    { id: 'wt-remote', repoId: 'repo-2', path: '/code/seal', name: 'seal@box', hostId: 'ssh-1' }
  ]
  const hostOf = (s: LiveSession) => s.machine.hostId

  it('links a session to the deepest workspace holding its cwd on its own machine', () => {
    const links = linkLiveSessions(
      [
        session('in-main', { cwd: '/code/seal/src' }),
        session('in-feat', { cwd: '/code/seal/.wt/feat' }),
        session('on-box', { cwd: '/code/seal', machine: BUILD_BOX }),
        session('elsewhere', { cwd: '/code/sealant' })
      ],
      worktrees,
      new Map(),
      hostOf
    )
    expect(Object.fromEntries([...links].map(([id, link]) => [id, link.worktreeId]))).toEqual({
      'in-main': 'wt-main',
      'in-feat': 'wt-feat',
      'on-box': 'wt-remote'
    })
  })

  it('links a Seal pane session to the workspace its tab is in, whatever its cwd', () => {
    const links = linkLiveSessions(
      [
        session('pane', {
          origin: 'seal',
          cwd: '/tmp/scratch',
          inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-9:2' }]
        })
      ],
      worktrees,
      new Map([['tab-9', 'wt-feat']]),
      hostOf
    )
    expect(links.get('pane')).toEqual({ worktreeId: 'wt-feat', repoId: 'repo-1', name: 'feat' })
  })
})

describe('liveSessionBadges', () => {
  it('counts live sessions per workspace and project with the most urgent status', () => {
    const sessions = [
      session('a', { status: 'waiting-subagent' }),
      session('b', { status: 'idle' }),
      session('c', { status: 'needs-permission' }),
      session('ended', { alive: false, status: 'done' })
    ]
    const links = new Map<string, LiveSessionLink>([
      ['a', { worktreeId: 'wt-1', repoId: 'repo-1', name: 'seal' }],
      ['b', { worktreeId: 'wt-1', repoId: 'repo-1', name: 'seal' }],
      ['c', { worktreeId: 'wt-2', repoId: 'repo-1', name: 'feat' }],
      ['ended', { worktreeId: 'wt-2', repoId: 'repo-1', name: 'feat' }]
    ])
    const { byWorktree, byProject } = liveSessionBadges(sessions, links)
    expect(byWorktree.get('wt-1')).toEqual({
      count: 2,
      status: 'waiting-subagent',
      sessionIds: ['a', 'b']
    })
    expect(byWorktree.get('wt-2')).toEqual({
      count: 1,
      status: 'needs-permission',
      sessionIds: ['c']
    })
    expect(byProject.get('repo-1')).toEqual({
      count: 3,
      status: 'needs-permission',
      sessionIds: ['a', 'b', 'c']
    })
  })
})
