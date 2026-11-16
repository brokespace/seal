import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import type {
  AgentSessionSurface,
  LiveSession,
  LiveSessionAnnotation,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import {
  createSessionTitleWriteThrough,
  SessionTitleWriteThrough
} from './session-title-write-through'

type SavedName = { conversationName?: string; conversationNameSource?: 'user' }

/** What the write-through reads of the structured host; the real one is a class no double can be. */
type ChatHostDouble = {
  deps: { store: { getRecord: (sessionId: string) => SavedName | null } }
  subscribeStatus: (subscriber: {
    id: string
    emit: (event: AgentSessionStatusEvent) => void
  }) => () => void
  setUserConversationName: (
    sessionId: string,
    name: string,
    write: string
  ) => Promise<{ name: string; applied: boolean }>
}

const structuredHost = vi.hoisted((): { installed: ChatHostDouble | null } => ({
  installed: null
}))

vi.mock('../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => structuredHost.installed
}))

const CHAT: AgentSessionSurface = { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-chat-1' }
const CLI: AgentSessionSurface = { kind: 'cli', paneKey: 'tab-1:leaf-1' }
const EXTERNAL: AgentSessionSurface = { kind: 'external' }

function session(
  surface: AgentSessionSurface,
  customTitle: string | null = null,
  overrides: Partial<LiveSession> = {}
): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: surface.kind === 'external' ? 'external' : 'seal',
    cwd: '/repo',
    project: 'repo',
    title: 'Why does login fail',
    status: 'your-turn',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [],
    permission: null,
    surface,
    ...(customTitle ? { customTitle } : {}),
    ...overrides
  }
}

const upsert = (next: LiveSession): LiveSessionRegistryEvent => ({
  type: 'upsert',
  revision: 1,
  session: next
})

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

type ChatName = { name: string | null; user: boolean }

function harness(chats: Record<string, ChatName> = {}) {
  const calls: unknown[][] = []
  const names = new Map(Object.entries(chats))
  const listeners = new Set<(chatSessionId: string) => void>()
  const held: { apply: (applied: boolean) => void; fail: (error: Error) => void }[] = []
  let holding = false
  const nameChat = (chatSessionId: string, name: string | null, user = true) => {
    names.set(chatSessionId, { name, user })
    for (const listener of listeners) {
      listener(chatSessionId)
    }
  }
  const titles = new SessionTitleWriteThrough({
    chatName: (chatSessionId) => names.get(chatSessionId) ?? null,
    renameChat: (chatSessionId, name) => {
      calls.push(['renameChat', chatSessionId, name])
      if (holding) {
        return new Promise<boolean>((apply, fail) => held.push({ apply, fail }))
      }
      // As the structured host does: no empty names, and the name is announced before the call returns.
      if (!name) {
        return Promise.resolve(false)
      }
      nameChat(chatSessionId, name)
      return Promise.resolve(true)
    },
    subscribeChatNames: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    renameCliTab: (paneKey, title) => void calls.push(['renameCliTab', paneKey, title]),
    annotate: (sessionId, customTitle) => void calls.push(['annotate', sessionId, customTitle])
  })
  return {
    titles,
    calls,
    listeners,
    held,
    nameChat,
    holdRenames: () => {
      holding = true
    },
    see: (
      surface: AgentSessionSurface,
      customTitle?: string | null,
      overrides?: Partial<LiveSession>
    ) => titles.observe(upsert(session(surface, customTitle, overrides)))
  }
}

describe('SessionTitleWriteThrough', () => {
  it('renames the chat when its row is renamed', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.see(CHAT)

    h.see(CHAT, 'Fix the build')
    await settle()

    expect(h.calls).toEqual([['renameChat', 'chat-1', 'Fix the build']])
  })

  it('puts the chat name back on a row whose name was cleared, since a chat keeps its name', async () => {
    const h = harness({ 'chat-1': { name: 'Fix the build', user: true } })
    h.see(CHAT, 'Fix the build')

    h.see(CHAT, null)
    await settle()

    expect(h.calls).toEqual([
      ['renameChat', 'chat-1', ''],
      ['annotate', 'local:claude:abc', 'Fix the build']
    ])
  })

  it('renames the terminal tab when a CLI row is renamed, and resets it when the name is cleared', () => {
    const h = harness()
    h.see(CLI)

    h.see(CLI, 'Deploy script')
    h.see(CLI, null)

    expect(h.calls).toEqual([
      ['renameCliTab', 'tab-1:leaf-1', 'Deploy script'],
      ['renameCliTab', 'tab-1:leaf-1', null]
    ])
  })

  it('leaves an external session to its annotation', () => {
    const h = harness()
    h.see(EXTERNAL)

    h.see(EXTERNAL, 'Nightly import')

    expect(h.calls).toEqual([])
  })

  it('does not retitle the tab of a session it sees for the first time', () => {
    const h = harness()

    h.see(CLI, 'Deploy script')
    h.see(EXTERNAL, 'Nightly import', { id: 'local:codex:def' })

    expect(h.calls).toEqual([])
  })

  it('carries a row name from before to a chat the user never named', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })

    h.see(CHAT, 'Fix the build')
    await settle()

    expect(h.calls).toEqual([['renameChat', 'chat-1', 'Fix the build']])
  })

  it('names the row after a chat the user already named', () => {
    const h = harness({
      'chat-1': { name: 'Ship it', user: true },
      'chat-2': { name: 'Tidy imports', user: true }
    })

    h.see(CHAT, 'Fix the build')
    h.see({ kind: 'chat', sessionId: 'chat-2', tabId: 'tab-chat-2' }, null, {
      id: 'local:codex:def'
    })

    expect(h.calls).toEqual([
      ['annotate', 'local:claude:abc', 'Ship it'],
      ['annotate', 'local:codex:def', 'Tidy imports']
    ])
  })

  it('renames the row when the chat is renamed in its tab', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.see(CHAT)

    h.nameChat('chat-1', 'Ship it')
    h.see(CHAT, 'Ship it')
    await settle()

    expect(h.calls).toEqual([['annotate', 'local:claude:abc', 'Ship it']])
  })

  it('leaves the row alone when the chat is named automatically', () => {
    const h = harness({ 'chat-1': { name: null, user: false } })
    h.see(CHAT)

    h.nameChat('chat-1', 'Login bug', false)

    expect(h.calls).toEqual([])
  })

  it('reads a republish from before its annotation landed as old news, not as a rename', async () => {
    const h = harness({ 'chat-1': { name: 'Fix the build', user: true } })
    h.see(CHAT, 'Fix the build')
    h.nameChat('chat-1', 'Ship it')

    h.see(CHAT, 'Fix the build', { status: 'working' })
    h.see(CHAT, 'Ship it', { status: 'working' })
    await settle()
    expect(h.calls).toEqual([['annotate', 'local:claude:abc', 'Ship it']])

    h.see(CHAT, 'Fix the build', { status: 'working' })
    await settle()
    expect(h.calls).toEqual([
      ['annotate', 'local:claude:abc', 'Ship it'],
      ['renameChat', 'chat-1', 'Fix the build']
    ])
  })

  it('ignores the chat while a rename of it is on its way', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.holdRenames()
    h.see(CHAT)
    h.see(CHAT, 'Fix the build')

    h.nameChat('chat-1', 'Login failure', false)
    h.nameChat('chat-1', 'Fix the build')
    h.held[0].apply(true)
    await settle()

    expect(h.calls).toEqual([['renameChat', 'chat-1', 'Fix the build']])
  })

  it('takes the row name back when the rename fails', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.holdRenames()
    h.see(CHAT)
    h.see(CHAT, 'Fix the build')

    h.held[0].fail(new Error('store closed'))
    await settle()

    expect(h.calls).toEqual([
      ['renameChat', 'chat-1', 'Fix the build'],
      ['annotate', 'local:claude:abc', null]
    ])
  })

  it('waits for the last of several renames before reading the chat name', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.holdRenames()
    h.see(CHAT)
    h.see(CHAT, 'Fix the build')
    h.see(CHAT, 'Fix the tests')

    h.nameChat('chat-1', 'Fix the build')
    h.held[0].apply(true)
    await settle()
    h.nameChat('chat-1', 'Fix the tests')
    h.held[1].apply(true)
    await settle()

    expect(h.calls).toEqual([
      ['renameChat', 'chat-1', 'Fix the build'],
      ['renameChat', 'chat-1', 'Fix the tests']
    ])
  })

  it('keeps what was agreed when a session gets its lasting id', () => {
    const h = harness()
    h.see(CLI, 'Deploy script', { id: 'local:claude:pid-42' })

    h.titles.observe({
      type: 'remove',
      revision: 2,
      sessionId: 'local:claude:pid-42',
      replacedBy: 'local:claude:abc'
    })
    h.see(CLI, 'Release script')

    expect(h.calls).toEqual([['renameCliTab', 'tab-1:leaf-1', 'Release script']])
  })

  it('brings a named session to agree with the chat it moves into', async () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.see(EXTERNAL, 'Fix the build')

    h.see(CHAT, 'Fix the build')
    await settle()

    expect(h.calls).toEqual([['renameChat', 'chat-1', 'Fix the build']])
  })

  it('leaves a chat this host does not hold alone until it holds it', async () => {
    const h = harness()
    h.see(CHAT, 'Fix the build')
    h.see(CHAT, 'Ship it')
    await settle()
    expect(h.calls).toEqual([])

    h.nameChat('chat-1', 'Login bug', false)
    await settle()

    expect(h.calls).toEqual([['renameChat', 'chat-1', 'Ship it']])
  })

  it('stops following chat names once disposed', () => {
    const h = harness({ 'chat-1': { name: 'Login bug', user: false } })
    h.see(CHAT)

    h.titles.dispose()
    h.nameChat('chat-1', 'Ship it')

    expect(h.listeners.size).toBe(0)
    expect(h.calls).toEqual([])
  })
})

describe('createSessionTitleWriteThrough', () => {
  function liveSessions(sessions: LiveSession[]) {
    const listeners = new Set<(event: LiveSessionRegistryEvent) => void>()
    return {
      annotate: vi.fn(async (_annotation: LiveSessionAnnotation) => {}),
      subscribe: (listener: (event: LiveSessionRegistryEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      snapshot: () => ({ revision: 0, sessions, hostErrors: {} }),
      emit: (event: LiveSessionRegistryEvent) => listeners.forEach((listener) => listener(event))
    }
  }

  function installChatHost(records: Map<string, SavedName>) {
    const subscribers = new Map<string, (event: AgentSessionStatusEvent) => void>()
    const setUserConversationName = vi.fn(async (sessionId: string, name: string) => {
      records.set(sessionId, { conversationName: name, conversationNameSource: 'user' })
      return { name, applied: true }
    })
    structuredHost.installed = {
      deps: { store: { getRecord: (sessionId) => records.get(sessionId) ?? null } },
      subscribeStatus: (subscriber) => {
        subscribers.set(subscriber.id, subscriber.emit)
        return () => subscribers.delete(subscriber.id)
      },
      setUserConversationName
    }
    return {
      setUserConversationName,
      publish: (event: AgentSessionStatusEvent) => subscribers.forEach((emit) => emit(event))
    }
  }

  afterEach(() => {
    structuredHost.installed = null
  })

  it('renames the chat on the structured host when its row is renamed', async () => {
    const host = installChatHost(new Map([['chat-1', { conversationName: 'Login bug' }]]))
    const live = liveSessions([session(CHAT)])
    const titles = createSessionTitleWriteThrough({ liveSessions: live, renameCliTab: vi.fn() })

    live.emit(upsert(session(CHAT, 'Fix the build')))
    await settle()
    titles.dispose()

    expect(host.setUserConversationName.mock.calls).toEqual([['chat-1', 'Fix the build', 'rename']])
  })

  it('renames the row after a tab rename on a host installed after the chat was listed', () => {
    const live = liveSessions([session(CHAT)])
    const titles = createSessionTitleWriteThrough({ liveSessions: live, renameCliTab: vi.fn() })
    const records = new Map<string, SavedName>([['chat-1', { conversationName: 'Login bug' }]])
    const host = installChatHost(records)
    live.emit(upsert(session(CHAT, null, { status: 'working' })))

    records.set('chat-1', { conversationName: 'Ship it', conversationNameSource: 'user' })
    host.publish({
      type: 'snapshot',
      sessions: [],
      conversationNames: [{ sessionId: 'chat-1', conversationName: 'Ship it' }]
    })
    titles.dispose()

    expect(live.annotate.mock.calls).toEqual([
      [{ sessionId: 'local:claude:abc', customTitle: 'Ship it' }]
    ])
  })
})
