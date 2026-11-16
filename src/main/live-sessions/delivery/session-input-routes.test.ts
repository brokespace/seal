import { describe, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { removeFromOwner } from './session-removal'
import { SessionInputRoutes } from './session-input-routes'

/** A paired server's chat whose ids happen to match a chat and a pane of this Seal's own. */
const SERVER_CHAT: LiveSession = {
  id: 'machine-7:claude:abc',
  provider: 'claude',
  providerSessionId: 'abc',
  machine: { hostId: 'machine-7', label: 'kessel-ml', kind: 'remote', connection: 'server' },
  origin: 'seal',
  ...sampleSessionSurface('seal'),
  surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
  cwd: '/srv/app',
  project: 'app',
  title: null,
  status: 'needs-permission',
  statusSource: 'seal-hooks',
  statusDetail: null,
  lastActivityAt: 0,
  startedAt: null,
  alive: true,
  pid: 4321,
  transcriptPath: null,
  inputRoutes: [
    { kind: 'structured', sessionId: 'chat-1' },
    { kind: 'seal-pane', paneKey: 'tab-1:pane-1' }
  ],
  permission: {
    promptId: 'p-1',
    question: 'Run pnpm test?',
    options: [{ id: 'allow', label: 'Allow' }]
  }
}

describe('a paired server session whose server is out of reach', () => {
  it("never reaches this Seal's own chat or pane of the same id", async () => {
    const structured = { send: vi.fn(), answer: vi.fn() }
    const sealPanes = { send: vi.fn(), answer: vi.fn() }
    const stop = vi.fn()
    const routes = new SessionInputRoutes({ host: () => null, structured, sealPanes })
    const signal = new AbortController().signal

    const attempts = await Promise.all(
      SERVER_CHAT.inputRoutes.map((route) =>
        routes.attempt(SERVER_CHAT, route, 'Run the tests', 'r-1', signal)
      )
    )
    const answered = await routes.answer(SERVER_CHAT, {
      sessionId: SERVER_CHAT.id,
      promptId: 'p-1',
      optionId: 'allow'
    })
    const removed = await removeFromOwner(
      SERVER_CHAT,
      { sessionIds: [SERVER_CHAT.id], stop: true, deleteTranscripts: false },
      { server: null, chats: { stop }, host: null }
    )

    expect(attempts).toEqual([
      { outcome: 'unavailable', reason: 'kessel-ml is not connected' },
      { outcome: 'unavailable', reason: 'kessel-ml is not connected' }
    ])
    expect(answered).toEqual({ ok: false, reason: 'not_answerable' })
    expect(removed).toBe('still_running')
    for (const call of [
      structured.send,
      structured.answer,
      sealPanes.send,
      sealPanes.answer,
      stop
    ]) {
      expect(call).not.toHaveBeenCalled()
    }
  })
})
