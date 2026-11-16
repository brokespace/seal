// What a Claude Code session leaves running after the turn that started it, as its transcript
// records it: the launching call, the result that names the task, and the notifications about it.
import type { LiveSubagentStatus } from '../../../shared/live-sessions/live-session-activity'
import { isClaudeTerminalBackgroundTaskStatus } from '../../../shared/agent-hook-listener/providers/claude/background-tasks/claude-background-task-inventory'
import { oneLine, str } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

/**
 * A shell (`run_in_background`, or a command moved to the background by its timeout or Ctrl+B),
 * a `Monitor` watch, a workflow, or a wake-up the agent scheduled for itself.
 */
export type ClaudeBackgroundTaskKind = 'shell' | 'monitor' | 'workflow' | 'wakeup'

export type ClaudeBackgroundLaunch = {
  /** The launching call; the task id when only a notification named the task. */
  toolUseId: string
  kind: ClaudeBackgroundTaskKind
  /** Null until the launch's result names the task: a call that stays in the foreground never does. */
  taskId: string | null
  label: string
  status: LiveSubagentStatus
  startedAt: number | null
  summary: string | null
  /** When it is over by itself (epoch ms): a monitor's timeout, a wake-up's fire time. */
  endsAt: number | null
  /** A command under the agent carries it, so it is over once the agent has none left running. */
  runsCommand: boolean
}

export type ClaudeBackgroundLaunches = Map<string, ClaudeBackgroundLaunch>

// Any Bash call may end up in the background (its timeout, Ctrl+B); only its result says which.
const BACKGROUND_TOOLS: Partial<Record<string, ClaudeBackgroundTaskKind>> = {
  Bash: 'shell',
  Monitor: 'monitor',
  Workflow: 'workflow',
  ScheduleWakeup: 'wakeup'
}

function launchLabel(kind: ClaudeBackgroundTaskKind, input: TranscriptRecord | null): string {
  if (kind === 'wakeup') {
    const reason = str(input?.reason)
    return reason ? `Scheduled wake-up: ${reason}` : 'Scheduled wake-up'
  }
  if (kind === 'shell') {
    return str(input?.command) ?? str(input?.description) ?? 'Background command'
  }
  return (
    str(input?.description) ??
    str(input?.command) ??
    str(input?.name) ??
    (kind === 'monitor' ? 'Monitor' : 'Workflow')
  )
}

/** Records a call that may leave something running; false when the tool never does. */
export function openBackgroundLaunch(
  launches: ClaudeBackgroundLaunches,
  call: { id: string; name: string; input: TranscriptRecord | null; at: number | null }
): boolean {
  const kind = BACKGROUND_TOOLS[call.name]
  if (!kind) {
    return false
  }
  if (!launches.has(call.id)) {
    launches.set(call.id, {
      toolUseId: call.id,
      kind,
      taskId: null,
      label: oneLine(launchLabel(kind, call.input), 160),
      status: 'running',
      startedAt: call.at,
      summary: null,
      endsAt: null,
      runsCommand: kind === 'shell' || (kind === 'monitor' && str(call.input?.command) !== null)
    })
  }
  return true
}

/** The id a launch's result gives its task; null when the call ran in the foreground. */
function launchedTaskId(
  launch: ClaudeBackgroundLaunch,
  outcome: TranscriptRecord | null
): string | null {
  switch (launch.kind) {
    case 'shell':
      return str(outcome?.backgroundTaskId)
    case 'monitor':
      return str(outcome?.taskId)
    case 'workflow':
      return outcome?.status === 'async_launched' || outcome?.status === 'remote_launched'
        ? str(outcome.taskId)
        : null
    case 'wakeup':
      return typeof outcome?.scheduledFor === 'number' && outcome.stopped !== true
        ? `wakeup-${launch.toolUseId}`
        : null
  }
}

function startedBefore(launch: ClaudeBackgroundLaunch, at: number | null): boolean {
  return at === null || launch.startedAt === null || launch.startedAt < at
}

/** Ends the wake-ups scheduled before `at`: the agent holds one at a time, and it fires once. */
export function endWakeupsBefore(
  launches: ClaudeBackgroundLaunches,
  at: number | null,
  status: LiveSubagentStatus
): void {
  for (const launch of launches.values()) {
    if (launch.kind === 'wakeup' && launch.status === 'running' && startedBefore(launch, at)) {
      launch.status = status
    }
  }
}

/** Reads a launch's result: the call left a task running, or it ran in the foreground and is over. */
export function settleBackgroundLaunch(
  launches: ClaudeBackgroundLaunches,
  launch: ClaudeBackgroundLaunch,
  outcome: TranscriptRecord | null
): void {
  if (launch.kind === 'wakeup' && (outcome?.stopped === true || outcome?.cancelledWakeups)) {
    endWakeupsBefore(launches, launch.startedAt, 'stopped')
  }
  launch.taskId = launchedTaskId(launch, outcome) ?? launch.taskId
  if (!launch.taskId) {
    launches.delete(launch.toolUseId)
  } else if (launch.kind === 'monitor' && typeof outcome?.timeoutMs === 'number') {
    launch.endsAt =
      outcome.persistent !== true && launch.startedAt !== null
        ? launch.startedAt + outcome.timeoutMs
        : null
  } else if (launch.kind === 'wakeup' && typeof outcome?.scheduledFor === 'number') {
    launch.endsAt = outcome.scheduledFor
    endWakeupsBefore(launches, launch.startedAt, 'completed')
  }
}

/** A call with no result in what was read ran in the foreground of a turn that is over by `at`. */
export function dropForegroundCallsBefore(launches: ClaudeBackgroundLaunches, at: number | null) {
  for (const [id, launch] of launches) {
    if (launch.taskId === null && startedBefore(launch, at)) {
      launches.delete(id)
    }
  }
}

const FAILED_ENDS: ReadonlySet<string> = new Set(['failed', 'error', 'crashed', 'timed_out'])
const STOPPED_ENDS: ReadonlySet<string> = new Set([
  'killed',
  'stopped',
  'cancelled',
  'canceled',
  'terminated',
  'aborted'
])

/**
 * How a notification says its task ended; null when it reports on a task that is still running
 * (a `Monitor` event, a "still running" check-in): those carry no `<status>`.
 */
export function backgroundTaskEnd(status: string | null): LiveSubagentStatus | null {
  const named = status?.trim().toLowerCase() ?? ''
  if (!isClaudeTerminalBackgroundTaskStatus(named)) {
    return null
  }
  if (FAILED_ENDS.has(named)) {
    return 'failed'
  }
  return STOPPED_ENDS.has(named) ? 'stopped' : 'completed'
}

const MONITOR_EVENT = /^Monitor event: "([\s\S]*?)"/
const COMMAND_CHECK_IN = /^Background command "([\s\S]*?)" is still running/

/** A task the transcript reports on while it runs, launched before the part of it that was read. */
export function noteRunningTask(
  launches: ClaudeBackgroundLaunches,
  taskId: string | null,
  summary: string | null
): void {
  const monitor = summary ? MONITOR_EVENT.exec(summary)?.[1] : undefined
  const command = summary ? COMMAND_CHECK_IN.exec(summary)?.[1] : undefined
  const label = monitor ?? command
  if (!taskId || label === undefined) {
    return
  }
  if ([...launches.values()].some((launch) => launch.taskId === taskId)) {
    return
  }
  launches.set(taskId, {
    toolUseId: taskId,
    kind: monitor !== undefined ? 'monitor' : 'shell',
    taskId,
    label: oneLine(label, 160),
    status: 'running',
    startedAt: null,
    summary: null,
    endsAt: null,
    // A monitor may watch a socket instead of a command; its launch would have said.
    runsCommand: monitor === undefined
  })
}
