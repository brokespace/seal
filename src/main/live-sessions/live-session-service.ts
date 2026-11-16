import { join } from 'node:path'
import { hostname } from 'node:os'
import type {
  LiveSession,
  LiveMessage,
  LivePermissionAnswer,
  LivePermissionAnswerResult,
  LiveSendRequest,
  LiveSessionAnnotation,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTakeOverResult,
  LiveTranscriptPage,
  LiveRemoveRequest,
  LiveRemoveResult
} from '../../shared/live-sessions/live-session-types'
import { LiveSessionRegistry, type LiveSessionRegistryDeps } from './live-session-registry'
import {
  LiveTranscriptStreams,
  type LiveTranscriptSubscription
} from './transcripts/live-transcript-streams'
import { SessionInputRoutes, type SealPaneInput } from './delivery/session-input-routes'
import { LiveMessageOutbox } from './delivery/live-message-outbox'
import { userTextsFrom, type UserText } from './delivery/transcript-user-texts'
import { LOCAL_HOST_ID, type LiveSessionHost } from './hosts/live-session-hosts'
import type { SealPane } from './seal-panes/seal-pane-sessions'
import { takeOverSession } from './delivery/session-take-over'
import { LiveSessionRemovals, removeFromOwner } from './delivery/session-removal'
import { LiveSessionAnnotations } from './live-session-annotations'
import type { StructuredSessionAccess } from './sources/structured-session-source'
import { SessionTranscriptAccess } from './session-transcript-access'
import { localChatSessionId } from '../../shared/live-sessions/live-session-paired-server'
import type { FederatedSessions } from './federation/federated-sessions'

export type LiveSessionServiceDeps = {
  userDataPath: string
  hosts: () => LiveSessionHost[]
  sealPanes?: {
    panes: () => SealPane[]
    input: SealPaneInput
    subscribe: (onChange: () => void) => () => void
    confirmAgent?: (paneKey: string) => void
  }
  /** This machine's chats; absent where no structured host runs. */
  chats?: StructuredSessionAccess
  /** Paired servers' own registries; absent on a server, which has none. */
  federation?: FederatedSessions
  onHostScanned?: LiveSessionRegistryDeps['onHostScanned']
  log?: (message: string, error?: unknown) => void
}

/**
 * The main-process session API other features consume (home overview, home chat, mobile RPC):
 * a registry of live sessions, their transcripts as resumable streams, and confirmed sends.
 */
export class LiveSessionService {
  readonly registry: LiveSessionRegistry
  readonly streams: LiveTranscriptStreams
  private readonly transcripts: SessionTranscriptAccess
  private readonly routes: SessionInputRoutes
  private readonly outbox: LiveMessageOutbox
  private readonly messageListeners = new Set<(message: LiveMessage) => void>()
  private readonly removals: LiveSessionRemovals
  private readonly annotations: LiveSessionAnnotations
  private readonly chats: StructuredSessionAccess | null
  private readonly federation: FederatedSessions | null

  constructor(deps: LiveSessionServiceDeps) {
    this.chats = deps.chats ?? null
    this.federation = deps.federation ?? null
    this.annotations = new LiveSessionAnnotations(
      join(deps.userDataPath, 'live-sessions', 'annotations.json'),
      deps.log
    )
    this.removals = new LiveSessionRemovals(
      join(deps.userDataPath, 'live-sessions', 'removed.json'),
      deps.log
    )
    this.registry = new LiveSessionRegistry({
      isRemoved: (session) => this.removals.has(session.id),
      annotate: (session) => this.annotations.apply(session),
      localMachine: { hostId: LOCAL_HOST_ID, label: hostname(), kind: 'local' },
      hosts: deps.hosts,
      sealPanes: () => deps.sealPanes?.panes() ?? [],
      subscribeSealPanes: deps.sealPanes?.subscribe,
      confirmSealPaneAgent: deps.sealPanes?.confirmAgent,
      chats: deps.chats?.source,
      federation: deps.federation,
      onHostScanned: deps.onHostScanned,
      log: deps.log
    })
    this.streams = new LiveTranscriptStreams(this.registry, { log: deps.log })
    this.transcripts = new SessionTranscriptAccess({
      session: (sessionId) => this.registry.get(sessionId),
      // Only a chat: a server's CLI session keeps a file this Seal already reads through its host.
      server: (sessionId) =>
        this.registry.get(sessionId)?.surface.kind === 'chat'
          ? (this.federated(sessionId)?.transcripts ?? null)
          : null,
      files: this.streams,
      onSessionsChanged: (listener) => this.registry.subscribe(listener),
      log: deps.log
    })
    this.routes = new SessionInputRoutes({
      host: (hostId) => this.registry.host(hostId),
      sealPanes: deps.sealPanes?.input ?? null,
      structured: deps.chats?.input ?? null
    })
    this.outbox = new LiveMessageOutbox({
      storePath: join(deps.userDataPath, 'live-sessions', 'outbox.json'),
      getSession: (id) => this.registry.get(id),
      attempt: (session, route, text, messageId, signal) =>
        this.routes.attempt(session, route, text, messageId, signal),
      transcriptSize: async (session) => {
        const chat = localChatSessionId(session)
        if (chat !== null) {
          return (await this.chats?.journalSize(chat)) ?? 0
        }
        const found = this.streams.source(session.id)
        return found ? (await found.source.read(0, 0)).size : 0
      },
      userTexts: (session, from) => this.userTexts(session, from),
      onChange: (message) => {
        this.emitMessage(message)
        if (message.state === 'sent') {
          void this.registry.refresh(this.registry.get(message.sessionId)?.machine.hostId)
        }
      },
      log: deps.log
    })
  }

  start(): void {
    this.registry.subscribe((event) => {
      if (event.type === 'remove' && event.replacedBy) {
        this.outbox.renameSession(event.sessionId, event.replacedBy)
        this.annotations.move(event.sessionId, event.replacedBy)
        this.registry.republish()
      }
    })
    // Removed sessions must not flash back in, nor renamed ones lose their name, before both are read.
    void Promise.allSettled([this.removals.load(), this.annotations.load()]).then(() =>
      this.registry.start()
    )
    void this.outbox.start()
    this.federation?.subscribeMessages((message) => this.emitMessage(message))
  }

  stop(): void {
    this.registry.stop()
    this.outbox.stop()
    this.federation?.stop()
    this.chats?.dispose()
  }

  private emitMessage(message: LiveMessage): void {
    for (const listener of this.messageListeners) {
      listener(message)
    }
  }

  snapshot(): LiveSessionRegistrySnapshot {
    return this.registry.getSnapshot()
  }

  subscribe(listener: (event: LiveSessionRegistryEvent) => void): () => void {
    return this.registry.subscribe(listener)
  }

  refresh(hostId?: string): Promise<void> {
    return this.registry.refresh(hostId)
  }

  transcriptPage(
    sessionId: string,
    before: LiveTranscriptCursor | null,
    limit?: number
  ): Promise<LiveTranscriptPage> {
    return this.transcripts.page(sessionId, before, limit)
  }

  /** What a transcript gained after `cursor`; `shrank` when it was rewritten shorter. */
  transcriptSince(
    sessionId: string,
    cursor: LiveTranscriptCursor
  ): ReturnType<LiveTranscriptStreams['since']> {
    return this.transcripts.since(sessionId, cursor)
  }

  watchTranscript(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    return this.transcripts.watch(sessionId, fromCursor, listener)
  }

  /** A session on a paired server is reached through that server: its routes mean nothing here. */
  private federated(sessionId: string): FederatedSessions | null {
    return this.federation?.owns(this.registry.currentId(sessionId)) ? this.federation : null
  }

  send(request: LiveSendRequest): Promise<LiveMessage> {
    const sessionId = this.registry.currentId(request.sessionId)
    return (this.federated(sessionId) ?? this.outbox).send({ ...request, sessionId })
  }

  async retry(messageId: string): Promise<LiveMessage | null> {
    // It failed here while its server was away; the server is listed again, so it goes there.
    const held = this.outbox.list().find((message) => message.messageId === messageId)
    const server = held?.state === 'failed' ? this.federated(held.sessionId) : null
    const moved = server
      ? await this.outbox.handOver(messageId, (request) =>
          server.offer({ ...request, sessionId: this.registry.currentId(request.sessionId) })
        )
      : null
    return moved ?? this.federation?.retry(messageId) ?? this.outbox.retry(messageId)
  }

  messages(sessionId?: string): LiveMessage[] {
    const current = sessionId === undefined ? undefined : this.registry.currentId(sessionId)
    const remote = this.federation?.messages(current) ?? []
    // Seal stopped between a server taking a message and the outbox letting it go: the server's stands.
    const onServer = new Set(remote.map((message) => message.messageId))
    const local = this.outbox.list(current).filter((message) => !onServer.has(message.messageId))
    return remote.length === 0
      ? local
      : [...local, ...remote].sort((a, b) => a.createdAt - b.createdAt)
  }

  subscribeMessages(listener: (message: LiveMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  async answer(request: LivePermissionAnswer): Promise<LivePermissionAnswerResult> {
    const session = this.registry.get(request.sessionId)
    if (!session) {
      return { ok: false, reason: 'prompt_not_pending' }
    }
    const remote = this.federated(session.id)
    const result = await (
      remote
        ? remote.answer({ ...request, sessionId: session.id })
        : this.routes.answer(session, request)
    ).catch((error: unknown): LivePermissionAnswerResult => ({
      ok: false,
      reason: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }))
    void this.registry.refresh(session.machine.hostId)
    return result
  }

  /** Stops an external session so the caller can reopen it in a Seal pane with `--resume`. */
  async takeOver(sessionId: string): Promise<LiveTakeOverResult> {
    const session = this.registry.get(sessionId)
    const result = await takeOverSession(
      session,
      session ? this.registry.host(session.machine.hostId) : null
    ).catch((error: unknown): LiveTakeOverResult => ({
      ok: false,
      reason: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }))
    if (session) {
      void this.registry.refresh(session.machine.hostId)
    }
    return result
  }

  /** Renames or pins a session in Seal. */
  async annotate(annotation: LiveSessionAnnotation): Promise<void> {
    await this.annotations.load()
    this.annotations.set({
      ...annotation,
      sessionId: this.registry.currentId(annotation.sessionId)
    })
    this.registry.republish()
  }

  /** Hides sessions for good; stops them and deletes their transcripts first when asked. */
  async remove(request: LiveRemoveRequest): Promise<LiveRemoveResult> {
    const result: LiveRemoveResult = { removed: [], failed: [] }
    const hostIds = new Set<string>()
    for (const sessionId of new Set(request.sessionIds)) {
      const session = this.registry.get(sessionId)
      const host = session ? this.registry.host(session.machine.hostId) : null
      try {
        const outcome = session
          ? await removeFromOwner(session, request, {
              server: session.surface.kind === 'external' ? null : this.federated(session.id),
              chats: this.chats,
              host
            })
          : 'removed'
        if (outcome === 'removed') {
          result.removed.push(sessionId)
        } else {
          result.failed.push({ sessionId, reason: outcome })
        }
        if (session) {
          hostIds.add(session.machine.hostId)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.failed.push({ sessionId, reason: 'failed', error: message })
      }
    }
    if (!request.keep) {
      this.removals.add(result.removed, Date.now())
      this.annotations.forget(result.removed)
    }
    this.registry.republish()
    for (const hostId of hostIds) {
      void this.registry.refresh(hostId)
    }
    return result
  }

  private async userTexts(session: LiveSession, from: number): Promise<UserText[]> {
    const chat = localChatSessionId(session)
    if (chat !== null) {
      return (await this.chats?.userTexts(chat, from)) ?? []
    }
    const found = this.streams.source(session.id)
    return found ? userTextsFrom(found.source, found.provider, from) : []
  }
}
