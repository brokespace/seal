import { describe, expect, it, vi } from 'vitest'
import type {
  LiveSession,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../shared/live-sessions/live-session-types'
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
    const server: Pick<FederatedTranscripts, 'page' | 'since' | 'watch' | 'imageBase64'> = {
      imageBase64: async () => '',
      page: () => fromServer,
      since: async () => ({ messages: [], cursor: 2, shrank: false }),
      watch: () => ({ ready: fromServer, unsubscribe: stopServer })
    }
    const access = new SessionTranscriptAccess({
      session: () => listed,
      server: () => (listed ? server : null),
      files: {
        imageBase64: async () => '',
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

  it('keeps the rows a watcher holds while the server that now lists the session has not answered', async () => {
    let listed: LiveSession | null = null
    const told = new Set<() => void>()
    // What a server's watch answers when its first open fails: nothing, until the server is reached.
    const unanswered = Promise.resolve(NOTHING)
    let fromServer: (delta: LiveTranscriptDelta) => void = () => {}
    const fromFile: LiveTranscriptPage = {
      sessionId: ID,
      messages: [ASKED, REPLIED],
      cursor: 2,
      start: 0,
      more: false
    }
    const access = new SessionTranscriptAccess({
      session: () => listed,
      server: () =>
        listed
          ? {
              imageBase64: async () => '',
              page: () => unanswered,
              since: async () => ({ messages: [], cursor: 0, shrank: false }),
              watch: (_id, _cursor, listener) => {
                fromServer = listener
                return { ready: unanswered, unsubscribe: () => {} }
              }
            }
          : null,
      files: {
        imageBase64: async () => '',
        page: async () => fromFile,
        since: async () => ({ messages: [], cursor: 2, shrank: false }),
        subscribe: () => ({ ready: Promise.resolve(fromFile), unsubscribe: () => {} })
      },
      onSessionsChanged: (listener) => {
        told.add(listener)
        return () => told.delete(listener)
      }
    })
    const deltas: LiveTranscriptDelta[] = []
    const watch = access.watch(ID, null, (delta) => deltas.push(delta))
    expect(await watch.ready).toEqual(fromFile)

    listed = SERVER_CHAT
    for (const tell of told) {
      tell()
    }
    await unanswered
    await Promise.resolve()
    expect(deltas).toEqual([])

    const answered: LiveTranscriptDelta = {
      sessionId: ID,
      from: 0,
      cursor: 3,
      messages: [ASKED, REPLIED, row('m3', 'user', 'Ship it')],
      reset: true
    }
    fromServer(answered)
    expect(deltas).toEqual([answered])
    watch.unsubscribe()
  })

  it('gives a watcher that has read nothing the newest page, not everything before it', async () => {
    const newest: LiveTranscriptPage = {
      sessionId: ID,
      messages: [REPLIED],
      cursor: 900,
      start: 800,
      more: true
    }
    const subscribe = vi.fn(() => ({ ready: Promise.resolve(newest), unsubscribe: vi.fn() }))
    const access = new SessionTranscriptAccess({
      session: () => null,
      server: () => null,
      files: {
        imageBase64: async () => '',
        page: async () => newest,
        since: async () => ({ messages: [], cursor: 0, shrank: false }),
        subscribe
      },
      onSessionsChanged: () => () => {}
    })
    const deltas: unknown[] = []

    const watch = access.watch(ID, 0, (delta) => deltas.push(delta))
    expect(await watch.ready).toBeNull()
    await Promise.resolve()

    expect(subscribe.mock.calls[0].slice(0, 2)).toEqual([ID, null])
    expect(deltas).toEqual([
      { sessionId: ID, from: 0, cursor: 900, messages: [REPLIED], reset: true }
    ])
    watch.unsubscribe()
  })
})
