import {
  compareLiveSessions,
  isActiveLiveSession,
  liveSessionStatusGroup,
  type LiveSessionStatusGroup
} from './live-session-status'
import type { LiveSession } from './live-session-types'

export type LiveSessionGroupCounts = Record<LiveSessionStatusGroup, number>

/** How many sessions need the user, are busy, sit idle or have ended: the counts every overview shows. */
export function countLiveSessionGroups(
  sessions: readonly Pick<LiveSession, 'status'>[]
): LiveSessionGroupCounts {
  const counts: LiveSessionGroupCounts = { attention: 0, working: 0, idle: 0, finished: 0 }
  for (const session of sessions) {
    counts[liveSessionStatusGroup(session.status)] += 1
  }
  return counts
}

/** Running sessions blocked on the user or failed, most urgent first. */
export function liveSessionsNeedingAttention<
  T extends Pick<LiveSession, 'alive' | 'status' | 'lastActivityAt'>
>(sessions: readonly T[]): T[] {
  return sessions
    .filter(
      (session) =>
        isActiveLiveSession(session) && liveSessionStatusGroup(session.status) === 'attention'
    )
    .sort(compareLiveSessions)
}

/** Pinned first, then by urgency: the order every list of running sessions uses. */
export function compareListedLiveSessions(
  a: Pick<LiveSession, 'pinned' | 'status' | 'lastActivityAt'>,
  b: Pick<LiveSession, 'pinned' | 'status' | 'lastActivityAt'>
): number {
  return Number(b.pinned === true) - Number(a.pinned === true) || compareLiveSessions(a, b)
}
