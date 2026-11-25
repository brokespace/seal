import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import { replyAskOf } from '../live-sessions/discovery/reply-ask'
import { oneLine } from '../live-sessions/discovery/transcript-records'
import type { ReplyAskVerdict } from '../live-sessions/live-session-notifier'
import type { SessionSummarizer } from './session-summarizer'

export type LiveSessionReplyAsksDeps = {
  /** A summarizer running the reply-ask task. */
  classifier: Pick<SessionSummarizer, 'request' | 'clear' | 'forget' | 'view'>
  /** The agent's newest own words in the session's transcript; null when it has said nothing. */
  lastAssistantText: (sessionId: string) => Promise<string | null>
  log?: (message: string, error?: unknown) => void
}

type Tracked = {
  /** The finished turn last handled, so a rescan of the same one reads no transcript. */
  stamp: number | null
  reading: boolean
  again: boolean
  /** The reply the model was asked about, as a notification quotes it. */
  asked: string | null
}

function replyAskKey(sessionId: string): string {
  return `reply-ask:${sessionId}`
}

/** A finished turn nothing deterministic settled, or one this already relabelled. */
function undecided(session: LiveSession): boolean {
  return (
    session.alive &&
    (session.status === 'your-turn' ||
      (session.status === 'waiting-input' && session.statusSource === 'classifier'))
  )
}

/**
 * The model's say on finished turns the detector could not settle: a reply whose last words might
 * be a question ("should I go ahead" with no question mark, a question followed by a sign-off).
 * It only ever turns "Waiting on you" into "Asking you a question"; every other status is decided
 * without it, and with no model the session keeps "Waiting on you".
 */
export class LiveSessionReplyAsks {
  private readonly tracked = new Map<string, Tracked>()

  constructor(private readonly deps: LiveSessionReplyAsksDeps) {}

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'remove') {
      this.tracked.delete(event.sessionId)
      this.deps.classifier.forget(replyAskKey(event.sessionId))
      return
    }
    if (event.type !== 'upsert') {
      return
    }
    const { session } = event
    const tracked = this.tracked.get(session.id) ?? {
      stamp: null,
      reading: false,
      again: false,
      asked: null
    }
    this.tracked.set(session.id, tracked)
    if (!undecided(session)) {
      if (tracked.stamp !== null) {
        tracked.stamp = null
        tracked.asked = null
        this.deps.classifier.clear(replyAskKey(session.id))
      }
      return
    }
    if (tracked.stamp === session.lastActivityAt) {
      return
    }
    tracked.stamp = session.lastActivityAt
    this.read(session.id, tracked)
  }

  decorate(session: LiveSession): LiveSession {
    if (session.status !== 'your-turn' || !session.alive) {
      return session
    }
    return this.deps.classifier.view(replyAskKey(session.id))?.text === 'asks'
      ? { ...session, status: 'waiting-input', statusSource: 'classifier' }
      : session
  }

  /** Whether the finished turn's reply asks, once it has been read and the model has answered. */
  verdict(session: LiveSession): ReplyAskVerdict {
    if (session.status !== 'your-turn' || !session.alive) {
      return 'tells'
    }
    const tracked = this.tracked.get(session.id)
    // A turn's end reaches whoever asks in the same registry event, maybe before it is seen here.
    if (!tracked || tracked.stamp !== session.lastActivityAt || tracked.reading) {
      return 'deciding'
    }
    const view = this.deps.classifier.view(replyAskKey(session.id))
    if (view?.pending) {
      return 'deciding'
    }
    return view?.text === 'asks' ? 'asks' : 'tells'
  }

  /** The reply a session relabelled as asking ended on; null for any other session. */
  askedReply(sessionId: string): string | null {
    return this.tracked.get(sessionId)?.asked ?? null
  }

  dispose(): void {
    this.tracked.clear()
  }

  private read(sessionId: string, tracked: Tracked): void {
    if (tracked.reading) {
      tracked.again = true
      return
    }
    tracked.reading = true
    const stamp = tracked.stamp
    void this.deps
      .lastAssistantText(sessionId)
      .catch((error: unknown) => {
        this.deps.log?.('[session-status] reading a transcript failed', error)
        return null
      })
      .then((text) => {
        tracked.reading = false
        if (this.tracked.get(sessionId) !== tracked) {
          return
        }
        if (tracked.again) {
          tracked.again = false
          if (tracked.stamp !== null) {
            this.read(sessionId, tracked)
          }
          return
        }
        if (tracked.stamp !== stamp || stamp === null) {
          return
        }
        if (text && replyAskOf(text) === 'unclear') {
          tracked.asked = oneLine(text, 200)
          this.deps.classifier.request(replyAskKey(sessionId), text, false)
        } else {
          tracked.asked = null
          this.deps.classifier.clear(replyAskKey(sessionId))
        }
      })
  }
}
