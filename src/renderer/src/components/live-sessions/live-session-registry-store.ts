import { useSyncExternalStore } from 'react'
import { isProvisionalLiveSessionId } from '../../../../shared/live-sessions/live-session-provisional-id'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot
} from '../../../../shared/live-sessions/live-session-types'
import { isSessionRenamedTo } from '../../../../shared/live-sessions/session-succession'

export type LiveSessionsState = {
  loaded: boolean
  sessions: LiveSession[]
  hostErrors: LiveSessionRegistrySnapshot['hostErrors']
  messages: ReadonlyMap<string, LiveMessage>
}

/**
 * The list with `session` in it, newest activity first. A rename reaches this window as the new
 * record and then the removal of the made-up id: the new record alone is that session from the start.
 */
export function upsertLiveSession(
  sessions: readonly LiveSession[],
  session: LiveSession
): LiveSession[] {
  const rest = sessions.filter(
    (listed) =>
      listed.id !== session.id &&
      !(isProvisionalLiveSessionId(listed.providerSessionId) && isSessionRenamedTo(listed, session))
  )
  return [session, ...rest].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

const EMPTY: LiveSessionsState = {
  loaded: false,
  sessions: [],
  hostErrors: {},
  messages: new Map()
}

/**
 * Mirrors the main-process registry and outbox. Events carry a revision; one that doesn't follow
 * the last means one was missed, so the whole snapshot is fetched again.
 */
class LiveSessionRegistryStore {
  private state = EMPTY
  private revision = -1
  private readonly listeners = new Set<() => void>()
  private teardown: (() => void) | null = null
  private readonly renamed = new Map<string, string>()
  private readonly renameListeners = new Set<(from: string, to: string) => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.teardown) {
      this.connect()
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.teardown?.()
        this.teardown = null
      }
    }
  }

  readonly getState = (): LiveSessionsState => this.state

  /** Views holding a session id (tabs, picks, read marks) follow it to its new id. */
  onRename(listener: (fromSessionId: string, toSessionId: string) => void): () => void {
    this.renameListeners.add(listener)
    return () => this.renameListeners.delete(listener)
  }

  /** The id a session goes by now: a fresh agent's id changes when its first prompt names it. */
  currentId(sessionId: string): string {
    let id = sessionId
    for (let hops = 0; hops < 8 && this.renamed.has(id); hops++) {
      id = this.renamed.get(id)!
    }
    return id
  }

  private connect(): void {
    const api = window.api?.liveSessions
    if (!api?.onEvent) {
      return
    }
    const offEvent = api.onEvent((event) => this.apply(event))
    const offMessage = api.onMessage((message) => this.upsertMessage(message))
    this.teardown = () => {
      offEvent()
      offMessage()
    }
    void this.reload()
  }

  private async reload(): Promise<void> {
    const api = window.api.liveSessions
    const [snapshot, messages] = await Promise.all([api.snapshot(), api.messages()]).catch(
      () => [null, null] as const
    )
    if (!snapshot || !messages) {
      return
    }
    this.revision = snapshot.revision
    this.set({
      loaded: true,
      sessions: snapshot.sessions,
      hostErrors: snapshot.hostErrors,
      messages: new Map(messages.map((m) => [m.messageId, m]))
    })
  }

  private apply(event: LiveSessionRegistryEvent): void {
    if (event.type === 'snapshot') {
      this.revision = event.snapshot.revision
      this.set({
        ...this.state,
        loaded: true,
        sessions: event.snapshot.sessions,
        hostErrors: event.snapshot.hostErrors
      })
      return
    }
    if (event.revision <= this.revision) {
      return
    }
    if (event.revision !== this.revision + 1) {
      void this.reload()
      return
    }
    this.revision = event.revision
    if (event.type === 'upsert') {
      this.set({
        ...this.state,
        sessions: upsertLiveSession(this.state.sessions, event.session)
      })
    } else if (event.type === 'remove') {
      if (event.replacedBy) {
        this.renamed.set(event.sessionId, event.replacedBy)
        for (const listener of this.renameListeners) {
          listener(event.sessionId, event.replacedBy)
        }
      }
      this.set({
        ...this.state,
        sessions: this.state.sessions.filter((s) => s.id !== event.sessionId)
      })
    } else {
      const hostErrors = { ...this.state.hostErrors }
      if (event.error) {
        hostErrors[event.hostId] = event.error
      } else {
        delete hostErrors[event.hostId]
      }
      this.set({ ...this.state, hostErrors })
    }
  }

  upsertMessage(message: LiveMessage): void {
    const current = this.state.messages.get(message.messageId)
    if (current && current.updatedAt > message.updatedAt) {
      return
    }
    const messages = new Map(this.state.messages)
    messages.set(message.messageId, message)
    this.set({ ...this.state, messages })
  }

  private set(next: LiveSessionsState): void {
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const liveSessionRegistryStore = new LiveSessionRegistryStore()

export function useLiveSessions(): LiveSessionsState {
  return useSyncExternalStore(liveSessionRegistryStore.subscribe, liveSessionRegistryStore.getState)
}
