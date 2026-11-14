import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { buildHomeAttentionItems } from './home-overview-derivations'
import { homeSessionFromLive, mergeLiveSessions } from './seal-home-overview-mapping'

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
  it('puts a session on its machine, whichever transport scanned it', () => {
    const session = homeSessionFromLive(
      live('a', {
        machine: {
          hostId: 'kessel-ssh',
          label: 'kessel-ml',
          kind: 'remote',
          machineId: 'machine:kessel-ssh',
          executionHostId: 'runtime:env-1',
          connection: 'server'
        }
      })
    )
    expect(session.machineId).toBe('machine:kessel-ssh')
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

describe('mergeLiveSessions summaries', () => {
  const pane = (id: string) => ({ ...homeSessionFromLive(live(id)), summary: undefined })

  it('carries a registry session summary onto its own row', () => {
    const [written, writing] = mergeLiveSessions(
      [],
      [
        live('written', { status: 'waiting-input', summary: 'Needs the staging API key.' }),
        live('writing', { status: 'waiting-input', summaryPending: true })
      ]
    )
    expect(written.summary).toEqual({ text: 'Needs the staging API key.', pending: false })
    expect(writing.summary).toEqual({ text: null, pending: true })
  })

  it('puts a pane summary on the pane row, by pane or by the conversation it runs', () => {
    const merged = mergeLiveSessions(
      [pane('local-pane'), pane('server-pane'), pane('other-pane')],
      [
        live('a', {
          inputRoutes: [{ kind: 'seal-pane', paneKey: 'local-pane' }],
          summary: 'Fixed the login redirect.'
        }),
        live('b', { providerSessionId: 'conversation-9', summary: 'Needs approval to deploy.' })
      ],
      (paneKey) => (paneKey === 'server-pane' ? 'conversation-9' : undefined)
    )
    expect(merged.map((session) => [session.id, session.summary?.text])).toEqual([
      ['local-pane', 'Fixed the login redirect.'],
      ['server-pane', 'Needs approval to deploy.'],
      ['other-pane', undefined],
      ['b', 'Needs approval to deploy.']
    ])
  })
})
