// A session's status from its transcript turn, refined by what it runs in the background.
import type { LiveSessionStatus } from '../../../shared/live-sessions/live-session-types'
import {
  backgroundWaitLabel,
  runningBackgroundTasks,
  runningSubagents,
  type LiveSessionActivity
} from '../../../shared/live-sessions/live-session-activity'
import { CLAUDE_SUBAGENT_TOOLS } from './claude-transcript-phase'
import type { TranscriptTurn } from './transcript-summary'

/** A reply with no end-of-turn record may be followed by a tool call a moment later. */
const UNSETTLED_REPLY_MS = 5_000

/** Where an agent with nothing running stands: it asked the user something, or it is idle. */
export function restingStatus(turn: TranscriptTurn | undefined): LiveSessionStatus {
  return turn?.phase === 'input-requested' || (turn?.phase === 'turn-ended' && turn.asksUser)
    ? 'waiting-input'
    : 'idle'
}

export function turnStatus(
  turn: TranscriptTurn | undefined,
  running: boolean,
  sinceLastWriteMs: number
): LiveSessionStatus {
  if (turn?.phase === 'errored') {
    return 'errored'
  }
  if (!running) {
    return 'done'
  }
  switch (turn?.phase) {
    case 'working':
    case 'tool-pending':
      return 'working'
    case 'approval-requested':
      return 'needs-permission'
    case 'turn-ended':
      return !turn.settled && sinceLastWriteMs < UNSETTLED_REPLY_MS
        ? 'working'
        : restingStatus(turn)
    case 'input-requested':
    case 'unknown':
    case undefined:
      return restingStatus(turn)
  }
}

function waitsOnSubagentCall(turn: TranscriptTurn | undefined): boolean {
  return (
    turn?.phase === 'tool-pending' &&
    turn.pendingTool !== null &&
    (CLAUDE_SUBAGENT_TOOLS.has(turn.pendingTool) || turn.pendingTool === 'wait_agent')
  )
}

export type StatusAndDetail = { status: LiveSessionStatus; statusDetail: string | null }

/**
 * An agent waiting for subagents or background commands it started is still busy: nothing for the
 * user to do. Only a question it put to the user explicitly outranks that.
 */
export function withBackgroundWait(
  current: StatusAndDetail,
  turn: TranscriptTurn | undefined,
  activity: LiveSessionActivity
): StatusAndDetail {
  const subagents = runningSubagents(activity).length
  const tasks = runningBackgroundTasks(activity).length
  if (current.status === 'working' && waitsOnSubagentCall(turn)) {
    return {
      status: 'waiting-subagent',
      statusDetail: backgroundWaitLabel(Math.max(subagents, 1), 0)
    }
  }
  const resting =
    current.status === 'idle' ||
    (current.status === 'waiting-input' && turn?.phase !== 'input-requested')
  if (resting && subagents + tasks > 0) {
    return {
      status: subagents > 0 ? 'waiting-subagent' : 'waiting-task',
      statusDetail: backgroundWaitLabel(subagents, tasks)
    }
  }
  return current
}
