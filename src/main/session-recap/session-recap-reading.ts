import type { LiveTranscriptPage } from '../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type { SessionRecap } from '../../shared/session-recap/session-recap-types'
import { digestTranscript } from './session-recap-transcript'

/** About 6,900 tokens of conversation per request. */
export const RECAP_CHUNK_CHARS = 24_000
/** The newest three chunks are read, by a first pass as by a rebuild; older history is left out. */
export const RECAP_MAX_CHUNKS = 3
export const BACKFILL_PAGE_MESSAGES = 200
export const MAX_BACKFILL_PAGES = 8

export type RecapTranscript = {
  /** The newest `limit` messages before `before`; the file's end when null. */
  page(sessionId: string, before: number | null, limit: number): Promise<LiveTranscriptPage>
  /** Everything from `cursor` on. */
  since(
    sessionId: string,
    cursor: number
  ): Promise<{ messages: NativeChatMessage[]; cursor: number; shrank: boolean }>
}

export type RecapReading = {
  /** The recap the messages continue; null when they start one. */
  base: SessionRecap | null
  messages: NativeChatMessage[]
  coveredFrom: number
  coveredTo: number
}

/** The read position in the transcript's own terms, once these messages are read. */
export function recapAnchorAfter(
  sessionId: string,
  before: SessionRecap['anchor'],
  messages: readonly NativeChatMessage[]
): Pick<SessionRecap, 'anchor'> {
  const at = messages.findLast((message) => message.timestamp !== null)?.timestamp ?? before?.at
  return at === undefined ? {} : { anchor: { sessionId, at } }
}

/**
 * The recap moved to a session with a new transcript (a fork, a resume): its byte cursor points
 * into the old file. What is new is every message written after the last one the recap read.
 */
async function readAfter(
  transcript: RecapTranscript,
  sessionId: string,
  at: number
): Promise<Pick<RecapReading, 'messages' | 'coveredTo'>> {
  let messages: NativeChatMessage[] = []
  let before: number | null = null
  let coveredTo = 0
  for (let pages = 0; pages < MAX_BACKFILL_PAGES; pages++) {
    const page = await transcript.page(sessionId, before, BACKFILL_PAGE_MESSAGES)
    if (before === null) {
      coveredTo = page.cursor
    }
    const read = page.messages.findLastIndex(
      (message) => message.timestamp !== null && message.timestamp <= at
    )
    messages = [...page.messages.slice(read + 1), ...messages]
    if (read !== -1 || !page.more || page.messages.length === 0) {
      break
    }
    before = page.start
  }
  return { messages, coveredTo }
}

/** What a pass has to read: the transcript since the recap, or its recent end for a first one. */
export async function readForRecap(
  transcript: RecapTranscript,
  sessionId: string,
  base: SessionRecap | null
): Promise<RecapReading> {
  if (base?.anchor && base.anchor.sessionId !== sessionId) {
    const moved = await readAfter(transcript, sessionId, base.anchor.at)
    return { base, ...moved, coveredFrom: base.coveredFrom }
  }
  if (base) {
    const read = await transcript.since(sessionId, base.coveredTo)
    if (!read.shrank) {
      return {
        base,
        messages: read.messages,
        coveredFrom: base.coveredFrom,
        coveredTo: read.cursor
      }
    }
  }
  let messages: NativeChatMessage[] = []
  let before: number | null = null
  let coveredTo = 0
  let coveredFrom = 0
  for (let pages = 0; pages < MAX_BACKFILL_PAGES; pages++) {
    const page = await transcript.page(sessionId, before, BACKFILL_PAGE_MESSAGES)
    if (before === null) {
      coveredTo = page.cursor
    }
    messages = [...page.messages, ...messages]
    coveredFrom = page.start
    const prose = digestTranscript(messages).entries.reduce(
      (sum, entry) => sum + entry.text.length,
      0
    )
    if (!page.more || page.messages.length === 0 || prose >= RECAP_CHUNK_CHARS * RECAP_MAX_CHUNKS) {
      break
    }
    before = page.start
  }
  return { base: null, messages, coveredFrom, coveredTo }
}
