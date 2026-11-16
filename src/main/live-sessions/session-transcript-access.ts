import type {
  LiveSession,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../shared/live-sessions/live-session-types'
import type { FederatedTranscripts } from './federation/federated-transcripts'
import { watchJournalTranscript } from './sources/journal-transcript-watch'
import { structuredSessionJournal } from './sources/structured-session-transcript'
import type {
  LiveTranscriptStreams,
  LiveTranscriptSubscription
} from './transcripts/live-transcript-streams'

export type SessionTranscriptAccessDeps = {
  session(sessionId: string): LiveSession | null
  /** The paired server whose own list holds the session; null for one this Seal reads itself. */
  server(sessionId: string): FederatedTranscripts | null
  /** Transcript files: CLI and external sessions this Seal scans. */
  files: Pick<LiveTranscriptStreams, 'page' | 'since' | 'subscribe'>
  log?: (message: string, error?: unknown) => void
}

/** A session's transcript, read from whoever holds it: its server, its chat's journal, or its file. */
export class SessionTranscriptAccess {
  constructor(private readonly deps: SessionTranscriptAccessDeps) {}

  page(
    sessionId: string,
    before: LiveTranscriptCursor | null,
    limit?: number
  ): Promise<LiveTranscriptPage> {
    const server = this.deps.server(sessionId)
    if (server) {
      return server.page(sessionId, before, limit)
    }
    const journal = structuredSessionJournal(this.deps.session(sessionId))
    return journal ? journal.page(before, limit) : this.deps.files.page(sessionId, before, limit)
  }

  /** What a transcript gained after `cursor`; `shrank` when it was rewritten shorter. */
  since(
    sessionId: string,
    cursor: LiveTranscriptCursor
  ): ReturnType<LiveTranscriptStreams['since']> {
    const server = this.deps.server(sessionId)
    if (server) {
      return server.since(sessionId, cursor)
    }
    const journal = structuredSessionJournal(this.deps.session(sessionId))
    return journal ? journal.since(cursor) : this.deps.files.since(sessionId, cursor)
  }

  watch(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    const server = this.deps.server(sessionId)
    if (server) {
      return server.watch(sessionId, fromCursor, listener)
    }
    const journal = (): ReturnType<typeof structuredSessionJournal> =>
      structuredSessionJournal(this.deps.session(sessionId))
    return journal()
      ? watchJournalTranscript(sessionId, journal, fromCursor, listener, { log: this.deps.log })
      : this.deps.files.subscribe(sessionId, fromCursor, listener)
  }
}
