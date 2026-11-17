import {
  liveSessionProviderOf,
  type LiveSession,
  type LiveSessionProvider,
  type LiveTranscriptCursor,
  type LiveTranscriptDelta,
  type LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { liveSessionAdapter } from '../adapters/live-session-adapters'
import { parseSubagentTranscriptId } from '../../../shared/live-sessions/live-session-activity'
import {
  readTranscriptForward,
  readTranscriptPage,
  type TranscriptDecodeOptions
} from './live-transcript-reader'
import { transcriptSourceFor, type TranscriptSource } from './transcript-file-source'

export type TranscriptSessionLookup = {
  get(sessionId: string): LiveSession | null
  host(hostId: string): LiveSessionHost | null
}

export type LiveTranscriptSubscription = {
  /** The newest page when subscribed without a cursor; with one, null (catch-up arrives as a delta). */
  ready: Promise<LiveTranscriptPage | null>
  unsubscribe(): void
}

type ReadableTranscript = {
  source: TranscriptSource
  session: LiveSession
  provider: LiveSessionProvider
  decode: TranscriptDecodeOptions
}

const DEFAULT_PAGE = 80
const MAX_SINCE_READS = 64
/** A watcher further behind than this many reads is given the newest page, not the whole gap. */
const MAX_CATCH_UP_READS = 4
const MAX_CATCH_UP_MESSAGES = 4 * DEFAULT_PAGE

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
  source(transcriptId: string): ReadableTranscript | null {
    const { sessionId, subagentId } = parseSubagentTranscriptId(transcriptId)
    const session = this.sessions.get(sessionId)
    const host = session ? this.sessions.host(session.machine.hostId) : null
    // Only paths the scan itself found are read, never one a caller names.
    const path =
      subagentId === null
        ? session?.transcriptPath
        : session?.activity?.subagents.find((subagent) => subagent.id === subagentId)
            ?.transcriptPath
    // An agent whose transcript decodes as Claude's or Codex's (OpenClaude) is read as that one.
    const decoder = session ? liveSessionAdapter(session.provider)?.transcript?.decoder : null
    const provider = decoder ? liveSessionProviderOf(decoder) : null
    if (!session || !path || !host || !provider) {
      return null
    }
    return {
      session,
      provider,
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
    return readTranscriptPage(found.source, found.provider, sessionId, before, limit, found.decode)
  }

  /** Everything written from `cursor` to the file's end, for a reader that keeps its own place. */
  async since(
    sessionId: string,
    cursor: LiveTranscriptCursor
  ): Promise<{ messages: NativeChatMessage[]; cursor: LiveTranscriptCursor; shrank: boolean }> {
    const found = this.source(sessionId)
    const messages: NativeChatMessage[] = []
    let at = cursor
    // Bounded: a transcript that outgrows this many reads is picked up from here next time.
    for (let reads = 0; found && reads < MAX_SINCE_READS; reads++) {
      const read = await readTranscriptForward(found.source, found.provider, at, found.decode)
      if (read.shrank) {
        return { messages: [], cursor, shrank: true }
      }
      messages.push(...read.messages)
      if (read.cursor === at) {
        break
      }
      at = read.cursor
      if (at >= read.size) {
        break
      }
    }
    return { messages, cursor: at, shrank: false }
  }

  /** A base64 run of the transcript, for an image one of its rows refers to; empty when it is not there. */
  async imageBase64(sessionId: string, start: number, length: number): Promise<string> {
    return (await this.source(sessionId)?.source.base64Run(start, length)) ?? ''
  }

  /**
   * Deltas continue from `fromCursor`, or from the newest page when it is null. A watcher that is
   * far behind the file's end (a cursor from before a restart, or zero for a session that was not
   * listed yet) gets the newest page as a `reset` delta instead of the history in between.
   */
  subscribe(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    let cursor = fromCursor ?? 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0

    const catchUp = async (found: ReadableTranscript): Promise<void> => {
      const from = cursor
      const messages: NativeChatMessage[] = []
      let at = from
      let behind = false
      for (let reads = 0; ; reads++) {
        const read = await readTranscriptForward(found.source, found.provider, at, found.decode)
        if (stopped) {
          return
        }
        if (read.shrank) {
          behind = true
          break
        }
        messages.push(...read.messages)
        const caughtUp = read.cursor === at || read.cursor >= read.size
        at = read.cursor
        if (
          messages.length > MAX_CATCH_UP_MESSAGES ||
          (!caughtUp && reads + 1 >= MAX_CATCH_UP_READS)
        ) {
          behind = true
        }
        if (behind || caughtUp) {
          break
        }
      }
      if (behind) {
        const page = await this.page(sessionId, null)
        if (!stopped) {
          cursor = page.cursor
          listener({ sessionId, from, cursor, messages: page.messages, reset: true })
        }
      } else if (at !== from) {
        cursor = at
        listener({ sessionId, from, cursor, messages })
      }
    }

    const poll = async (): Promise<void> => {
      if (stopped) {
        return
      }
      const found = this.source(sessionId)
      if (found) {
        try {
          await catchUp(found)
          failures = 0
        } catch (error) {
          failures++
          // A watch closed while its read was out has nobody to tell.
          if (failures === 1 && !stopped) {
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
