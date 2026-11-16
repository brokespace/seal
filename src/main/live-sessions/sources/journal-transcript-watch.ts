import type {
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { LiveTranscriptSubscription } from '../transcripts/live-transcript-streams'
import type { SessionTranscript } from '../transcripts/session-transcript'

const POLL_MS = 1_000
const MAX_BACKOFF_DOUBLINGS = 3

/**
 * Follows a chat's journal for a transcript watcher, as the file tail does for a transcript file.
 * `journal` is asked at every read: null while the chat is not listed here.
 */
export function watchJournalTranscript(
  sessionId: string,
  journal: () => SessionTranscript | null,
  fromCursor: LiveTranscriptCursor | null,
  listener: (delta: LiveTranscriptDelta) => void,
  options?: { pollMs?: number; log?: (message: string, error?: unknown) => void }
): LiveTranscriptSubscription {
  const pollMs = options?.pollMs ?? POLL_MS
  let cursor = fromCursor ?? 0
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let failures = 0

  const read = async (): Promise<void> => {
    const found = journal()
    if (!found) {
      return
    }
    const next = await found.since(cursor)
    if (stopped) {
      return
    }
    if (next.shrank) {
      const page = await found.page(null)
      if (!stopped) {
        listener({
          sessionId,
          from: cursor,
          cursor: page.cursor,
          messages: page.messages,
          reset: true
        })
        cursor = page.cursor
      }
    } else if (next.cursor !== cursor) {
      listener({ sessionId, from: cursor, cursor: next.cursor, messages: next.messages })
      cursor = next.cursor
    }
  }

  const poll = async (): Promise<void> => {
    if (stopped) {
      return
    }
    try {
      await read()
      failures = 0
    } catch (error) {
      failures++
      if (failures === 1 && !stopped) {
        options?.log?.(`[live-sessions] journal read for ${sessionId} failed`, error)
      }
    }
    if (!stopped) {
      timer = setTimeout(() => void poll(), pollMs * 2 ** Math.min(failures, MAX_BACKOFF_DOUBLINGS))
      timer.unref?.()
    }
  }

  const empty: LiveTranscriptPage = { sessionId, messages: [], cursor: 0, start: 0, more: false }
  const ready =
    fromCursor === null
      ? Promise.resolve()
          .then(() => journal()?.page(null) ?? empty)
          // A watcher always gets an answer: what the first read missed arrives as a delta.
          .catch(() => empty)
          .then((page) => {
            cursor = page.cursor
            return page
          })
      : Promise.resolve(null)
  void ready.then(() => poll())
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
