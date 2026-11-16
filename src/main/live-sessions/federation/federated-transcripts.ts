import type {
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { LiveTranscriptSubscription } from '../transcripts/live-transcript-streams'
import {
  readTranscriptFrame,
  readTranscriptPage,
  readTranscriptSince,
  type ServerTranscriptSince
} from './federated-transcript-frames'
import { SERVER_NOT_CONNECTED, type FederationTransport } from './federation-transport'

/** Reading a page on the server is one local file or journal read. */
const READ_TIMEOUT_MS = 30_000
const MAX_RETRY_DOUBLINGS = 5
const UNREADABLE = 'The server gave a transcript Seal could not read'

export type FederatedTranscriptsDeps = {
  transport: FederationTransport
  /** The server that lists the session and the id it knows it by; null while none does. */
  target(sessionId: string): { environmentId: string; sessionId: string } | null
  retryMs: number
  log?: (message: string, error?: unknown) => void
}

/**
 * A federated session's transcript, read by the server that holds it: a chat's journal is not a
 * file the desktop can open, and the server knows where each of its sessions keeps its history.
 * Cursors are the server's, passed through; ids are the desktop's.
 */
export class FederatedTranscripts {
  private readonly watches = new Set<() => void>()

  constructor(private readonly deps: FederatedTranscriptsDeps) {}

  async page(
    sessionId: string,
    before: LiveTranscriptCursor | null,
    limit?: number
  ): Promise<LiveTranscriptPage> {
    const page = readTranscriptPage(
      await this.call(sessionId, 'liveSessions.transcript', { before, limit })
    )
    if (!page) {
      throw new Error(UNREADABLE)
    }
    return { ...page, sessionId }
  }

  async since(sessionId: string, cursor: LiveTranscriptCursor): Promise<ServerTranscriptSince> {
    const since = readTranscriptSince(
      await this.call(sessionId, 'liveSessions.transcriptSince', { cursor })
    )
    if (!since) {
      throw new Error(UNREADABLE)
    }
    return since
  }

  /** Follows the server's own watch; a dropped stream is reopened from the last cursor it gave. */
  watch(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    const empty: LiveTranscriptPage = { sessionId, messages: [], cursor: 0, start: 0, more: false }
    let cursor = fromCursor
    let stopped = false
    let attempt = 0
    let failures = 0
    let stream: { close(): void } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let answerReady: ((page: LiveTranscriptPage | null) => void) | null = null
    const ready = new Promise<LiveTranscriptPage | null>((resolve) => {
      answerReady = resolve
    })
    const settleReady = (page: LiveTranscriptPage | null): void => {
      answerReady?.(page)
      answerReady = null
    }

    const ended = (endedAttempt: number, error: string | null): void => {
      if (stopped || endedAttempt !== attempt) {
        return
      }
      attempt++
      stream?.close()
      stream = null
      failures++
      if (failures === 1 && error) {
        this.deps.log?.(`[live-sessions] transcript watch of ${sessionId} failed`, error)
      }
      // A watcher always gets an answer: the first page arrives as a reset once the server gives it.
      settleReady(empty)
      timer = setTimeout(connect, this.deps.retryMs * 2 ** Math.min(failures, MAX_RETRY_DOUBLINGS))
      timer.unref?.()
    }

    const onFrame = (value: unknown): void => {
      const frame = readTranscriptFrame(value)
      if (!frame) {
        return
      }
      if (frame.type === 'end') {
        ended(attempt, null)
        return
      }
      failures = 0
      if (frame.type === 'delta') {
        cursor = frame.delta.cursor
        listener({ ...frame.delta, sessionId })
        return
      }
      if (!frame.page) {
        return
      }
      const held = cursor ?? 0
      cursor = frame.page.cursor
      if (answerReady) {
        settleReady({ ...frame.page, sessionId })
      } else {
        listener({
          sessionId,
          from: held,
          cursor: frame.page.cursor,
          messages: frame.page.messages,
          reset: true
        })
      }
    }

    const connect = (): void => {
      timer = null
      if (stopped) {
        return
      }
      const current = ++attempt
      const target = this.deps.target(sessionId)
      if (!target) {
        // Nothing was asked of a server that is away: the wait for its return does not grow.
        failures = 0
        ended(current, null)
        return
      }
      void this.deps.transport
        .subscribe(
          target.environmentId,
          'liveSessions.watchTranscript',
          { sessionId: target.sessionId, fromCursor: cursor },
          {
            onFrame: (frame) => {
              if (current === attempt) {
                onFrame(frame)
              }
            },
            onError: (error) => ended(current, error.message),
            onClose: () => ended(current, null)
          }
        )
        .then(
          (opened) => {
            if (current === attempt && !stopped) {
              stream = opened
            } else {
              opened.close()
            }
          },
          (error: unknown) => ended(current, error instanceof Error ? error.message : String(error))
        )
    }

    const unsubscribe = (): void => {
      stopped = true
      attempt++
      if (timer) {
        clearTimeout(timer)
      }
      stream?.close()
      stream = null
      settleReady(fromCursor === null ? empty : null)
      this.watches.delete(unsubscribe)
    }
    this.watches.add(unsubscribe)
    if (fromCursor !== null) {
      // Catch-up from a cursor arrives as a delta, as it does from a file.
      settleReady(null)
    }
    connect()
    return { ready, unsubscribe }
  }

  stop(): void {
    for (const unsubscribe of this.watches) {
      unsubscribe()
    }
  }

  private async call(
    sessionId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const target = this.deps.target(sessionId)
    if (!target) {
      throw new Error(SERVER_NOT_CONNECTED)
    }
    const response = await this.deps.transport.call(
      target.environmentId,
      method,
      { ...params, sessionId: target.sessionId },
      READ_TIMEOUT_MS
    )
    if (response.ok !== true) {
      throw new Error(response.error.message)
    }
    return response.result
  }
}
