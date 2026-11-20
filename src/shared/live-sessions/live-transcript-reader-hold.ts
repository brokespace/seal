import type { NativeChatMessage } from '../native-chat/native-chat-types'
import type { LiveTranscriptCursor } from './live-session-types'

/** Rows that take the place of the ones on view: a newest page, and what was written after it. */
export type LiveTranscriptReplacement = {
  byId: Map<string, NativeChatMessage>
  /** Where the oldest of the rows starts. */
  start: LiveTranscriptCursor
  cursor: LiveTranscriptCursor
  /** Whether older rows can be read before `start`. */
  more: boolean
}

/**
 * Keeps a transcript's rows under a reader who has scrolled away from its end. A newest page that
 * would replace them (the watch fell far behind, or the file was rewritten) waits here, with the
 * rows written after it, and is shown once every such reader is back at the end.
 */
export class LiveTranscriptReaderHold {
  private away = 0
  private waiting: LiveTranscriptReplacement | null = null

  constructor(private readonly show: (rows: LiveTranscriptReplacement) => void) {}

  /** A reader left the end; the returned call says they are back. */
  retain(): () => void {
    let held = true
    this.away++
    return () => {
      if (!held) {
        return
      }
      held = false
      this.away--
      const rows = this.waiting
      if (this.away === 0 && rows) {
        this.waiting = null
        this.show(rows)
      }
    }
  }

  /** Shows `rows` now, or once every reader is back when one is away from rows on view. */
  replace(rows: LiveTranscriptReplacement, rowsOnView: boolean): void {
    if (this.away > 0 && rowsOnView) {
      this.waiting = rows
      return
    }
    this.waiting = null
    this.show(rows)
  }

  /** Rows written after a waiting replacement join it; false when none waits. */
  append(messages: readonly NativeChatMessage[], cursor: LiveTranscriptCursor): boolean {
    if (!this.waiting) {
      return false
    }
    for (const message of messages) {
      this.waiting.byId.set(message.id, message)
    }
    this.waiting.cursor = cursor
    return true
  }

  /** How far the waiting rows read; null when none wait. */
  get waitingCursor(): LiveTranscriptCursor | null {
    return this.waiting?.cursor ?? null
  }
}
