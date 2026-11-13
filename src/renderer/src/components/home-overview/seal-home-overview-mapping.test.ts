import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { buildHomeAttentionItems } from './home-overview-derivations'
import { homeSessionFromLive } from './seal-home-overview-mapping'

function live(id: string, overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'mbp', kind: 'local' },
    origin: 'external',
    cwd: '/Users/brian/seal',
    project: 'seal',
    title: id,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 1_000,
    alive: true,
    pid: 42,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

describe('homeSessionFromLive', () => {
  it('puts a paired server session on that server', () => {
    const session = homeSessionFromLive(
      live('a', { machine: { hostId: 'runtime:env-1', label: 'kessel-ml', kind: 'runtime' } })
    )
    expect(session.machineId).toBe('runtime:env-1')
  })

  it('asks for attention only for running agents that wait or errored', () => {
    const items = buildHomeAttentionItems(
      [
        live('asking', { status: 'waiting-input', statusDetail: 'Which file?' }),
        live('failed', { status: 'errored', statusDetail: 'API Error: 401' }),
        live('closed-waiting', { status: 'waiting-input', alive: false }),
        live('closed-failed', { status: 'errored', alive: false })
      ].map(homeSessionFromLive)
    )
    expect(items.map((item) => [item.session.id, item.reason])).toEqual([
      ['asking', 'Which file?'],
      ['failed', 'API Error: 401']
    ])
  })
})
