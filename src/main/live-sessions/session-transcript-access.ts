import type {
  LiveSession,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../shared/live-sessions/live-session-types'
import type { FederatedTranscripts } from './federation/federated-transcripts'
import { watchJournalTranscript } from './sources/journal-transcript-watch'
import { structuredChatJournal } from './transcripts/journal-session-transcript'
import type {
  LiveTranscriptStreams,
  LiveTranscriptSubscription
} from './transcripts/live-transcript-streams'
import { chatJournalOf, type SessionTranscript } from './transcripts/session-transcript'

export type SessionTranscriptAccessDeps = {
  session(sessionId: string): LiveSession | null
  /** The paired server whose own list holds the session; null for one this Seal reads itself. */
  server(
    sessionId: string
  ): Pick<FederatedTranscripts, 'page' | 'since' | 'watch' | 'imageBase64'> | null
  /** Transcript files: CLI and external sessions this Seal scans. */
  files: Pick<LiveTranscriptStreams, 'page' | 'since' | 'subscribe' | 'imageBase64'>
  /** Tells of every change to the session list; returns how to stop being told. */
  onSessionsChanged(listener: () => void): () => void
  log?: (message: string, error?: unknown) => void
}

type TranscriptHolder = 'server' | 'journal' | 'files'

const journalOf = (session: LiveSession | null): SessionTranscript | null =>
  chatJournalOf(session, structuredChatJournal)

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
    const journal = journalOf(this.deps.session(sessionId))
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
    const journal = journalOf(this.deps.session(sessionId))
    return journal ? journal.since(cursor) : this.deps.files.since(sessionId, cursor)
  }

  /** A base64 run of the transcript an image row refers to; empty when it is not there. */
  imageBase64(sessionId: string, start: number, length: number): Promise<string> {
    const server = this.deps.server(sessionId)
    return server
      ? server.imageBase64(sessionId, start, length)
      : this.deps.files.imageBase64(sessionId, start, length)
  }

  watch(
    sessionId: string,
    fromCursor: LiveTranscriptCursor | null,
    listener: (delta: LiveTranscriptDelta) => void
  ): LiveTranscriptSubscription {
    let stopped = false
    let holder = this.holderOf(sessionId) ?? 'files'
    // A watcher at zero has read nothing: it is given the newest page, not the history up to it.
    const unread = fromCursor === 0
    let followed = this.follow(holder, sessionId, unread ? null : fromCursor, listener)
    const resetTo = (opened: LiveTranscriptSubscription): void => {
      void opened.ready.then(
        (page) => {
          if (page && !stopped && followed === opened) {
            const { cursor, messages } = page
            listener({ sessionId, from: 0, cursor, messages, reset: true })
          }
        },
        (error: unknown) =>
          this.deps.log?.(`[live-sessions] reading the transcript of ${sessionId} failed`, error)
      )
    }
    if (unread) {
      resetTo(followed)
    }
    // Who holds a transcript can change under a watcher: a chat listed after the watch began, a
    // CLI continued in Chat. Cursors differ between holders, so the new one starts from its page.
    const off = this.deps.onSessionsChanged(() => {
      const next = this.holderOf(sessionId)
      if (stopped || next === null || next === holder) {
        return
      }
      followed.unsubscribe()
      holder = next
      followed = this.follow(next, sessionId, null, listener)
      resetTo(followed)
    })
    return {
      ready: unread ? Promise.resolve(null) : followed.ready,
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
    return journalOf(session) ? 'journal' : 'files'
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
          () => journalOf(this.deps.session(sessionId)),
          fromCursor,
          listener,
          { log: this.deps.log }
        )
      : this.deps.files.subscribe(sessionId, fromCursor, listener)
  }
}
