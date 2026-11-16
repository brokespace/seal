import type { LiveMessage, LiveSession } from '../../../shared/live-sessions/live-session-types'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'
import { FederatedMessageList } from './federated-message-list'
import {
  desktopSessionId,
  federatedMessage,
  federatedSession,
  isServersOwnSession
} from './federated-session-records'
import {
  readWatchFrame,
  type ServerRegistryEvent,
  type ServerSession,
  type ServerSnapshot
} from './federated-watch-frames'
import type {
  FederatedServer,
  FederationStreamError,
  FederationTransport
} from './federation-transport'

export const LIVE_SESSIONS_WATCH_METHOD = 'liveSessions.watch'

/** The registry's own rule for a machine that stops answering: its sessions leave after this many failures. */
const UNREACHABLE_AFTER_FAILURES = 3
const MAX_RETRY_DOUBLINGS = 5
/** An older server is asked again this often, so one updated in place federates without a restart. */
const UNSUPPORTED_PROBE_MS = 10 * 60_000

export type FederatedServerFeedDeps = {
  transport: FederationTransport
  retryMs: number
  log?: (message: string, error?: unknown) => void
  /** Its sessions, its coverage or its notice changed. */
  onChanged: () => void
  onMessage: (message: LiveMessage) => void
}

export function federationOutdatedNotice(label: string): string {
  return `${label} runs an older Seal: update Seal on this server to list its chats`
}

/**
 * One paired server's `liveSessions.watch`: connecting, then ready (its registry is the source),
 * and on a lost stream its last records for a short grace while it reconnects with backoff.
 */
export class FederatedServerFeed {
  readonly messages: FederatedMessageList
  /** The server's records by the server's ids. */
  private readonly records = new Map<string, ServerSession>()
  /** Successor's server id to the desktop ids the server said it replaced. */
  private readonly formerIds = new Map<string, string[]>()
  private listed: LiveSession[] | null = null
  private stream: { close(): void } | null = null
  /** Rises with every stream opened or ended, so a late callback of an old one is ignored. */
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private live = false
  private failures = 0
  private covered = false
  private unsupported = false
  private serverError: string | null = null
  private connectionError: string | null = null
  private closed = false

  constructor(
    private server: FederatedServer,
    private readonly deps: FederatedServerFeedDeps
  ) {
    this.messages = new FederatedMessageList(deps.onMessage)
    this.connect()
  }

  get environmentId(): string {
    return this.server.environmentId
  }

  get hostId(): string {
    return this.server.machine.hostId
  }

  /** The machine record was renamed or changed transport; true when what the feed lists changed with it. */
  update(server: FederatedServer): boolean {
    if (JSON.stringify(server.machine) === JSON.stringify(this.server.machine)) {
      return false
    }
    this.server = server
    this.listed = null
    return this.records.size > 0 || this.unsupported
  }

  sessions(): LiveSession[] {
    this.listed ??= [...this.records.values()].flatMap(
      (record) => federatedSession(record, this.server.machine, this.formerIds.get(record.id)) ?? []
    )
    return this.listed
  }

  covers(): boolean {
    return this.covered
  }

  notice(): string | null {
    if (this.unsupported) {
      return federationOutdatedNotice(this.server.machine.label)
    }
    if (!this.covered) {
      // The `hostRun` scan still reads this machine and reports its own failures.
      return null
    }
    return this.failures >= UNREACHABLE_AFTER_FAILURES ? this.connectionError : this.serverError
  }

  close(): void {
    this.closed = true
    this.attempt++
    this.clearTimer()
    this.stream?.close()
    this.stream = null
  }

  private connect(): void {
    if (this.closed) {
      return
    }
    const attempt = ++this.attempt
    this.live = false
    void this.deps.transport
      .subscribe(this.server.environmentId, LIVE_SESSIONS_WATCH_METHOD, undefined, {
        onFrame: (frame) => {
          if (attempt === this.attempt) {
            this.onFrame(frame)
          }
        },
        onError: (error) => this.onEnded(attempt, error),
        onClose: () => this.onEnded(attempt, null)
      })
      .then(
        (stream) => {
          if (attempt === this.attempt) {
            this.stream = stream
          } else {
            stream.close()
          }
        },
        (error: unknown) =>
          this.onEnded(attempt, {
            code:
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              typeof error.code === 'string'
                ? error.code
                : 'failed',
            message: error instanceof Error ? error.message : String(error)
          })
      )
  }

  private onEnded(attempt: number, error: FederationStreamError | null): void {
    if (attempt !== this.attempt || this.closed) {
      return
    }
    this.attempt++
    this.stream?.close()
    this.stream = null
    if (error?.code === 'method_not_found') {
      this.becomeUnsupported()
      return
    }
    if (this.live) {
      // A stream that was delivering and dropped is a blip: its records stand while it reconnects.
      this.live = false
      this.retryIn(this.deps.retryMs)
      return
    }
    this.failures++
    this.connectionError = error?.message ?? 'The connection to the server closed'
    if (this.failures === 1) {
      this.deps.log?.(`[live-sessions] feed of ${this.hostId} failed`, this.connectionError)
    }
    if (this.failures === UNREACHABLE_AFTER_FAILURES && this.covered) {
      // Its sessions' last statuses would stand for as long as it stays silent.
      this.records.clear()
      this.formerIds.clear()
      this.changed()
    }
    this.retryIn(this.deps.retryMs * 2 ** Math.min(this.failures, MAX_RETRY_DOUBLINGS))
  }

  private becomeUnsupported(): void {
    const changed = !this.unsupported
    this.unsupported = true
    this.covered = false
    this.live = false
    this.failures = 0
    this.serverError = null
    this.connectionError = null
    this.records.clear()
    this.formerIds.clear()
    this.retryIn(UNSUPPORTED_PROBE_MS)
    if (changed) {
      this.deps.log?.(`[live-sessions] ${this.hostId} cannot list its own sessions: older server`)
      this.changed()
    }
  }

  private retryIn(ms: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, ms)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
  }

  private onFrame(value: unknown): void {
    const frame = readWatchFrame(value)
    if (!frame) {
      return
    }
    if (frame.type === 'ready') {
      if (!frame.surfaces?.includes('chat')) {
        // Its registry has no chats to give: the scan lists the machine, as it did before.
        this.attempt++
        this.stream?.close()
        this.stream = null
        this.becomeUnsupported()
        return
      }
      this.live = true
      this.covered = true
      this.unsupported = false
      this.failures = 0
      this.connectionError = null
      this.replace(frame.snapshot)
      this.messages.replaceFromServer(
        frame.messages.flatMap((message) => federatedMessage(message, this.hostId) ?? [])
      )
    } else if (frame.type === 'event') {
      this.onEvent(frame.event)
    } else if (frame.type === 'message') {
      const message = federatedMessage(frame.message, this.hostId)
      if (message) {
        this.messages.fromServer(message)
      }
    } else {
      // The server ended the subscription (it is shutting down): same as a closed stream.
      this.onEnded(this.attempt, null)
    }
  }

  private replace(snapshot: ServerSnapshot): void {
    this.records.clear()
    for (const session of snapshot.sessions) {
      if (isServersOwnSession(session)) {
        this.records.set(session.id, session)
      }
    }
    for (const successor of this.formerIds.keys()) {
      if (!this.records.has(successor)) {
        this.formerIds.delete(successor)
      }
    }
    this.serverError = snapshot.hostErrors[LOCAL_HOST_ID] ?? null
    this.changed()
  }

  private onEvent(event: ServerRegistryEvent): void {
    if (event.type === 'snapshot') {
      this.replace(event.snapshot)
    } else if (event.type === 'upsert') {
      if (isServersOwnSession(event.session)) {
        this.records.set(event.session.id, event.session)
        this.changed()
      }
    } else if (event.type === 'remove') {
      this.remove(event.sessionId, event.replacedBy)
    } else if (event.hostId === LOCAL_HOST_ID && event.error !== this.serverError) {
      this.serverError = event.error
      this.changed()
    }
  }

  private remove(serverId: string, replacedBy: string | undefined): void {
    if (!this.records.delete(serverId)) {
      return
    }
    const former = this.formerIds.get(serverId) ?? []
    this.formerIds.delete(serverId)
    const from = desktopSessionId(this.hostId, serverId)
    const to = replacedBy ? desktopSessionId(this.hostId, replacedBy) : null
    if (replacedBy && from && to) {
      // The desktop registry moves pins, names and marks to a session whose `continues` names the old id.
      this.formerIds.set(replacedBy, [...(this.formerIds.get(replacedBy) ?? []), ...former, from])
      this.messages.renameSession(from, to)
    }
    this.changed()
  }

  private changed(): void {
    this.listed = null
    this.deps.onChanged()
  }
}
