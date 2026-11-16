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
  server(sessionId: string): Pick<FederatedTranscripts, 'page' | 'since' | 'watch'> | null
  /** Transcript files: CLI and external sessions this Seal scans. */
  files: Pick<LiveTranscriptStreams, 'page' | 'since' | 'subscribe'>
  /** Tells of every change to the session list; returns how to stop being told. */
  onSessionsChanged(listener: () => void): () => void
  log?: (message: string, error?: unknown) => void
}

type TranscriptHolder = 'server' | 'journal' | 'files'

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
    let stopped = false
    let holder = this.holderOf(sessionId) ?? 'files'
    let followed = this.follow(holder, sessionId, fromCursor, listener)
    // Who holds a transcript can change under a watcher: a chat listed after the watch began, a
    // CLI continued in Chat. Cursors differ between holders, so the new one starts from its page.
    const off = this.deps.onSessionsChanged(() => {
      const next = this.holderOf(sessionId)
      if (stopped || next === null || next === holder) {
        return
      }
      followed.unsubscribe()
      holder = next
      const reopened = this.follow(next, sessionId, null, listener)
      followed = reopened
      void reopened.ready.then(
        (page) => {
          if (page && !stopped && followed === reopened) {
            const { cursor, messages } = page
            listener({ sessionId, from: 0, cursor, messages, reset: true })
          }
        },
        (error: unknown) =>
          this.deps.log?.(`[live-sessions] reading the transcript of ${sessionId} failed`, error)
      )
    })
    return {
      ready: followed.ready,
      unsubscribe: () => {
        stopped = true
        off()
        followed.unsubscribe()
      }
    }
  }

  /** Who holds a listed session's transcript; null while the session is not listed. */
  private holderOf(sessionId: string): TranscriptHolder | null {
    const session = this.deps.session(sessionId)
    if (!session) {
      return null
    }
    if (this.deps.server(sessionId)) {
      return 'server'
    }
    return structuredSessionJournal(session) ? 'journal' : 'files'
  }

  private follow(
    holder: TranscriptHolder,
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    const server = holder === 'server' ? this.deps.server(sessionId) : null
    if (server) {
      return server.watch(sessionId, fromCursor, listener)
    }
    return holder === 'journal'
      ? watchJournalTranscript(
          sessionId,
          () => structuredSessionJournal(this.deps.session(sessionId)),
          fromCursor,
          listener,
          { log: this.deps.log }
        )
      : this.deps.files.subscribe(sessionId, fromCursor, listener)
  }
}
