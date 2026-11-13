import { join } from 'node:path'
import { hostname } from 'node:os'
import type {
  LiveMessage,
  LivePermissionAnswer,
  LivePermissionAnswerResult,
  LiveSendRequest,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTakeOverResult,
  LiveTranscriptPage
} from '../../shared/live-sessions/live-session-types'
import { LiveSessionRegistry } from './live-session-registry'
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

export type LiveSessionServiceDeps = {
  userDataPath: string
  hosts: () => LiveSessionHost[]
  sealPanes?: {
    panes: () => SealPane[]
    input: SealPaneInput
    subscribe: (onChange: () => void) => () => void
  }
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

  constructor(deps: LiveSessionServiceDeps) {
    this.registry = new LiveSessionRegistry({
      localMachine: { hostId: LOCAL_HOST_ID, label: hostname(), kind: 'local' },
      hosts: deps.hosts,
      sealPanes: () => deps.sealPanes?.panes() ?? [],
      subscribeSealPanes: deps.sealPanes?.subscribe,
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
      }
    })
    this.registry.start()
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
