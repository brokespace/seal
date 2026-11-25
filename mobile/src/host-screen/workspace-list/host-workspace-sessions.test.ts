import { describe, expect, it } from 'vitest'
import { liveSessionSnapshotSchema } from '../../seal/live-sessions/live-session-schemas'
import { hostWorkspaceSessions } from './host-workspace-sessions'

const SERVER = 'runtime:4177d235-1258-4b5f-9e1f-1522d49e71b2'
const SSH = 'ssh:ssh-1794772136309-vf'
const SERVER_WORKTREE = '9a57e9f3-d6ca-49db-a395-385fd9ff44c6::/home/dev/workspaces/app/feature'

// Trimmed from a real Mac `liveSessions.list` reply: sessions on a paired server and an SSH machine.
function record(
  id: string,
  executionHostId: string,
  surface: Record<string, unknown>,
  cwd: string,
  workspace?: Record<string, unknown>
) {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: executionHostId, label: 'box', kind: 'remote', executionHostId },
    origin: 'external',
    cwd,
    project: 'app',
    title: id,
    status: 'working',
    statusDetail: null,
    lastActivityAt: 1795024240644,
    startedAt: 1795024197260,
    alive: true,
    inputRoutes: [],
    permission: null,
    surface,
    ...(workspace ? { workspace } : {})
  }
}

const { sessions } = liveSessionSnapshotSchema.parse({
  revision: 1,
  hostErrors: {},
  sessions: [
    record('tmux', SERVER, { kind: 'external' }, '/home/dev/workspaces/app/feature/mobile', {
      worktreeId: SERVER_WORKTREE,
      projectKey: 'github:dev/app',
      projectName: 'app'
    }),
    record(
      'pane',
      SERVER,
      { kind: 'cli', paneKey: 'tab-1:1' },
      '/home/dev/workspaces/app/feature',
      {
        worktreeId: SERVER_WORKTREE,
        projectKey: 'github:dev/app',
        projectName: 'app'
      }
    ),
    record('over-ssh', SSH, { kind: 'external' }, '/home/rizzo/fitness')
  ]
})

describe('hostWorkspaceSessions', () => {
  it('lists each session under the workspace it runs in on its own machine, panes left to the agents', () => {
    const listed = hostWorkspaceSessions(sessions, [
      { hostId: SERVER, worktreeId: SERVER_WORKTREE, path: '/home/dev/workspaces/app/feature' },
      { hostId: SSH, worktreeId: 'fitness-id', path: '/home/rizzo/fitness' },
      { worktreeId: SERVER_WORKTREE, path: '/home/dev/workspaces/app/feature' }
    ])
    expect(
      Object.fromEntries([...listed].map(([row, rows]) => [row, rows.map((s) => s.id)]))
    ).toEqual({
      [`${SERVER}|${SERVER_WORKTREE}`]: ['tmux'],
      [`${SSH}|fitness-id`]: ['over-ssh']
    })
  })
})
