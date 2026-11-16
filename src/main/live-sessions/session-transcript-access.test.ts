import { describe, expect, it, vi } from 'vitest'
import type { LiveSession, LiveTranscriptPage } from '../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../shared/live-sessions/live-session-surface.test-fixture'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type { FederatedTranscripts } from './federation/federated-transcripts'
import { SessionTranscriptAccess } from './session-transcript-access'

const ID = 'machine-7:claude:abc'

const SERVER_CHAT: LiveSession = {
  id: ID,
  provider: 'claude',
  providerSessionId: 'abc',
  machine: { hostId: 'machine-7', label: 'kessel-ml', kind: 'remote', connection: 'server' },
  origin: 'seal',
  ...sampleSessionSurface('seal'),
  surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
  cwd: '/srv/app',
  project: 'app',
  title: null,
  status: 'your-turn',
  statusSource: 'seal-hooks',
  statusDetail: null,
  lastActivityAt: 0,
  startedAt: null,
  alive: true,
  pid: 4321,
  transcriptPath: null,
  inputRoutes: [{ kind: 'structured', sessionId: 'chat-1' }],
  permission: null
}

const row = (id: string, role: NativeChatMessage['role'], text: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: 1000,
  source: 'transcript'
})
const ASKED = row('m1', 'user', 'Fix the build')
const REPLIED = row('m2', 'assistant', 'Done.')
const NOTHING: LiveTranscriptPage = {
  sessionId: ID,
  messages: [],
  cursor: 0,
  start: 0,
  more: false
}

describe('a transcript watch begun before the session is listed', () => {
  it("gets the chat's conversation once its server lists it, and stops reading the file", async () => {
    let listed: LiveSession | null = null
    const told = new Set<() => void>()
    const stopFile = vi.fn()
    const stopServer = vi.fn()
    const fromServer = Promise.resolve<LiveTranscriptPage>({
      sessionId: ID,
      messages: [ASKED, REPLIED],
      cursor: 2,
      start: 0,
      more: false
    })
    const server: Pick<FederatedTranscripts, 'page' | 'since' | 'watch'> = {
      page: () => fromServer,
      since: async () => ({ messages: [], cursor: 2, shrank: false }),
      watch: () => ({ ready: fromServer, unsubscribe: stopServer })
    }
    const access = new SessionTranscriptAccess({
      session: () => listed,
      server: () => (listed ? server : null),
      files: {
        page: async () => NOTHING,
        since: async () => ({ messages: [], cursor: 0, shrank: false }),
        subscribe: () => ({ ready: Promise.resolve(NOTHING), unsubscribe: stopFile })
      },
      onSessionsChanged: (listener) => {
        told.add(listener)
        return () => told.delete(listener)
      }
    })
    const deltas: unknown[] = []

    const watch = access.watch(ID, null, (delta) => deltas.push(delta))
    expect(await watch.ready).toEqual(NOTHING)

    listed = SERVER_CHAT
    for (const tell of told) {
      tell()
    }
    await fromServer

    expect(deltas).toEqual([
      { sessionId: ID, from: 0, cursor: 2, messages: [ASKED, REPLIED], reset: true }
    ])
    expect(stopFile).toHaveBeenCalledTimes(1)

    watch.unsubscribe()
    expect(stopServer).toHaveBeenCalledTimes(1)
    expect(told.size).toBe(0)
  })
})
