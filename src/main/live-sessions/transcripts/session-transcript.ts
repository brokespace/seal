import type {
  LiveSession,
  LiveTranscriptCursor,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import { liveSessionSurfaceOf } from '../../../shared/live-sessions/live-session-surface'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import type { LiveTranscriptStreams } from './live-transcript-streams'

/** One session's conversation as the session services read it, wherever it is kept. */
export type SessionTranscript = {
  /** The newest `limit` messages before `before`; the transcript's end when null. */
  page(before: LiveTranscriptCursor | null, limit?: number): Promise<LiveTranscriptPage>
  /** Everything from `cursor` on; `shrank` when what `cursor` pointed into was rewritten. */
  since(
    cursor: LiveTranscriptCursor
  ): Promise<{ messages: NativeChatMessage[]; cursor: LiveTranscriptCursor; shrank: boolean }>
}

export type SessionTranscriptSources = {
  /** Transcript files: CLI and external sessions. */
  files: Pick<LiveTranscriptStreams, 'page' | 'since'>
  /** A chat's journal, read as `recordId`; null when this host does not hold the chat. */
  journal: (chatSessionId: string, recordId: string) => SessionTranscript | null
}

function journalOf(session: LiveSession, sources: SessionTranscriptSources) {
  const surface = liveSessionSurfaceOf(session)
  return surface.kind === 'chat' ? sources.journal(surface.sessionId, session.id) : null
}

function fileTranscript(sessionId: string, sources: SessionTranscriptSources): SessionTranscript {
  return {
    page: (before, limit) => sources.files.page(sessionId, before, limit),
    since: (cursor) => sources.files.since(sessionId, cursor)
  }
}

/** A chat is read from its journal, which holds it whole; every other session from its transcript file. */
export function transcriptOf(
  session: LiveSession,
  sources: SessionTranscriptSources
): SessionTranscript {
  return journalOf(session, sources) ?? fileTranscript(session.id, sources)
}

export function hasSessionTranscript(
  session: LiveSession,
  sources: SessionTranscriptSources
): boolean {
  return Boolean(session.transcriptPath) || journalOf(session, sources) !== null
}

/** Transcripts by registry id, for the services that follow sessions through the registry. */
export type SessionTranscripts = {
  of(sessionId: string): SessionTranscript
  has(session: LiveSession): boolean
}

export function sessionTranscripts(
  session: (sessionId: string) => LiveSession | null,
  sources: SessionTranscriptSources
): SessionTranscripts {
  return {
    of: (sessionId) => {
      const found = session(sessionId)
      return found ? transcriptOf(found, sources) : fileTranscript(sessionId, sources)
    },
    has: (found) => hasSessionTranscript(found, sources)
  }
}
