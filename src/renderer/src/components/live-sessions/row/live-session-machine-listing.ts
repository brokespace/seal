import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'

export const RECENTLY_FINISHED_MS = 24 * 60 * 60 * 1000

/** An ended session stays listed for a day, and for as long as it is pinned. */
export function isRecentlyFinishedLiveSession(
  session: Pick<LiveSession, 'lastActivityAt' | 'pinned'>,
  now: number
): boolean {
  return now - session.lastActivityAt <= RECENTLY_FINISHED_MS || session.pinned === true
}

/** What a sessions list shows at all: every running session, and an ended one while it is recent or pinned. */
export function isListedLiveSession(session: LiveSession, now: number): boolean {
  return isActiveLiveSession(session) || isRecentlyFinishedLiveSession(session, now)
}
