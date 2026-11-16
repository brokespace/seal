import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { FederatedSessions, type FederationTransport } from './federated-sessions'

type Handlers = Parameters<FederationTransport['subscribe']>[3]
type Stream = { method: string; params: unknown; handlers: Handlers; closed: boolean }

const MACHINE: LiveSessionMachine = {
  hostId: 'machine-7',
  label: 'kessel-ml',
  kind: 'remote',
  machineId: 'm7',
  executionHostId: 'runtime:env-1',
  connection: 'server'
}
const SERVER = { machine: MACHINE, environmentId: 'env-1' }

const CHAT_CAPABILITIES = {
  send: true,
  answer: 'full',
  transcript: true,
  recap: true,
  context: 'exact',
  switchSurface: { toChat: false, toCli: true },
  takeOver: false
}

/** A chat as the server's own registry lists it: under the server's `local` machine and ids. */
function serverChat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'kessel-ml', kind: 'local' },
    origin: 'seal',
    cwd: '/srv/app',
    project: 'app',
    title: 'Fix the build',
    status: 'working',
    statusSource: 'seal-hooks',
    statusDetail: null,
    lastActivityAt: 1000,
    startedAt: 900,
    alive: true,
    pid: 4321,
    transcriptPath: null,
    inputRoutes: [{ kind: 'structured', sessionId: 'chat-1' }],
    permission: null,
    surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
    capabilities: CHAT_CAPABILITIES,
    ...overrides
  }
}

function ready(sessions: unknown[], messages: unknown[] = []): unknown {
  return {
    type: 'ready',
    surfaces: ['chat', 'cli', 'external'],
    subscriptionId: 'live-sessions-1',
    snapshot: { revision: 1, sessions, hostErrors: {} },
    messages
  }
}

function upsert(session: unknown): unknown {
  return { type: 'event', event: { type: 'upsert', revision: 2, session } }
}

function serverMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: 'm-1',
    sessionId: 'local:claude:abc',
    text: 'Run the tests',
    state: 'queued',
    route: null,
    error: null,
    createdAt: 5000,
    updatedAt: 5000,
    ...overrides
  }
}

function ok(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: '1', ok: true, result, _meta: { runtimeId: 'kessel-ml' } }
}

function fakeServer(): {
  transport: FederationTransport
  streams: Stream[]
  calls: { environmentId: string; method: string; params: unknown }[]
  answers: Map<string, () => RuntimeRpcResponse<unknown>>
} {
  const streams: Stream[] = []
  const calls: { environmentId: string; method: string; params: unknown }[] = []
  const answers = new Map<string, () => RuntimeRpcResponse<unknown>>()
  return {
    streams,
    calls,
    answers,
    transport: {
      async subscribe(_environmentId, method, params, handlers) {
        const stream = { method, params, handlers, closed: false }
        streams.push(stream)
        return {
          close: () => {
            stream.closed = true
          }
        }
      },
      async call(environmentId, method, params) {
        calls.push({ environmentId, method, params })
        const answer = answers.get(method)
        if (!answer) {
          throw new Error('The server did not answer')
        }
        return answer()
      }
    }
  }
}

function federate(sessions: unknown[] = [serverChat()]): ReturnType<typeof fakeServer> & {
  federation: FederatedSessions
} {
  const server = fakeServer()
  const federation = new FederatedSessions({
    transport: server.transport,
    retryMs: 50
  })
  federation.sync([SERVER])
  server.streams[0].handlers.onFrame(ready(sessions))
  return { ...server, federation }
}

const listedIds = (federation: FederatedSessions): string[] =>
  federation.source.sessions().map((session) => session.id)

afterEach(() => {
  vi.useRealTimers()
})

describe('a paired server listed from its own registry', () => {
  it('lists a chat under the desktop machine record and the desktop ids', () => {
    const { federation } = federate([
      serverChat({ continues: ['local:claude:seal-chat-1'] }),
      // The server reaches this one over SSH: the desktop lists that machine itself, or not at all.
      serverChat({
        id: 'ssh-9:claude:def',
        providerSessionId: 'def',
        machine: { hostId: 'ssh-9', label: 'build-box', kind: 'remote' }
      })
    ])

    expect(federation.covers('machine-7')).toBe(true)
    expect(federation.notice('machine-7')).toBeNull()
    expect(federation.owns('machine-7:claude:abc')).toBe(true)
    expect(federation.owns('local:claude:abc')).toBe(false)
    expect(federation.source.sessions()).toEqual([
      {
        id: 'machine-7:claude:abc',
        provider: 'claude',
        providerSessionId: 'abc',
        machine: MACHINE,
        origin: 'seal',
        cwd: '/srv/app',
        project: 'app',
        title: 'Fix the build',
        status: 'working',
        statusSource: 'seal-hooks',
        statusDetail: null,
        lastActivityAt: 1000,
        startedAt: 900,
        alive: true,
        pid: 4321,
        transcriptPath: null,
        inputRoutes: [{ kind: 'structured', sessionId: 'chat-1' }],
        permission: null,
        surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
        capabilities: CHAT_CAPABILITIES,
        continues: ['machine-7:claude:seal-chat-1']
      }
    ])
  })

  it('leaves an older server to the scan and says it needs an update', () => {
    const server = fakeServer()
    const federation = new FederatedSessions({ transport: server.transport, retryMs: 50 })
    federation.sync([SERVER])
    server.streams[0].handlers.onError({
      code: 'method_not_found',
      message: 'Unknown method: liveSessions.watch'
    })

    expect(federation.covers('machine-7')).toBe(false)
    expect(federation.notice('machine-7')).not.toBeNull()
    expect(federation.source.sessions()).toEqual([])
    expect(federation.owns('machine-7:claude:abc')).toBe(false)

    // Updated and reconnected: it is asked again and federates without an app restart.
    federation.sync([])
    federation.sync([SERVER])
    server.streams[1].handlers.onFrame(ready([serverChat()]))

    expect(federation.covers('machine-7')).toBe(true)
    expect(federation.notice('machine-7')).toBeNull()
    expect(listedIds(federation)).toEqual(['machine-7:claude:abc'])
  })

  it('leaves a server whose registry lists no chats to the scan', () => {
    const server = fakeServer()
    const federation = new FederatedSessions({ transport: server.transport, retryMs: 50 })
    federation.sync([SERVER])
    server.streams[0].handlers.onFrame({
      type: 'ready',
      subscriptionId: 'sub-1',
      snapshot: { revision: 1, sessions: [serverChat()], hostErrors: {} },
      messages: []
    })

    expect(federation.covers('machine-7')).toBe(false)
    expect(federation.notice('machine-7')).toBe(
      'kessel-ml runs an older Seal: update Seal on this server to list its chats'
    )
    expect(federation.source.sessions()).toEqual([])
  })

  it('follows upsert, remove and host-error events and tells its subscribers', () => {
    const { federation, streams } = federate()
    const onChange = vi.fn()
    federation.source.subscribe(onChange)
    const { onFrame } = streams[0].handlers

    onFrame(
      upsert(serverChat({ id: 'local:codex:xyz', provider: 'codex', providerSessionId: 'xyz' }))
    )
    expect(listedIds(federation)).toEqual(['machine-7:claude:abc', 'machine-7:codex:xyz'])
    expect(onChange).toHaveBeenCalled()

    onChange.mockClear()
    onFrame(upsert(serverChat({ status: 'needs-permission' })))
    expect(federation.source.sessions().map((session) => session.status)).toEqual([
      'needs-permission',
      'working'
    ])
    expect(onChange).toHaveBeenCalled()

    onChange.mockClear()
    onFrame({ type: 'event', event: { type: 'remove', revision: 4, sessionId: 'local:codex:xyz' } })
    expect(listedIds(federation)).toEqual(['machine-7:claude:abc'])
    expect(onChange).toHaveBeenCalled()

    onChange.mockClear()
    onFrame({
      type: 'event',
      event: { type: 'host-error', revision: 5, hostId: 'local', error: 'The scan was cut short' }
    })
    expect(federation.notice('machine-7')).toBe('The scan was cut short')
    expect(onChange).toHaveBeenCalled()
  })

  it.each([
    ['not an object', 'ready'],
    ['an unknown frame', { type: 'surprise' }],
    ['an upsert of a malformed record', upsert({ id: 5, provider: 'claude' })],
    ['an upsert with a status this build does not know', upsert(serverChat({ status: 'napping' }))]
  ])('drops %s without throwing', (_name, frame) => {
    const { federation, streams } = federate()

    streams[0].handlers.onFrame(frame)

    expect(federation.source.sessions().map((session) => [session.id, session.status])).toEqual([
      ['machine-7:claude:abc', 'working']
    ])
  })

  it('keeps a renamed session continuous: the successor continues the id it replaced', () => {
    const { federation, streams } = federate([
      serverChat({ id: 'local:claude:seal-chat-1', providerSessionId: 'seal-chat-1' })
    ])
    const { onFrame } = streams[0].handlers

    onFrame(upsert(serverChat()))
    onFrame({
      type: 'event',
      event: {
        type: 'remove',
        revision: 3,
        sessionId: 'local:claude:seal-chat-1',
        replacedBy: 'local:claude:abc'
      }
    })

    expect(federation.source.sessions().map((session) => [session.id, session.continues])).toEqual([
      ['machine-7:claude:abc', ['machine-7:claude:seal-chat-1']]
    ])
  })

  it('forwards a send and an answer under the server ids and lists the message under the desktop id', async () => {
    const { federation, calls, answers } = federate()
    const heard = vi.fn()
    federation.subscribeMessages(heard)
    answers.set('liveSessions.send', () => ok(serverMessage()))
    answers.set('liveSessions.answer', () => ok({ ok: true }))

    const sent = await federation.offer({
      sessionId: 'machine-7:claude:abc',
      messageId: 'm-1',
      text: 'Run the tests'
    })
    const answered = await federation.answer({
      sessionId: 'machine-7:claude:abc',
      promptId: 'p-1',
      optionId: 'yes'
    })

    const listed = {
      messageId: 'm-1',
      sessionId: 'machine-7:claude:abc',
      text: 'Run the tests',
      state: 'queued',
      route: null,
      error: null,
      createdAt: 5000,
      updatedAt: 5000
    }
    expect(sent).toEqual(listed)
    expect(answered).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'liveSessions.send',
        params: { sessionId: 'local:claude:abc', messageId: 'm-1', text: 'Run the tests' }
      },
      {
        environmentId: 'env-1',
        method: 'liveSessions.answer',
        params: { sessionId: 'local:claude:abc', promptId: 'p-1', optionId: 'yes' }
      }
    ])
    expect(federation.messages('machine-7:claude:abc')).toEqual([listed])
    expect(heard).toHaveBeenCalledWith(listed)
  })

  // The server stamps `queued` and `sending` in one millisecond; the frame can beat the call's answer.
  it('does not step a message back to the state a late answer carries', async () => {
    const { federation, streams, answers } = federate()
    const heard = vi.fn()
    federation.subscribeMessages(heard)
    answers.set('liveSessions.send', () => {
      streams[0].handlers.onFrame({ type: 'message', message: serverMessage({ state: 'sending' }) })
      return ok(serverMessage())
    })

    const sent = await federation.offer({
      sessionId: 'machine-7:claude:abc',
      messageId: 'm-1',
      text: 'Run the tests'
    })

    expect('state' in sent && sent.state).toBe('sending')
    expect(heard.mock.calls.map(([message]) => message.state)).toEqual(['sending'])
  })

  // The server types it again only on the user's word, so the desktop must know to ask and pass it on.
  it('lists a server message its session may have run as unconfirmed, and hands on the word that it may run twice', async () => {
    const { federation, streams, calls, answers } = federate()
    const failed = serverMessage({ state: 'failed', error: 'never shown', unconfirmed: true })
    streams[0].handlers.onFrame({ type: 'message', message: failed })
    answers.set('liveSessions.retry', () => ok(failed))

    expect(federation.messages()[0].unconfirmed).toBe(true)
    await federation.retry('m-1')
    await federation.retry('m-1', true)

    expect(calls.map((call) => call.params)).toEqual([
      { messageId: 'm-1' },
      { messageId: 'm-1', mayRunTwice: true }
    ])
  })

  it('says why a message did not reach the server and keeps nothing of it', async () => {
    const { federation } = federate()

    const refused = await federation.offer({
      sessionId: 'machine-7:claude:abc',
      messageId: 'm-1',
      text: 'Run the tests'
    })

    expect(refused).toEqual({ refused: 'The server did not answer' })
    expect(federation.messages()).toEqual([])
    expect(federation.retry('m-1')).toBeNull()
  })

  it('stops a session on its server without hiding it there', async () => {
    const { federation, calls, answers } = federate()
    answers.set('liveSessions.remove', () =>
      ok({ removed: [], failed: [{ sessionId: 'local:claude:abc', reason: 'still_running' }] })
    )

    const outcome = await federation.remove('machine-7:claude:abc', {
      stop: true,
      deleteTranscripts: false
    })

    expect(outcome).toBe('still_running')
    expect(calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'liveSessions.remove',
        params: {
          sessionIds: ['local:claude:abc'],
          stop: true,
          deleteTranscripts: false,
          keep: true
        }
      }
    ])
  })

  it.each([
    {
      name: 'a Seal pane',
      record: { origin: 'seal', inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-3:0' }] },
      surface: { kind: 'cli', paneKey: 'tab-3:0' },
      capabilities: { send: true, answer: 'full', takeOver: false }
    },
    {
      name: 'an agent in tmux, started outside Seal',
      record: { origin: 'external', inputRoutes: [{ kind: 'tmux', target: '%4' }] },
      surface: { kind: 'external' },
      capabilities: { send: true, answer: 'options', takeOver: true }
    },
    {
      name: 'a session nothing can type into',
      record: { origin: 'external', inputRoutes: [] },
      surface: { kind: 'external' },
      capabilities: { send: false, answer: 'none', takeOver: true }
    }
  ])(
    'gives $name from a server that predates surface and capabilities both',
    ({ record, surface, capabilities }) => {
      const { federation } = federate([
        serverChat({ ...record, surface: undefined, capabilities: undefined })
      ])

      // The rest of the flags are the agent's adapter's to say.
      expect(federation.source.sessions()).toEqual([
        expect.objectContaining({
          surface,
          capabilities: expect.objectContaining(capabilities)
        })
      ])
    }
  )

  it('keeps its records through a dropped stream, reconnects, and lets them go when the server stays away', async () => {
    vi.useFakeTimers()
    const { federation, streams } = federate()

    streams[0].handlers.onClose()

    expect(federation.covers('machine-7')).toBe(true)
    expect(listedIds(federation)).toEqual(['machine-7:claude:abc'])

    await vi.advanceTimersToNextTimerAsync()
    expect(streams).toHaveLength(2)
    streams[1].handlers.onFrame(
      ready([serverChat({ id: 'local:claude:new', providerSessionId: 'new' })])
    )
    expect(listedIds(federation)).toEqual(['machine-7:claude:new'])

    streams[1].handlers.onClose()
    for (const attempt of [2, 3, 4]) {
      await vi.advanceTimersToNextTimerAsync()
      expect(listedIds(federation)).toEqual(['machine-7:claude:new'])
      streams[attempt].handlers.onError({ code: 'unreachable', message: 'No route to kessel-ml' })
    }

    expect(listedIds(federation)).toEqual([])
    expect(federation.covers('machine-7')).toBe(true)
    expect(federation.notice('machine-7')).toBe('No route to kessel-ml')

    federation.stop()
    expect(streams.map((stream) => stream.closed)).toEqual([true, true, true, true, true])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("a server chat's transcript", () => {
  const row = (id: string, role: string, text: string): Record<string, unknown> => ({
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: 1000,
    source: 'transcript'
  })
  const ASKED = row('m1', 'user', 'Fix the build')
  const REPLIED = row('m2', 'assistant', 'Done.')

  it('reads a page and the rows after a cursor from the server, under the desktop id', async () => {
    const { federation, calls, answers } = federate()
    answers.set('liveSessions.transcript', () =>
      ok({
        sessionId: 'local:claude:abc',
        messages: [ASKED, { id: 'm9', role: 'assistant' }, REPLIED],
        cursor: 9,
        start: 4,
        more: true
      })
    )
    answers.set('liveSessions.transcriptSince', () =>
      ok({ messages: [REPLIED], cursor: 12, shrank: false })
    )

    expect(await federation.transcripts.page('machine-7:claude:abc', 9, 50)).toEqual({
      sessionId: 'machine-7:claude:abc',
      messages: [ASKED, REPLIED],
      cursor: 9,
      start: 4,
      more: true
    })
    expect(await federation.transcripts.since('machine-7:claude:abc', 9)).toEqual({
      messages: [REPLIED],
      cursor: 12,
      shrank: false
    })
    expect(calls).toEqual([
      {
        environmentId: 'env-1',
        method: 'liveSessions.transcript',
        params: { sessionId: 'local:claude:abc', before: 9, limit: 50 }
      },
      {
        environmentId: 'env-1',
        method: 'liveSessions.transcriptSince',
        params: { sessionId: 'local:claude:abc', cursor: 9 }
      }
    ])
  })

  it('follows the server watch and picks it up from the last cursor after a drop', async () => {
    vi.useFakeTimers()
    const { federation, streams } = federate()
    const deltas: unknown[] = []

    const watch = federation.transcripts.watch('machine-7:claude:abc', null, (delta) =>
      deltas.push(delta)
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(streams[1]).toMatchObject({
      method: 'liveSessions.watchTranscript',
      params: { sessionId: 'local:claude:abc', fromCursor: null }
    })
    streams[1].handlers.onFrame({
      type: 'ready',
      subscriptionId: 'live-transcript-1',
      page: { sessionId: 'local:claude:abc', messages: [ASKED], cursor: 3, start: 0, more: false }
    })
    expect(await watch.ready).toEqual({
      sessionId: 'machine-7:claude:abc',
      messages: [ASKED],
      cursor: 3,
      start: 0,
      more: false
    })

    streams[1].handlers.onFrame({
      type: 'delta',
      delta: { sessionId: 'local:claude:abc', from: 3, cursor: 5, messages: [REPLIED] }
    })
    expect(deltas).toEqual([
      { sessionId: 'machine-7:claude:abc', from: 3, cursor: 5, messages: [REPLIED] }
    ])

    streams[1].handlers.onClose()
    await vi.advanceTimersToNextTimerAsync()
    expect(streams[1].closed).toBe(true)
    expect(streams[2].params).toEqual({ sessionId: 'local:claude:abc', fromCursor: 5 })

    watch.unsubscribe()
    expect(streams[2].closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('answers a watcher whose first open failed, then gives the page once the server does', async () => {
    vi.useFakeTimers()
    const { federation, streams } = federate()
    const deltas: unknown[] = []

    const watch = federation.transcripts.watch('machine-7:claude:abc', null, (delta) =>
      deltas.push(delta)
    )
    await vi.advanceTimersByTimeAsync(0)
    streams[1].handlers.onError({ code: 'unreachable', message: 'No route to kessel-ml' })
    expect(await watch.ready).toEqual({
      sessionId: 'machine-7:claude:abc',
      messages: [],
      cursor: 0,
      start: 0,
      more: false
    })

    await vi.advanceTimersToNextTimerAsync()
    streams[2].handlers.onFrame({
      type: 'ready',
      subscriptionId: 'live-transcript-2',
      page: {
        sessionId: 'local:claude:abc',
        messages: [ASKED, REPLIED],
        cursor: 5,
        start: 0,
        more: false
      }
    })
    expect(deltas).toEqual([
      {
        sessionId: 'machine-7:claude:abc',
        from: 0,
        cursor: 5,
        messages: [ASKED, REPLIED],
        reset: true
      }
    ])

    federation.stop()
    expect(streams[2].closed).toBe(true)
  })
})
