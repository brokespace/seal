import { projectStructuredItemsToNativeChat } from '../../../shared/agent-session/view/structured-agent-session-projection'
import { localChatSessionId } from '../../../shared/live-sessions/live-session-paired-server'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { JournalTranscript } from './journal-transcript-watch'

const DEFAULT_PAGE = 200

/** A chat's conversation as its own view shows it, read from the journal its host keeps. */
async function structuredSessionTranscript(sessionId: string): Promise<NativeChatMessage[]> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return []
  }
  return projectStructuredItemsToNativeChat((await host.journalSnapshot(sessionId)).items)
}

/**
 * The journal of a chat this Seal's own host holds, read as the record's transcript; null for any
 * other session. Its cursors count messages, where a transcript file's count bytes.
 */
export function structuredSessionJournal(session: LiveSession | null): JournalTranscript | null {
  const chat = localChatSessionId(session)
  if (!session || chat === null) {
    return null
  }
  return {
    async page(before, limit = DEFAULT_PAGE) {
      const messages = await structuredSessionTranscript(chat)
      const end = Math.min(before ?? messages.length, messages.length)
      const start = Math.max(0, end - limit)
      return {
        sessionId: session.id,
        messages: messages.slice(start, end),
        cursor: messages.length,
        start,
        more: start > 0
      }
    },
    /** `shrank` when a rewind cut the chat's history below `cursor`. */
    async since(cursor) {
      const messages = await structuredSessionTranscript(chat)
      return cursor > messages.length
        ? { messages: [], cursor, shrank: true }
        : { messages: messages.slice(cursor), cursor: messages.length, shrank: false }
    }
  }
}
