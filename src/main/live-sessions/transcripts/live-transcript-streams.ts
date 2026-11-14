import type {
  LiveSession,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { parseSubagentTranscriptId } from '../../../shared/live-sessions/live-session-activity'
import {
  readTranscriptForward,
  readTranscriptPage,
  transcriptSourceFor,
  type TranscriptDecodeOptions,
  type TranscriptSource
} from './live-transcript-reader'

export type TranscriptSessionLookup = {
  get(sessionId: string): LiveSession | null
  host(hostId: string): LiveSessionHost | null
}

export type LiveTranscriptSubscription = {
  /** The newest page when subscribed without a cursor; with one, null (catch-up arrives as a delta). */
  ready: Promise<LiveTranscriptPage | null>
  unsubscribe(): void
}

const DEFAULT_PAGE = 80

/** Tails session transcripts for chat views; every delta names the cursor it continues from. */
export class LiveTranscriptStreams {
  private readonly pollMs: { local: number; ssh: number }
  private readonly log?: (m: string, e?: unknown) => void

  constructor(
    private readonly sessions: TranscriptSessionLookup,
    options?: { pollMs?: { local: number; ssh: number }; log?: (m: string, e?: unknown) => void }
  ) {
    this.pollMs = options?.pollMs ?? { local: 500, ssh: 1_500 }
    this.log = options?.log
  }

  /** `transcriptId` is a session id, or a subagent's (`subagentTranscriptId`): its own transcript. */
  source(
    transcriptId: string
  ): { source: TranscriptSource; session: LiveSession; decode: TranscriptDecodeOptions } | null {
    const { sessionId, subagentId } = parseSubagentTranscriptId(transcriptId)
    const session = this.sessions.get(sessionId)
    const host = session ? this.sessions.host(session.machine.hostId) : null
    // Only paths the scan itself found are read, never one a caller names.
    const path =
      subagentId === null
        ? session?.transcriptPath
        : session?.activity?.subagents.find((subagent) => subagent.id === subagentId)
            ?.transcriptPath
    if (!session || !path || !host) {
      return null
    }
    return {
      session,
      source: transcriptSourceFor(host, path),
      decode: { subagent: subagentId !== null }
    }
  }

  async page(
    sessionId: string,
    before: LiveTranscriptCursor | null,
    limit = DEFAULT_PAGE
  ): Promise<LiveTranscriptPage> {
    const found = this.source(sessionId)
    if (!found) {
      return { sessionId, messages: [], cursor: 0, start: 0, more: false }
    }
    return readTranscriptPage(
      found.source,
      found.session.provider,
      sessionId,
      before,
      limit,
      found.decode
    )
  }

  subscribe(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    let cursor = fromCursor ?? 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0

    const poll = async (): Promise<void> => {
      if (stopped) {
        return
      }
      const found = this.source(sessionId)
      if (found) {
        try {
          const read = await readTranscriptForward(
            found.source,
            found.session.provider,
            cursor,
            found.decode
          )
          if (stopped) {
            return
          }
          if (read.shrank) {
            const page = await this.page(sessionId, null)
            listener({
              sessionId,
              from: cursor,
              cursor: page.cursor,
              messages: page.messages,
              reset: true
            })
            cursor = page.cursor
          } else if (read.cursor !== cursor) {
            listener({ sessionId, from: cursor, cursor: read.cursor, messages: read.messages })
            cursor = read.cursor
          }
          failures = 0
        } catch (error) {
          failures++
          if (failures === 1) {
            this.log?.(`[live-sessions] transcript read for ${sessionId} failed`, error)
          }
        }
      }
      if (!stopped) {
        const kind = found?.session.machine.kind ?? 'local'
        const base = kind === 'local' ? this.pollMs.local : this.pollMs.ssh
        timer = setTimeout(() => void poll(), base * Math.min(8, 2 ** failures))
        timer.unref?.()
      }
    }

    const ready =
      fromCursor === null
        ? this.page(sessionId, null).then((page) => {
            cursor = page.cursor
            return page
          })
        : Promise.resolve(null)
    void ready.catch(() => null).then(() => poll())
    return {
      ready,
      unsubscribe: () => {
        stopped = true
        if (timer) {
          clearTimeout(timer)
        }
      }
    }
  }
}
