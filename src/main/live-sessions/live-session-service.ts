import { join } from 'node:path'
import { hostname } from 'node:os'
import type {
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
import { readTranscriptForward } from './transcripts/live-transcript-reader'
import { SessionInputRoutes, type SealPaneInput } from './delivery/session-input-routes'
import { LiveMessageOutbox } from './delivery/live-message-outbox'
import { userTextsOf, type UserText } from './delivery/transcript-user-texts'
import { LOCAL_HOST_ID, type LiveSessionHost } from './hosts/live-session-hosts'
import type { SealPane } from './seal-panes/seal-pane-sessions'
import { takeOverSession } from './delivery/session-take-over'
import { LiveSessionRemovals, removeFromHost } from './delivery/session-removal'
import { LiveSessionAnnotations } from './live-session-annotations'

export type LiveSessionServiceDeps = {
  userDataPath: string
  hosts: () => LiveSessionHost[]
  sealPanes?: {
    panes: () => SealPane[]
    input: SealPaneInput
    subscribe: (onChange: () => void) => () => void
  }
  onHostScanned?: LiveSessionRegistryDeps['onHostScanned']
  log?: (message: string, error?: unknown) => void
}

const MAX_CONFIRM_READS = 8

/**
 * The main-process session API other features consume (home overview, home chat, mobile RPC):
 * a registry of live sessions, their transcripts as resumable streams, and confirmed sends.
 */
export class LiveSessionService {
  readonly registry: LiveSessionRegistry
  readonly streams: LiveTranscriptStreams
  private readonly routes: SessionInputRoutes
  private readonly outbox: LiveMessageOutbox
  private readonly messageListeners = new Set<(message: LiveMessage) => void>()
  private readonly removals: LiveSessionRemovals
  private readonly annotations: LiveSessionAnnotations

  constructor(deps: LiveSessionServiceDeps) {
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
      onHostScanned: deps.onHostScanned,
      log: deps.log
    })
    this.streams = new LiveTranscriptStreams(this.registry, { log: deps.log })
    this.routes = new SessionInputRoutes({
      host: (hostId) => this.registry.host(hostId),
      sealPanes: deps.sealPanes?.input ?? null
    })
    this.outbox = new LiveMessageOutbox({
      storePath: join(deps.userDataPath, 'live-sessions', 'outbox.json'),
      getSession: (id) => this.registry.get(id),
      attempt: (session, route, text, messageId, signal) =>
        this.routes.attempt(session, route, text, messageId, signal),
      transcriptSize: async (session) => {
        const found = this.streams.source(session.id)
        return found ? (await found.source.read(0, 0)).size : 0
      },
      userTexts: (session, from) => this.userTexts(session.id, from),
      onChange: (message) => {
        for (const listener of this.messageListeners) {
          listener(message)
        }
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
  }

  stop(): void {
    this.registry.stop()
    this.outbox.stop()
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
    return this.streams.page(sessionId, before, limit)
  }

  watchTranscript(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    return this.streams.subscribe(sessionId, fromCursor, listener)
  }

  send(request: LiveSendRequest): Promise<LiveMessage> {
    return this.outbox.send(request)
  }

  retry(messageId: string): Promise<LiveMessage | null> {
    return this.outbox.retry(messageId)
  }

  messages(sessionId?: string): LiveMessage[] {
    return this.outbox.list(sessionId)
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
    const result = await this.routes
      .answer(session, request)
      .catch((error: unknown): LivePermissionAnswerResult => ({
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
        const outcome = session && host ? await removeFromHost(session, host, request) : 'removed'
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

  private async userTexts(sessionId: string, from: number): Promise<UserText[]> {
    const found = this.streams.source(sessionId)
    if (!found) {
      return []
    }
    const out: UserText[] = []
    let cursor = from
    for (let i = 0; i < MAX_CONFIRM_READS; i++) {
      const read = await readTranscriptForward(found.source, found.session.provider, cursor)
      out.push(...userTextsOf(found.session.provider, read.lines))
      if (read.cursor === cursor || read.cursor >= read.size) {
        break
      }
      cursor = read.cursor
    }
    return out
  }
}
