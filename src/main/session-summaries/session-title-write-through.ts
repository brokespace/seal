import { randomUUID } from 'node:crypto'
import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import { liveSessionSurfaceOf } from '../../shared/live-sessions/live-session-surface'
import type {
  AgentSessionSurface,
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'

type ChatName = { name: string | null; user: boolean }

export type SessionTitleWriteThroughDeps = {
  /** The chat's own name: `user` when the user gave it (not auto-named). Null when this host does not hold the chat. */
  chatName: (chatSessionId: string) => ChatName | null
  /** Names the chat as its user. Resolves false when it did not apply: the host refuses an empty name. */
  renameChat: (chatSessionId: string, name: string) => Promise<boolean>
  /** The chat's name may have changed (it was renamed in its tab, or auto-named). */
  subscribeChatNames: (listener: (chatSessionId: string) => void) => () => void
  /** Sets a CLI pane's terminal tab title; null goes back to the tab's own title. */
  renameCliTab: (paneKey: string, title: string | null) => void
  /** Saves the session's custom title in Seal (the annotation). */
  annotate: (sessionId: string, customTitle: string | null) => void
  log?: (message: string, error?: unknown) => void
}

type Agreed = {
  /** The custom title the row and the session's owner last agreed on. */
  title: string | null
  /** The chat or pane the session runs on; one that moves to another is met afresh. */
  owner: string
  /** The row title an annotation of ours replaces, until the registry publishes ours. */
  replacing?: string | null
  /** A chat this host does not hold yet: nothing is agreed, `title` is only the row's. */
  unheld?: true
}

function chatOwner(chatSessionId: string): string {
  return `chat:${chatSessionId}`
}

function ownerOf(surface: AgentSessionSurface): string {
  if (surface.kind === 'chat') {
    return chatOwner(surface.sessionId)
  }
  return surface.kind === 'cli' ? `cli:${surface.paneKey}` : 'external'
}

/** Only a name the user gave is a custom title; an automatic one stays the chat's own. */
function userGivenName(chat: ChatName): string | null {
  return (chat.user && chat.name) || null
}

/**
 * Keeps a session's row and its tab under one name. A rename on the row goes to whoever owns the
 * session (its chat, its terminal tab), and a chat renamed in its tab renames its row.
 */
export class SessionTitleWriteThrough {
  private readonly agreed = new Map<string, Agreed>()
  /** Renames of ours in flight, by chat. */
  private readonly renaming = new Map<string, number>()
  private stopWatchingChats: (() => void) | null = null

  constructor(private readonly deps: SessionTitleWriteThroughDeps) {}

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'snapshot') {
      for (const session of event.snapshot.sessions) {
        this.sighted(session)
      }
    } else if (event.type === 'upsert') {
      this.sighted(event.session)
    } else if (event.type === 'remove') {
      const known = this.agreed.get(event.sessionId)
      this.agreed.delete(event.sessionId)
      // The successor's own sighting, when the registry published it first, is the newer word.
      if (known && event.replacedBy && !this.agreed.has(event.replacedBy)) {
        this.agreed.set(event.replacedBy, known)
      }
    }
  }

  dispose(): void {
    this.stopWatchingChats?.()
    this.stopWatchingChats = null
    this.agreed.clear()
    this.renaming.clear()
  }

  private sighted(session: LiveSession): void {
    const surface = liveSessionSurfaceOf(session)
    const owner = ownerOf(surface)
    const title = session.customTitle?.trim() || null
    if (surface.kind === 'chat') {
      // Not at construction: the structured host is installed with the first chat.
      this.stopWatchingChats ??= this.deps.subscribeChatNames((chat) => this.chatNameChanged(chat))
    }
    const known = this.agreed.get(session.id)
    if (!known || known.owner !== owner || known.unheld) {
      this.firstSighting(session.id, surface.kind === 'chat' ? surface.sessionId : null, {
        title,
        owner
      })
      return
    }
    if (title === known.title) {
      delete known.replacing
      return
    }
    // A republish from before our annotation landed is not the user naming the row back.
    if (title === known.replacing) {
      return
    }
    known.title = title
    delete known.replacing
    if (surface.kind === 'chat') {
      this.renameChat(surface.sessionId, title ?? '')
    } else if (surface.kind === 'cli') {
      this.deps.renameCliTab(surface.paneKey, title)
    }
  }

  /** A tab keeps the title it had before Seal first saw its session; only a chat is brought to agree. */
  private firstSighting(recordId: string, chatSessionId: string | null, row: Agreed): void {
    this.agreed.set(recordId, row)
    if (chatSessionId === null) {
      return
    }
    const chat = this.deps.chatName(chatSessionId)
    if (!chat) {
      row.unheld = true
      return
    }
    const name = userGivenName(chat)
    if (name !== null) {
      this.nameRow(recordId, row, name)
    } else if (row.title !== null) {
      // A row named before row names reached chats.
      this.renameChat(chatSessionId, row.title)
    }
  }

  private chatNameChanged(chatSessionId: string): void {
    const chat = this.renaming.has(chatSessionId) ? null : this.deps.chatName(chatSessionId)
    if (!chat) {
      return
    }
    const owner = chatOwner(chatSessionId)
    for (const [recordId, known] of this.agreed) {
      if (known.owner !== owner) {
        continue
      }
      if (known.unheld) {
        this.firstSighting(recordId, chatSessionId, { title: known.title, owner })
      } else {
        this.nameRow(recordId, known, userGivenName(chat))
      }
    }
  }

  private nameRow(recordId: string, known: Agreed, title: string | null): void {
    if (known.title === title) {
      return
    }
    if (known.replacing === undefined) {
      known.replacing = known.title
    }
    known.title = title
    this.deps.annotate(recordId, title)
  }

  private renameChat(chatSessionId: string, name: string): void {
    this.renaming.set(chatSessionId, (this.renaming.get(chatSessionId) ?? 0) + 1)
    void this.deps
      .renameChat(chatSessionId, name)
      .catch((error: unknown) => this.deps.log?.('[session-titles] renaming a chat failed', error))
      .then(() => {
        const left = (this.renaming.get(chatSessionId) ?? 1) - 1
        if (left > 0) {
          this.renaming.set(chatSessionId, left)
          return
        }
        this.renaming.delete(chatSessionId)
        // Whatever the host made of the name (refused it, trimmed it), the row takes the chat's.
        this.chatNameChanged(chatSessionId)
      })
  }
}

function chatsNamedIn(event: AgentSessionStatusEvent): Set<string> {
  if (event.type === 'status') {
    return new Set([event.session.sessionId])
  }
  if (event.type !== 'snapshot') {
    return new Set()
  }
  // A rename reaches a chat with no status row only through `conversationNames`.
  return new Set(
    [...event.sessions, ...(event.conversationNames ?? [])].map((chat) => chat.sessionId)
  )
}

/** Chat names from the structured host installed now; `follow` moves to one installed since. */
function followStructuredChatNames(
  listener: (chatSessionId: string) => void,
  log?: (message: string, error?: unknown) => void
): { follow: () => void; stop: () => void } {
  const id = `session-titles:${randomUUID()}`
  let host: StructuredAgentSessionHost | null = null
  let release: (() => void) | null = null
  const emit = (event: AgentSessionStatusEvent): void => {
    try {
      chatsNamedIn(event).forEach(listener)
    } catch (error) {
      // The feed drops a subscriber that throws.
      log?.('[session-titles] reading a chat name failed', error)
    }
  }
  const follow = (): void => {
    const current = getStructuredAgentSessionHost()
    if (current === host) {
      return
    }
    release?.()
    host = current
    release = current?.subscribeStatus({ id, emit }) ?? null
  }
  follow()
  return {
    follow,
    stop: () => {
      release?.()
      release = null
      host = null
    }
  }
}

/** Session titles on this host, written through to the chats and terminal tabs that own them. */
export function createSessionTitleWriteThrough(options: {
  liveSessions: Pick<LiveSessionService, 'annotate' | 'subscribe' | 'snapshot'>
  /** The pane's worktree and tab, to rename its terminal tab. */
  renameCliTab: (paneKey: string, title: string | null) => void
  log?: (message: string, error?: unknown) => void
}): { dispose: () => void } {
  const { liveSessions, log } = options
  let chatNames: ReturnType<typeof followStructuredChatNames> | null = null
  const titles = new SessionTitleWriteThrough({
    chatName: (chatSessionId) => {
      const record = getStructuredAgentSessionHost()?.deps.store.getRecord(chatSessionId)
      return record
        ? {
            name: record.conversationName ?? null,
            user: record.conversationNameSource === 'user'
          }
        : null
    },
    renameChat: async (chatSessionId, name) => {
      const host = getStructuredAgentSessionHost()
      return (await host?.setUserConversationName(chatSessionId, name, 'rename'))?.applied === true
    },
    subscribeChatNames: (listener) => {
      chatNames = followStructuredChatNames(listener, log)
      return chatNames.stop
    },
    renameCliTab: options.renameCliTab,
    annotate: (sessionId, customTitle) =>
      void liveSessions
        .annotate({ sessionId, customTitle })
        .catch((error: unknown) => log?.('[session-titles] saving a session title failed', error)),
    log
  })
  const observe = (event: LiveSessionRegistryEvent): void => {
    // The structured host is installed and replaced without notice; every registry event checks.
    chatNames?.follow()
    titles.observe(event)
  }
  observe({ type: 'snapshot', snapshot: liveSessions.snapshot() })
  const release = liveSessions.subscribe(observe)
  return {
    dispose: () => {
      release()
      titles.dispose()
    }
  }
}
