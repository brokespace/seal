import { describe, expect, it } from 'vitest'
import { liveSessionSnapshotSchema } from './live-session-schemas'
import { pairedDesktopSessions } from './paired-desktop-sessions'

const SERVER_RUNTIME = '4177d235-1258-4b5f-9e1f-1522d49e71b2'
const RELAYED = 'a1b2c3d4-0000-4000-8000-000000000001'
const DESKTOP_OWN = 'a1b2c3d4-0000-4000-8000-000000000002'

// Trimmed from real `liveSessions.list` replies: a Mac relaying a paired server, and that server itself.
function record(id: string, providerSessionId: string, machine: Record<string, unknown>) {
  return {
    id,
    provider: 'claude',
    providerSessionId,
    machine,
    origin: 'external',
    cwd: '/home/dev/projects/app',
    project: 'app',
    title: null,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: 'Thinking',
    lastActivityAt: 1795024240644.4895,
    startedAt: 1795024197260,
    alive: true,
    pid: 2283943,
    inputRoutes: [{ kind: 'tmux', target: '%94', socket: '/tmp/tmux-1000/default' }],
    permission: null,
    lastMessage: null,
    surface: { kind: 'external' },
    capabilities: {
      send: true,
      answer: 'options',
      transcript: true,
      recap: true,
      context: 'estimated',
      switchSurface: { toChat: true, toCli: false },
      takeOver: true
    }
  }
}

const macSnapshot = liveSessionSnapshotSchema.parse({
  revision: 233,
  hostErrors: {},
  sessions: [
    record(`${SERVER_RUNTIME}:claude:${RELAYED}`, RELAYED, {
      hostId: SERVER_RUNTIME,
      label: 'kessel-ml',
      kind: 'remote',
      machineId: `machine:${SERVER_RUNTIME}`,
      executionHostId: `runtime:${SERVER_RUNTIME}`,
      connection: 'server'
    }),
    record(`local:claude:${DESKTOP_OWN}`, DESKTOP_OWN, {
      hostId: 'local',
      label: 'MacBook Pro',
      kind: 'local',
      machineId: 'local',
      executionHostId: 'local',
      connection: 'local'
    })
  ]
})

const serverSnapshot = liveSessionSnapshotSchema.parse({
  revision: 12,
  hostErrors: {},
  sessions: [
    record(`local:claude:${RELAYED}`, RELAYED, {
      hostId: 'local',
      label: 'kessel-ml',
      kind: 'local',
      machineId: 'local',
      executionHostId: 'local',
      connection: 'local'
    })
  ]
})

describe('pairedDesktopSessions', () => {
  it('lists a server’s session once, under the server, when the phone pairs with both', () => {
    const { byDesktop, all } = pairedDesktopSessions([
      { hostId: 'mac', sessions: macSnapshot.sessions },
      { hostId: 'server', sessions: serverSnapshot.sessions }
    ])
    expect(byDesktop.get('mac')?.map((s) => s.id)).toEqual([`local:claude:${DESKTOP_OWN}`])
    expect(byDesktop.get('server')?.map((s) => s.id)).toEqual([`local:claude:${RELAYED}`])
    expect(all.map((s) => [s.desktopHostId, s.providerSessionId])).toEqual([
      ['mac', DESKTOP_OWN],
      ['server', RELAYED]
    ])
  })

  it('keeps a relayed session when the phone does not pair with its server', () => {
    const { byDesktop } = pairedDesktopSessions([{ hostId: 'mac', sessions: macSnapshot.sessions }])
    expect(byDesktop.get('mac')?.map((s) => s.providerSessionId)).toEqual([RELAYED, DESKTOP_OWN])
  })
})
