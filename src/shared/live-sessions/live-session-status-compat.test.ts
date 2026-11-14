import { describe, expect, it } from 'vitest'
import {
  liveSessionEventForClient,
  liveSessionSnapshotForClient
} from './live-session-status-compat'
import type { LiveSession, LiveSessionRegistrySnapshot } from './live-session-types'

function session(id: string, patch: Partial<LiveSession>): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    origin: 'external',
    cwd: '/srv/shop',
    project: 'shop',
    title: null,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 0,
    startedAt: null,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}

const snapshot: LiveSessionRegistrySnapshot = {
  revision: 7,
  sessions: [
    session('shell', { status: 'running-shell', statusSource: 'process' }),
    session('turn', { status: 'your-turn' }),
    session('asks', { status: 'waiting-input', statusSource: 'classifier' }),
    session('approval', { status: 'needs-permission', statusSource: 'screen' })
  ],
  hostErrors: {}
}

const statuses = (sessions: LiveSession[]) => sessions.map((s) => [s.status, s.statusSource])

describe('live session statuses for a client', () => {
  it('answers a client built before the new statuses in the ones it can decode', () => {
    expect(statuses(liveSessionSnapshotForClient(snapshot, ['pane-diffs.v1']).sessions)).toEqual([
      ['working', 'transcript'],
      ['idle', 'transcript'],
      ['waiting-input', 'transcript'],
      ['needs-permission', 'screen']
    ])
    const event = liveSessionEventForClient(
      { type: 'upsert', revision: 8, session: snapshot.sessions[1] },
      []
    )
    expect(event.type === 'upsert' && event.session.status).toBe('idle')
  })

  it.each([[['live-sessions.status.v2']], [undefined]])(
    'leaves them as they are for a client that declares %j',
    (capabilities) => {
      expect(liveSessionSnapshotForClient(snapshot, capabilities)).toBe(snapshot)
    }
  )
})
