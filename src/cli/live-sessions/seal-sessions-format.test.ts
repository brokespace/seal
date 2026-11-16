import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../shared/live-sessions/live-session-surface.test-fixture'
import { filterLiveSessionSnapshot, formatLiveSessions } from './seal-sessions-format'

function session(id: string, patch: Partial<LiveSession>): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/code/seal',
    project: 'seal',
    title: id,
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1,
    startedAt: 0,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}

const GPU = {
  hostId: 'ssh-gpu',
  label: 'gpu-box',
  kind: 'remote',
  machineId: 'machine:gpu'
} as const

const SNAPSHOT = {
  sessions: [
    session('quiet', {}),
    session('train', {
      machine: GPU,
      provider: 'codex',
      status: 'working',
      cwd: '/srv/ml',
      project: 'ml'
    }),
    session('asks', { status: 'needs-permission', statusDetail: 'Allow Bash?' }),
    session('ended', { alive: false, status: 'done' }),
    session('chat', {
      machine: GPU,
      provider: 'grok',
      origin: 'seal',
      surface: { kind: 'chat', sessionId: 'c1', tabId: 't1' },
      alive: false,
      status: 'your-turn',
      cwd: '/srv/seal-fork',
      project: 'seal-fork',
      workspace: { worktreeId: 'w-fork', projectKey: 'github:acme/seal' }
    })
  ]
}

const HEADER = 'STATUS            AGENT        PROJECT    WORKSPACE       MACHINE    SESSION'
const TRAIN = 'working           Codex        ml         /srv/ml         gpu-box    train [train]'
const ASKS =
  'needs-permission  Claude Code  seal       /code/seal      brian-mbp  asks — Allow Bash? [asks]'
const QUIET = 'idle              Claude Code  seal       /code/seal      brian-mbp  quiet [quiet]'
const ENDED = 'done              Claude Code  seal       /code/seal      brian-mbp  ended [ended]'
const CHAT = 'your-turn         Grok         seal-fork  /srv/seal-fork  gpu-box    chat [chat]'

describe('formatLiveSessions', () => {
  it('lists running sessions of every agent by project and workspace, most urgent first', () => {
    expect(formatLiveSessions(SNAPSHOT, false)).toBe([HEADER, TRAIN, ASKS, QUIET, CHAT].join('\n'))
  })

  it('adds ended sessions after the running ones of their workspace with --all', () => {
    expect(formatLiveSessions(SNAPSHOT, true)).toBe(
      [HEADER, TRAIN, ASKS, QUIET, ENDED, CHAT].join('\n')
    )
  })
})

describe('filterLiveSessionSnapshot', () => {
  const ids = (filter: Parameters<typeof filterLiveSessionSnapshot>[1]): string[] =>
    filterLiveSessionSnapshot(SNAPSHOT, filter).sessions.map((entry) => entry.id)

  it('narrows to a machine by its name in any letter case, its host id or its machine id', () => {
    expect(ids({ machine: 'GPU-Box' })).toEqual(['train', 'chat'])
    expect(ids({ machine: 'ssh-gpu' })).toEqual(['train', 'chat'])
    expect(ids({ machine: 'machine:gpu' })).toEqual(['train', 'chat'])
    expect(ids({ machine: 'local' })).toEqual(['quiet', 'asks', 'ended'])
  })

  it('narrows to a project by its name in any letter case or its key', () => {
    expect(ids({ project: 'SEAL' })).toEqual(['quiet', 'asks', 'ended'])
    expect(ids({ project: 'github:acme/seal' })).toEqual(['chat'])
    expect(ids({ project: 'seal', machine: 'gpu-box' })).toEqual([])
  })
})
