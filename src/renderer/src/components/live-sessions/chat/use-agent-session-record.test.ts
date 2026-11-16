import { describe, expect, it } from 'vitest'
import { sampleLiveSession } from '../live-session.test-fixture'
import { findAgentSessionRecord } from './use-agent-session-record'

const unchanged = (sessionId: string): string => sessionId

describe('findAgentSessionRecord', () => {
  const sessions = [
    sampleLiveSession('local:claude:outside', { surface: { kind: 'external' } }),
    sampleLiveSession('local:claude:chat', {
      surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' }
    }),
    sampleLiveSession('local:codex:pane', { surface: { kind: 'cli', paneKey: 'tab-2:leaf-1' } })
  ]

  it('finds a record by its id, by its structured chat and by its terminal pane', () => {
    const found = [
      findAgentSessionRecord(
        sessions,
        { kind: 'record', sessionId: 'local:claude:outside' },
        unchanged
      ),
      findAgentSessionRecord(sessions, { kind: 'chat', sessionId: 'chat-1' }, unchanged),
      findAgentSessionRecord(sessions, { kind: 'pane', paneKey: 'tab-2:leaf-1' }, unchanged)
    ]

    expect(found.map((session) => session?.id)).toEqual([
      'local:claude:outside',
      'local:claude:chat',
      'local:codex:pane'
    ])
  })

  it('does not take a chat id for a pane key, a pane key for a record id, or a record id for a chat', () => {
    expect(
      findAgentSessionRecord(sessions, { kind: 'pane', paneKey: 'chat-1' }, unchanged)
    ).toBeNull()
    expect(
      findAgentSessionRecord(sessions, { kind: 'record', sessionId: 'tab-2:leaf-1' }, unchanged)
    ).toBeNull()
    expect(
      findAgentSessionRecord(sessions, { kind: 'chat', sessionId: 'local:claude:chat' }, unchanged)
    ).toBeNull()
  })

  it('follows a record id to the id its session goes by now', () => {
    const renamed = (sessionId: string): string =>
      sessionId === 'local:claude:fresh' ? 'local:claude:outside' : sessionId

    expect(
      findAgentSessionRecord(sessions, { kind: 'record', sessionId: 'local:claude:fresh' }, renamed)
        ?.id
    ).toBe('local:claude:outside')
  })

  it('shows the running session of a pane whose earlier session has ended', () => {
    const pane = { kind: 'cli', paneKey: 'tab-3:leaf-1' } as const
    const reused = [
      sampleLiveSession('local:claude:ended', { surface: pane, alive: false, lastActivityAt: 900 }),
      sampleLiveSession('local:claude:running', { surface: pane, alive: true, lastActivityAt: 100 })
    ]

    expect(
      findAgentSessionRecord(reused, { kind: 'pane', paneKey: 'tab-3:leaf-1' }, unchanged)?.id
    ).toBe('local:claude:running')
  })
})
