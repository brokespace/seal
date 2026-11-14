import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { formatLiveSessions } from './seal-sessions-format'

function session(id: string, patch: Partial<LiveSession>): LiveSession {
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

const GPU = { hostId: 'ssh-gpu', label: 'gpu-box', kind: 'remote' } as const

const SNAPSHOT = {
  sessions: [
    session('quiet', {}),
    session('train', { machine: GPU, provider: 'codex', status: 'working', project: 'ml' }),
    session('asks', { status: 'needs-permission', statusDetail: 'Allow Bash?' }),
    session('ended', { alive: false, status: 'done' })
  ]
}

describe('formatLiveSessions', () => {
  it('lists running sessions by machine, this one first, most urgent first', () => {
    expect(formatLiveSessions(SNAPSHOT, false)).toBe(
      [
        'brian-mbp',
        '  needs-permission claude asks (seal) — Allow Bash? [asks]',
        '  idle             claude quiet (seal) [quiet]',
        '',
        'gpu-box',
        '  working          codex  train (ml) [train]'
      ].join('\n')
    )
  })

  it('adds ended sessions after the running ones with --all', () => {
    expect(formatLiveSessions(SNAPSHOT, true).split('\n').slice(0, 4)).toEqual([
      'brian-mbp',
      '  needs-permission claude asks (seal) — Allow Bash? [asks]',
      '  idle             claude quiet (seal) [quiet]',
      '  done             claude ended (seal) [ended]'
    ])
  })
})
