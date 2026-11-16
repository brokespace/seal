// A session's status from its transcript turn, refined by what it runs in the background.
import type { LiveSessionStatus } from '../../../shared/live-sessions/live-session-types'
import {
  backgroundWaitLabel,
  runningBackgroundTasks,
  runningSubagents,
  type LiveSessionActivity
} from '../../../shared/live-sessions/live-session-activity'
import { isRestingLiveSessionStatus } from '../../../shared/live-sessions/live-session-status'
import { CLAUDE_SUBAGENT_TOOLS } from './claude-transcript-phase'
import type { PendingCallKind, TranscriptTurn } from './transcript-summary'

/** A reply with no end-of-turn record may be followed by a tool call a moment later. */
const UNSETTLED_REPLY_MS = 5_000
/** A command shorter than this is part of the work; a longer one is what the session is doing. */
const RUNNING_SHELL_AFTER_MS = 3_000
/** `ps` counts whole seconds, and the transcript record lands a moment after the call was made. */
const PROCESS_START_SLACK_MS = 2_500
/** A shell call with no process, or an edit with no result, this long after it was made is held by a prompt. */
const SHELL_PROMPT_AFTER_MS = 5_000
const EDIT_PROMPT_AFTER_MS = 8_000
/** Claude's auto mode reviews a call on the server before it runs or asks. */
const REVIEWED_PROMPT_AFTER_MS = 20_000

/**
 * Where an agent with nothing running stands: it asked the user something, it finished a turn and
 * the next move is the user's, or it has had no turn at all.
 */
export function restingStatus(turn: TranscriptTurn | undefined): LiveSessionStatus {
  if (turn?.phase === 'errored') {
    return 'errored'
  }
  if (turn?.phase === 'input-requested') {
    return 'waiting-input'
  }
  if (turn?.phase === 'turn-ended') {
    return turn.replyAsk === 'asks' ? 'waiting-input' : 'your-turn'
  }
  return 'idle'
}

/** A question or an approval the transcript holds open until its answer is written after it. */
function heldPrompt(turn: TranscriptTurn | undefined): LiveSessionStatus | null {
  if (turn?.phase === 'input-requested') {
    return 'waiting-input'
  }
  return turn?.phase === 'approval-requested' ? 'needs-permission' : null
}

export function turnStatus(
  turn: TranscriptTurn | undefined,
  running: boolean,
  sinceLastWriteMs: number,
  /** The host listed its processes and none of them can still be holding this session. */
  gone = false
): LiveSessionStatus {
  if (turn?.phase === 'errored') {
    return 'errored'
  }
  // Nothing is written while a prompt waits, so a quiet transcript does not end it: only a host
  // that listed its processes and has nobody left to answer does.
  const held = heldPrompt(turn)
  if (held && !gone) {
    return held
  }
  if (!running) {
    return 'done'
  }
  switch (turn?.phase) {
    case 'working':
    case 'tool-pending':
      return 'working'
    case 'approval-requested':
    case 'input-requested':
      return held!
    case 'turn-ended':
      return !turn.settled && sinceLastWriteMs < UNSETTLED_REPLY_MS
        ? 'working'
        : restingStatus(turn)
    case 'unknown':
    case undefined:
      return restingStatus(turn)
  }
}

/** Approval modes (Claude's, and Codex's `never`) under which no prompt ever holds a call. */
const NEVER_ASKS: ReadonlySet<string> = new Set(['bypassPermissions', 'dontAsk', 'never'])

/** How long a pending call may stand with nothing running before a prompt must be holding it; null when the agent never asks. */
function promptAfterMs(
  kind: Exclude<PendingCallKind, 'shell-wait'>,
  approvalMode: string | null
): number | null {
  if (approvalMode !== null && NEVER_ASKS.has(approvalMode)) {
    return null
  }
  if (approvalMode === 'auto') {
    return REVIEWED_PROMPT_AFTER_MS
  }
  if (kind === 'edit') {
    return approvalMode === 'acceptEdits' ? null : EDIT_PROMPT_AFTER_MS
  }
  return SHELL_PROMPT_AFTER_MS
}

export type PendingCallEvidence = {
  /** When each command under the agent started; null when the host could not list them. */
  processStarts: number[] | null
  approvalMode: string | null
  nowMs: number
}

/**
 * A pending shell or edit call read against the agent's processes: the command is running, or
 * nothing is and a permission prompt holds the call. Null leaves the transcript's `working`.
 */
export function pendingCallStatus(
  turn: TranscriptTurn | undefined,
  evidence: PendingCallEvidence
): Extract<LiveSessionStatus, 'running-shell' | 'needs-permission'> | null {
  if (
    turn?.phase !== 'tool-pending' ||
    turn.pendingKind === null ||
    turn.pendingSince === null ||
    evidence.processStarts === null
  ) {
    return null
  }
  if (turn.pendingKind === 'shell-wait') {
    return evidence.processStarts.length > 0 ? 'running-shell' : null
  }
  const pendingFor = evidence.nowMs - turn.pendingSince
  const since = turn.pendingSince - PROCESS_START_SLACK_MS
  if (turn.pendingKind === 'shell' && evidence.processStarts.some((start) => start >= since)) {
    return pendingFor >= RUNNING_SHELL_AFTER_MS ? 'running-shell' : null
  }
  const promptAfter = promptAfterMs(turn.pendingKind, evidence.approvalMode)
  return promptAfter !== null && pendingFor >= promptAfter ? 'needs-permission' : null
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
    isRestingLiveSessionStatus(current.status) ||
    (current.status === 'waiting-input' && turn?.phase !== 'input-requested')
  if (resting && subagents + tasks > 0) {
    return {
      status: subagents > 0 ? 'waiting-subagent' : 'waiting-task',
      statusDetail: backgroundWaitLabel(subagents, tasks)
    }
  }
  return current
}
