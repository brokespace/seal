import type { AgentListStatus } from '../agent-status/presentation/agent-list-status'
import type { AgentSessionStatusEvidence } from './adapters/agent-session-adapter'
import type { LiveSession, LiveSessionStatus } from './live-session-types'

/**
 * The status of a session whose source reports events, not a transcript: a chat's structured host
 * and a pane's hook row. No source picks a code itself. First match wins, in the order of
 * `docs/design/agent-status.md`: the end of the agent, a prompt, the turn, what it left behind.
 */
export function liveSessionStatusFromEvidence(
  evidence: AgentSessionStatusEvidence
): LiveSessionStatus {
  if (evidence.ended) {
    // A failure outlasts its agent.
    return evidence.turnFailed ? 'errored' : 'done'
  }
  if (evidence.pendingApproval) {
    return 'needs-permission'
  }
  if (evidence.pendingQuestion) {
    return 'waiting-input'
  }
  if (evidence.turnRunning) {
    if (evidence.shellRunning) {
      return 'running-shell'
    }
    if (evidence.runningSubagents > 0) {
      return 'waiting-subagent'
    }
    return evidence.waitsOnBackgroundTask ? 'waiting-task' : 'working'
  }
  // A failed turn stays news while what it left running goes on.
  if (evidence.turnFailed) {
    return 'errored'
  }
  if (evidence.runningSubagents > 0) {
    return 'waiting-subagent'
  }
  // Commands, monitors and wake-ups a turn left behind hold nothing: the next move is the user's.
  return evidence.hadTurn ? 'your-turn' : 'idle'
}

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

/** Blocked on work it started: subagents, in a turn or behind one, or a background task inside a turn. */
export function isWaitingOnBackgroundWork(status: LiveSessionStatus): boolean {
  return status === 'waiting-subagent' || status === 'waiting-task'
}

/** The turn is the agent's own and still going, a wait on a background task included. */
export function isTurnRunningLiveSessionStatus(status: LiveSessionStatus): boolean {
  return status === 'working' || status === 'running-shell' || status === 'waiting-task'
}

/** The turn has stopped, for its user or on its subagents: what a summary and a recap describe. */
export function isSettledLiveSessionStatus(status: LiveSessionStatus): boolean {
  return (
    status === 'waiting-input' ||
    isRestingLiveSessionStatus(status) ||
    status === 'waiting-subagent'
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

/** A chat at its prompt: its host starts the agent again with the next message. */
function isOpenChatAtPrompt(
  session: Pick<LiveSession, 'status'> & Partial<Pick<LiveSession, 'surface'>>
): boolean {
  return (
    session.surface?.kind === 'chat' &&
    (session.status === 'your-turn' || session.status === 'idle')
  )
}

/**
 * Still running: its process is there, or its status is one only a running agent has. A host that
 * cannot list processes still reports a busy or blocked agent, which must not read as finished.
 * A chat whose agent rests is still open: only a closed chat reads `done`.
 */
export function isActiveLiveSession(
  session: Pick<LiveSession, 'alive' | 'status'> & Partial<Pick<LiveSession, 'surface'>>
): boolean {
  return (
    session.alive ||
    GROUPS[session.status] === 'working' ||
    isBlockedOnUserNow(session.status) ||
    isOpenChatAtPrompt(session)
  )
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
