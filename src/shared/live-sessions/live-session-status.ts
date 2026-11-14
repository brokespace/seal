import type { LiveSession, LiveSessionStatus } from './live-session-types'

/** Where a status sorts and how it is colored: attention first, then busy, then quiet. */
export type LiveSessionStatusGroup = 'attention' | 'working' | 'idle' | 'finished'

const GROUPS: Record<LiveSessionStatus, LiveSessionStatusGroup> = {
  'needs-permission': 'attention',
  'waiting-input': 'attention',
  errored: 'attention',
  working: 'working',
  'waiting-subagent': 'working',
  'waiting-task': 'working',
  idle: 'idle',
  done: 'finished'
}

const RANK: Record<LiveSessionStatus, number> = {
  'needs-permission': 0,
  'waiting-input': 1,
  errored: 2,
  working: 3,
  'waiting-subagent': 4,
  'waiting-task': 5,
  idle: 6,
  done: 7
}

export function liveSessionStatusGroup(status: LiveSessionStatus): LiveSessionStatusGroup {
  return GROUPS[status]
}

export function liveSessionStatusRank(status: LiveSessionStatus): number {
  return RANK[status]
}

/** Still running, or stopped with a turn the user has to look at. */
export function isActiveLiveSession(session: Pick<LiveSession, 'alive' | 'status'>): boolean {
  return session.alive || GROUPS[session.status] === 'working'
}

/** Needs-attention first, then working, then idle; newest activity first inside each. */
export function compareLiveSessions(
  a: Pick<LiveSession, 'status' | 'lastActivityAt'>,
  b: Pick<LiveSession, 'status' | 'lastActivityAt'>
): number {
  return RANK[a.status] - RANK[b.status] || b.lastActivityAt - a.lastActivityAt
}

/** The most urgent status among sessions, for a badge that stands for several. */
export function topLiveSessionStatus(
  statuses: readonly LiveSessionStatus[]
): LiveSessionStatus | null {
  let top: LiveSessionStatus | null = null
  for (const status of statuses) {
    if (top === null || RANK[status] < RANK[top]) {
      top = status
    }
  }
  return top
}
