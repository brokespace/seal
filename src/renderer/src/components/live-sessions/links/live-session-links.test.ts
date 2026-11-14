import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession as session } from '../live-session.test-fixture'
import { linkLiveSessions, liveSessionBadges, type LiveSessionLink } from './live-session-links'

const BUILD_BOX = { hostId: 'ssh-1', label: 'build-box', kind: 'remote' } as const

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
