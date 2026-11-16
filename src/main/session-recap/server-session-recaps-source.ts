import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type {
  LiveSessionRecapBrief,
  RecapItemMark,
  SessionRecapView
} from '../../shared/session-recap/session-recap-types'

/** The recaps a paired Seal server keeps for the sessions it runs, as this host shows them. */
export type ServerSessionRecapsSource = {
  /** A server runs this session, so its recap is that server's to keep: this host makes none. */
  owns(session: LiveSession): boolean
  /** What the server last said the row shows; null until it has answered, and when it keeps none. */
  brief(session: LiveSession): LiveSessionRecapBrief | null
  /** A session the server runs changed: its brief is read again. */
  observe(session: LiveSession): void
  forget(sessionId: string): void
  view(session: LiveSession, look: boolean): Promise<SessionRecapView>
  refresh(session: LiveSession): Promise<SessionRecapView>
  mark(session: LiveSession, itemId: string, mark: RecapItemMark | null): Promise<SessionRecapView>
}
