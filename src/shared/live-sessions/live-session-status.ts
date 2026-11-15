import type { AgentListStatus } from '../agent-status/presentation/agent-list-status'
import type { LiveSession, LiveSessionStatus } from './live-session-types'

/** Where a status sorts and how it is colored: attention first, then busy, then quiet. */
export type LiveSessionStatusGroup = 'attention' | 'working' | 'idle' | 'finished'

const GROUPS: Record<LiveSessionStatus, LiveSessionStatusGroup> = {
  'needs-permission': 'attention',
  'waiting-input': 'attention',
  errored: 'attention',
  working: 'working',
  'running-shell': 'working',
  'waiting-subagent': 'working',
  'waiting-task': 'working',
  'your-turn': 'idle',
  idle: 'idle',
  done: 'finished'
}

const RANK: Record<LiveSessionStatus, number> = {
  'needs-permission': 0,
  'waiting-input': 1,
  errored: 2,
  working: 3,
  'running-shell': 4,
  'waiting-subagent': 5,
  'waiting-task': 6,
  'your-turn': 7,
  idle: 8,
  done: 9
}

const DOTS: Record<LiveSessionStatus, AgentListStatus> = {
  working: 'working',
  // Still the agent's move: drawn in the working color, not as something for the user.
  'running-shell': 'monitoring',
  'waiting-subagent': 'monitoring',
  'waiting-task': 'monitoring',
  'waiting-input': 'waiting',
  'needs-permission': 'permission',
  'your-turn': 'done',
  idle: 'idle',
  errored: 'failed',
  done: 'done'
}

/**
 * The color a status reads in at a glance, by whose move it is: the agent's (`busy`, `waiting`),
 * the user's right now (`approval`, `question`), the user's whenever (`turn`), nobody's (`quiet`).
 */
export type LiveSessionStatusTone =
  | 'busy'
  | 'waiting'
  | 'approval'
  | 'question'
  | 'turn'
  | 'failed'
  | 'quiet'

const TONES: Record<LiveSessionStatus, LiveSessionStatusTone> = {
  working: 'busy',
  'running-shell': 'busy',
  'waiting-subagent': 'waiting',
  'waiting-task': 'waiting',
  'needs-permission': 'approval',
  'waiting-input': 'question',
  'your-turn': 'turn',
  idle: 'quiet',
  errored: 'failed',
  done: 'quiet'
}

export function liveSessionStatusTone(status: LiveSessionStatus): LiveSessionStatusTone {
  return TONES[status]
}

/** The agent is at its prompt with nothing running: it took a turn and stopped, or never had one. */
export function isRestingLiveSessionStatus(status: LiveSessionStatus): boolean {
  return status === 'your-turn' || status === 'idle'
}

/** Parked on work running behind a finished turn; the agent picks itself up when it reports. */
export function isWaitingOnBackgroundWork(status: LiveSessionStatus): boolean {
  return status === 'waiting-subagent' || status === 'waiting-task'
}

/** The turn is the agent's own and still going. */
export function isTurnRunningLiveSessionStatus(status: LiveSessionStatus): boolean {
  return status === 'working' || status === 'running-shell'
}

/** The turn has stopped, for its user or on background work: what a summary and a recap describe. */
export function isSettledLiveSessionStatus(status: LiveSessionStatus): boolean {
  return (
    status === 'waiting-input' ||
    isRestingLiveSessionStatus(status) ||
    isWaitingOnBackgroundWork(status)
  )
}

/** The dot every surface draws for a status, on desktop and mobile. */
export function liveSessionDotState(status: LiveSessionStatus): AgentListStatus {
  return DOTS[status]
}

export function liveSessionStatusGroup(status: LiveSessionStatus): LiveSessionStatusGroup {
  return GROUPS[status]
}

export function liveSessionStatusRank(status: LiveSessionStatus): number {
  return RANK[status]
}

/** A prompt or a question holds the agent until the user answers; a failure outlasts its agent. */
function isBlockedOnUserNow(status: LiveSessionStatus): boolean {
  return status === 'needs-permission' || status === 'waiting-input'
}

/**
 * Still running: its process is there, or its status is one only a running agent has. A host that
 * cannot list processes still reports a busy or blocked agent, which must not read as finished.
 */
export function isActiveLiveSession(session: Pick<LiveSession, 'alive' | 'status'>): boolean {
  return session.alive || GROUPS[session.status] === 'working' || isBlockedOnUserNow(session.status)
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
