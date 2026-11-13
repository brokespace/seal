import { useCallback, useSyncExternalStore } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { readLiveMessages, readLiveSessions } from './live-session-operations'
import {
  liveSessionsWatchFrameSchema,
  type LiveMessage,
  type LiveRegistryEvent,
  type LiveSession,
  type LiveSessionSnapshot
} from './live-session-schemas'

export type LiveSessionsFeedState = {
  loaded: boolean
  error: string | null
  sessions: LiveSession[]
  hostErrors: Record<string, string>
  messages: ReadonlyMap<string, LiveMessage>
  /** Old id to new: a fresh agent's id changes when its first prompt names it. */
  renamed: ReadonlyMap<string, string>
}

const EMPTY: LiveSessionsFeedState = {
  loaded: false,
  error: null,
  sessions: [],
  hostErrors: {},
  messages: new Map(),
  renamed: new Map()
}

const byRecency = (a: LiveSession, b: LiveSession) => b.lastActivityAt - a.lastActivityAt

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * One `liveSessions.watch` per host client, shared by every Seal screen showing sessions. Events
 * carry a revision; one that doesn't follow the last means one was missed, so the snapshot is read again.
 */
class LiveSessionsFeed {
  private state = EMPTY
  private revision = -1
  private readonly listeners = new Set<() => void>()
  private closeStream: (() => void) | null = null

  constructor(private readonly client: RpcClient) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.closeStream) {
      this.open()
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.closeStream?.()
        this.closeStream = null
      }
    }
  }

  readonly getState = (): LiveSessionsFeedState => this.state

  /** Re-reads the snapshot and outbox; reopens the stream if the host ended it. */
  async refresh(): Promise<void> {
    if (!this.closeStream && this.listeners.size > 0) {
      this.open()
    }
    try {
      const [snapshot, messages] = await Promise.all([
        readLiveSessions(this.client),
        readLiveMessages(this.client)
      ])
      this.acceptSnapshot(snapshot, messages)
    } catch (error) {
      this.set({ ...this.state, error: errorText(error) })
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

  private open(): void {
    this.closeStream = this.client.subscribe('liveSessions.watch', null, (raw) => {
      const parsed = liveSessionsWatchFrameSchema.safeParse(raw)
      if (!parsed.success) {
        return
      }
      const frame = parsed.data
      switch (frame.type) {
        case 'ready':
          this.acceptSnapshot(frame.snapshot, frame.messages)
          return
        case 'event':
          this.apply(frame.event)
          return
        case 'message':
          this.upsertMessage(frame.message)
          return
        case 'error':
          this.closeStream = null
          this.set({ ...this.state, error: frame.message ?? null })
          return
        case 'end':
          this.closeStream = null
      }
    })
  }

  private acceptSnapshot(snapshot: LiveSessionSnapshot, messages: readonly LiveMessage[]): void {
    this.revision = snapshot.revision
    this.set({
      ...this.state,
      loaded: true,
      error: null,
      sessions: [...snapshot.sessions].sort(byRecency),
      hostErrors: snapshot.hostErrors,
      messages: new Map(messages.map((m) => [m.messageId, m]))
    })
  }

  private apply(event: LiveRegistryEvent): void {
    if (event.type === 'snapshot') {
      this.revision = event.snapshot.revision
      this.set({
        ...this.state,
        loaded: true,
        sessions: [...event.snapshot.sessions].sort(byRecency),
        hostErrors: event.snapshot.hostErrors
      })
      return
    }
    if (event.revision <= this.revision) {
      return
    }
    if (event.revision !== this.revision + 1) {
      void this.refresh()
      return
    }
    this.revision = event.revision
    if (event.type === 'upsert') {
      const rest = this.state.sessions.filter((s) => s.id !== event.session.id)
      this.set({ ...this.state, sessions: [event.session, ...rest].sort(byRecency) })
    } else if (event.type === 'remove') {
      const renamed = event.replacedBy
        ? new Map(this.state.renamed).set(event.sessionId, event.replacedBy)
        : this.state.renamed
      this.set({
        ...this.state,
        renamed,
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

  private set(next: LiveSessionsFeedState): void {
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

// Kept per client while idle, so a screen opened again draws the last state until the stream's ready frame.
const feeds = new WeakMap<RpcClient, LiveSessionsFeed>()

function feedFor(client: RpcClient): LiveSessionsFeed {
  let feed = feeds.get(client)
  if (!feed) {
    feed = new LiveSessionsFeed(client)
    feeds.set(client, feed)
  }
  return feed
}

const noSubscription = () => () => {}
const emptyState = () => EMPTY

/** The id a session goes by now, following renames. */
export function currentLiveSessionId(state: LiveSessionsFeedState, sessionId: string): string {
  let id = sessionId
  for (let hops = 0; hops < 8; hops++) {
    const next = state.renamed.get(id)
    if (!next) {
      break
    }
    id = next
  }
  return id
}

export function useLiveSessionsFeed(client: RpcClient | null): LiveSessionsFeedState & {
  refresh: () => Promise<void>
  upsertMessage: (message: LiveMessage) => void
} {
  const feed = client ? feedFor(client) : null
  const state = useSyncExternalStore(
    feed ? feed.subscribe : noSubscription,
    feed ? feed.getState : emptyState
  )
  const refresh = useCallback(async () => {
    await feed?.refresh()
  }, [feed])
  const upsertMessage = useCallback((message: LiveMessage) => feed?.upsertMessage(message), [feed])
  return { ...state, refresh, upsertMessage }
}
