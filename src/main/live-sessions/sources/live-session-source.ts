import type { LiveSession } from '../../../shared/live-sessions/live-session-types'

/** Sessions whose records arrive complete: this machine's chats, a paired server's own registry. */
export type LiveSessionSource = {
  sessions(): LiveSession[]
  /** Changes come between scans; the registry republishes on each. */
  subscribe(onChange: () => void): () => void
}
