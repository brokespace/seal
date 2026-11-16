import type { LiveSessionService } from '../live-session-service'
import { structuredChatJournal } from './journal-session-transcript'
import { sessionTranscripts, type SessionTranscripts } from './session-transcript'

/** Every transcript this host can read: its registry's files, and the journals of the chats it holds. */
export function liveSessionTranscripts(liveSessions: LiveSessionService): SessionTranscripts {
  return sessionTranscripts((sessionId) => liveSessions.registry.get(sessionId), {
    files: {
      page: (sessionId, before, limit) => liveSessions.transcriptPage(sessionId, before, limit),
      since: (sessionId, cursor) => liveSessions.transcriptSince(sessionId, cursor)
    },
    journal: structuredChatJournal
  })
}
