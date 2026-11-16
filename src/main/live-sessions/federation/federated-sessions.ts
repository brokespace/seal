import type {
  LiveMessage,
  LivePermissionAnswer,
  LivePermissionAnswerResult,
  LiveRemoveRequest,
  LiveSendRequest
} from '../../../shared/live-sessions/live-session-types'
import type { OfferedMessage } from '../delivery/live-message-outbox-types'
import type { LiveSessionSource } from '../sources/live-session-source'
import { FederatedServerFeed } from './federated-server-feed'
import { federatedMessage, serverSessionId } from './federated-session-records'
import { readAnswerResult, readRemoveResult, readServerMessage } from './federated-watch-frames'
import { FederatedTranscripts } from './federated-transcripts'
import {
  SERVER_NOT_CONNECTED,
  type FederatedServer,
  type FederationTransport
} from './federation-transport'
import { errorMessage } from '../../../shared/error-message'

export type { FederatedServer, FederationTransport } from './federation-transport'

const DEFAULT_RETRY_MS = 2_000
/** The server queues a message and answers at once. */
const SEND_TIMEOUT_MS = 30_000
/** Answering types into a terminal and stopping waits for the agent to exit, both on the server. */
const ACTION_TIMEOUT_MS = 60_000
const UNREADABLE_ANSWER = 'The server gave an answer Seal could not read'

type Target = { feed: FederatedServerFeed; serverId: string }

/**
 * The sessions of every paired Seal server, as each server's own registry lists them: the desktop
 * subscribes to `liveSessions.watch` and forwards sends and answers instead of scanning the server.
 */
export class FederatedSessions {
  /** By the desktop's machine record id. */
  private readonly feeds = new Map<string, FederatedServerFeed>()
  private readonly changeListeners = new Set<() => void>()
  private readonly messageListeners = new Set<(message: LiveMessage) => void>()
  private readonly retryMs: number
  private stopped = false
  /** Each federated session's transcript, read by its server. */
  readonly transcripts: FederatedTranscripts

  /** Every federated record, already under the desktop's ids and machine records. */
  readonly source: LiveSessionSource = {
    sessions: () => [...this.feeds.values()].flatMap((feed) => feed.sessions()),
    subscribe: (onChange) => {
      this.changeListeners.add(onChange)
      return () => this.changeListeners.delete(onChange)
    }
  }

  constructor(
    private readonly deps: {
      transport: FederationTransport
      log?: (message: string, error?: unknown) => void
      /** Test seam for reconnect waits. */
      retryMs?: number
    }
  ) {
    this.retryMs = deps.retryMs ?? DEFAULT_RETRY_MS
    this.transcripts = new FederatedTranscripts({
      transport: deps.transport,
      target: (sessionId) => this.serverSession(sessionId),
      retryMs: this.retryMs,
      log: deps.log
    })
  }

  /** The paired servers connected right now: opens a feed for each new one, closes the rest. Cheap to call often. */
  sync(servers: readonly FederatedServer[]): void {
    if (this.stopped) {
      return
    }
    const current = new Map(servers.map((server) => [server.machine.hostId, server]))
    let changed = false
    for (const [hostId, feed] of this.feeds) {
      const server = current.get(hostId)
      if (server?.environmentId === feed.environmentId) {
        changed = feed.update(server) || changed
        continue
      }
      feed.close()
      this.feeds.delete(hostId)
      changed = true
    }
    for (const [hostId, server] of current) {
      if (!this.feeds.has(hostId)) {
        this.feeds.set(hostId, this.openFeed(server))
      }
    }
    if (changed) {
      // A caller syncs from inside its own publish: it hears of the change after it, not within it.
      queueMicrotask(() => this.notifyChanged())
    }
  }

  /** The server's own registry lists this machine, so nothing scans it. False for an older server and before the first snapshot. */
  covers(hostId: string): boolean {
    return this.feeds.get(hostId)?.covers() ?? false
  }

  /** What the machine's row says: an older server needs an update, or why its sessions are not current. */
  notice(hostId: string): string | null {
    return this.feeds.get(hostId)?.notice() ?? null
  }

  /** The session is a federated one (its machine is covered). */
  owns(sessionId: string): boolean {
    return this.target(sessionId) !== null
  }

  /** The server a federated session's calls go to, and the id it knows the session by. */
  private serverSession(sessionId: string): { environmentId: string; sessionId: string } | null {
    const target = this.target(sessionId)
    return target && { environmentId: target.feed.environmentId, sessionId: target.serverId }
  }

  /**
   * Asks the session's server to take a message and send it. `refused` says why it did not: the
   * caller keeps the message, since nothing here outlives the server's connection.
   */
  async offer(request: LiveSendRequest): Promise<OfferedMessage> {
    const target = this.target(request.sessionId)
    if (!target) {
      return { refused: SERVER_NOT_CONNECTED }
    }
    // The server already has it: a resend that did not get through changes nothing.
    const refused = (why: string): OfferedMessage =>
      target.feed.messages.get(request.messageId) ?? { refused: why }
    try {
      const response = await this.deps.transport.call(
        target.feed.environmentId,
        'liveSessions.send',
        { ...request, sessionId: target.serverId },
        SEND_TIMEOUT_MS
      )
      if (response.ok !== true) {
        return refused(response.error.message)
      }
      const sent = readServerMessage(response.result)
      const message = sent ? federatedMessage(sent, target.feed.hostId) : null
      return message ? target.feed.messages.fromServer(message) : refused(UNREADABLE_ANSWER)
    } catch (error) {
      return refused(errorMessage(error))
    }
  }

  /** Asks the server to send one of its failed messages again. Null when no server lists that id. */
  retry(messageId: string, mayRunTwice = false): Promise<LiveMessage | null> | null {
    for (const feed of this.feeds.values()) {
      if (feed.messages.get(messageId)) {
        return this.retryOnServer(feed, messageId, mayRunTwice)
      }
    }
    return null
  }

  private async retryOnServer(
    feed: FederatedServerFeed,
    messageId: string,
    mayRunTwice: boolean
  ): Promise<LiveMessage | null> {
    try {
      const response = await this.deps.transport.call(
        feed.environmentId,
        'liveSessions.retry',
        { messageId, ...(mayRunTwice && { mayRunTwice }) },
        SEND_TIMEOUT_MS
      )
      if (response.ok !== true) {
        return feed.messages.failedToRetry(messageId, response.error.message)
      }
      const retried = readServerMessage(response.result)
      const message = retried ? federatedMessage(retried, feed.hostId) : null
      return message ? feed.messages.fromServer(message) : null
    } catch (error) {
      return feed.messages.failedToRetry(messageId, errorMessage(error))
    }
  }

  messages(sessionId?: string): LiveMessage[] {
    return [...this.feeds.values()]
      .flatMap((feed) => feed.messages.list(sessionId))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  subscribeMessages(listener: (message: LiveMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  async answer(request: LivePermissionAnswer): Promise<LivePermissionAnswerResult> {
    const target = this.target(request.sessionId)
    const failed = (error: string): LivePermissionAnswerResult => ({
      ok: false,
      reason: 'failed',
      error
    })
    if (!target) {
      return failed(SERVER_NOT_CONNECTED)
    }
    try {
      const response = await this.deps.transport.call(
        target.feed.environmentId,
        'liveSessions.answer',
        { ...request, sessionId: target.serverId },
        ACTION_TIMEOUT_MS
      )
      return response.ok === true
        ? (readAnswerResult(response.result) ?? failed(UNREADABLE_ANSWER))
        : failed(response.error.message)
    } catch (error) {
      return failed(errorMessage(error))
    }
  }

  /** Stop (and delete transcripts of) a session on its server without hiding it there. */
  async remove(
    sessionId: string,
    request: Pick<LiveRemoveRequest, 'stop' | 'deleteTranscripts'>
  ): Promise<'removed' | 'still_running'> {
    if (!request.stop && !request.deleteTranscripts) {
      return 'removed'
    }
    const target = this.target(sessionId)
    if (!target) {
      throw new Error(SERVER_NOT_CONNECTED)
    }
    const response = await this.deps.transport.call(
      target.feed.environmentId,
      'liveSessions.remove',
      {
        sessionIds: [target.serverId],
        stop: request.stop,
        deleteTranscripts: request.deleteTranscripts,
        // The desktop hides it in its own list; the server keeps listing it for its other clients.
        keep: true
      },
      ACTION_TIMEOUT_MS
    )
    if (response.ok !== true) {
      throw new Error(response.error.message)
    }
    const result = readRemoveResult(response.result)
    if (!result) {
      throw new Error(UNREADABLE_ANSWER)
    }
    const failure = result.failed.find((entry) => entry.sessionId === target.serverId)
    if (failure?.reason === 'failed') {
      throw new Error(failure.error ?? 'The server could not remove the session')
    }
    return failure ? 'still_running' : 'removed'
  }

  stop(): void {
    this.stopped = true
    this.transcripts.stop()
    for (const feed of this.feeds.values()) {
      feed.close()
    }
    this.feeds.clear()
    this.changeListeners.clear()
    this.messageListeners.clear()
  }

  private openFeed(server: FederatedServer): FederatedServerFeed {
    return new FederatedServerFeed(server, {
      transport: this.deps.transport,
      retryMs: this.retryMs,
      log: this.deps.log,
      onChanged: () => this.notifyChanged(),
      onMessage: (message) => this.emitMessage(message)
    })
  }

  /** The covered server a session id belongs to. One machine id can begin another, so the longest wins. */
  private target(sessionId: string): Target | null {
    let best: Target | null = null
    for (const feed of this.feeds.values()) {
      const serverId = feed.covers() ? serverSessionId(feed.hostId, sessionId) : null
      if (serverId && (!best || feed.hostId.length > best.feed.hostId.length)) {
        best = { feed, serverId }
      }
    }
    return best
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) {
      try {
        listener()
      } catch (error) {
        this.deps.log?.('[live-sessions] federation listener threw', error)
      }
    }
  }

  private emitMessage(message: LiveMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message)
      } catch (error) {
        this.deps.log?.('[live-sessions] federation message listener threw', error)
      }
    }
  }
}
