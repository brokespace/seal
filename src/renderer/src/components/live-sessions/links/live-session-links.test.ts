import { describe, expect, it } from 'vitest'
import { sampleLiveSession as session } from '../live-session.test-fixture'
import { projectSessionBadges, type LiveSessionLink } from './live-session-links'

describe('projectSessionBadges', () => {
  it('counts live sessions per project with the most urgent status', () => {
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
    const byProject = projectSessionBadges(sessions, links)
    expect(byProject.get('repo-1')).toEqual({
      count: 3,
      status: 'needs-permission',
      sessionIds: ['a', 'b', 'c']
    })
  })
})
