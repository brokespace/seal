// What a Claude Code session leaves running after the turn that started it, as its transcript
// records it: the launching call, the result that names the task, and the notifications about it.
import type { LiveSubagentStatus } from '../../../shared/live-sessions/live-session-activity'
import { isClaudeTerminalBackgroundTaskStatus } from '../../../shared/claude-background-task-inventory'
import { detachedJobNames, leavesJobRunning } from './detached-shell-jobs'
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
  /** What it runs and what the agent called it, for whoever asks what the agent waits on. */
  command: string | null
  description: string | null
  status: LiveSubagentStatus
  startedAt: number | null
  summary: string | null
  /** When it is over by itself (epoch ms): a monitor's timeout, a wake-up's fire time. */
  endsAt: number | null
  /** A command under the agent carries it, so it is over once the agent has none left running. */
  runsCommand: boolean
  /**
   * A job the command may leave running by itself (`nohup`, `setsid`, `&`): Claude Code tracks no
   * task for it and never says it ended, so only the machine's processes do.
   */
  detached: DetachedJob | null
}

export type DetachedJob = {
  /** When the call was made (epoch ms): its processes started after it. */
  from: number
  /** When the call, or the task Claude Code ran it as, was over; null while it still runs. */
  until: number | null
  /** What its processes' command lines carry: the scripts or programs the command names. */
  names: string[]
  /** Its processes by name as a scan last found them: none once it is over, null until a host says. */
  runs: string[] | null
  /** A scan found it running. */
  seen: boolean
}

/** The job a launch left behind, once Claude Code has nothing more to say of the launch itself. */
export function detachedJobOf(
  launch: ClaudeBackgroundLaunch
): (DetachedJob & { until: number }) | null {
  const job = launch.detached
  return job && job.until !== null ? { ...job, until: job.until } : null
}

const DETACHED_TASK = 'detached-'

/** A foreground call that may have left a job no scan has found: nothing shows it ever ran. */
export function isUnseenDetachedCall(launch: ClaudeBackgroundLaunch): boolean {
  return launch.taskId === DETACHED_TASK + launch.toolUseId && launch.detached?.seen !== true
}

export type ClaudeBackgroundLaunches = Map<string, ClaudeBackgroundLaunch>

// Any Bash call may end up in the background (its timeout, Ctrl+B); only its result says which.
const BACKGROUND_TOOLS: Partial<Record<string, ClaudeBackgroundTaskKind>> = {
  Bash: 'shell',
  Monitor: 'monitor',
  Workflow: 'workflow',
  ScheduleWakeup: 'wakeup'
}

const LAUNCH_WORDING_CHARS = 400

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

const wording = (value: unknown): string | null =>
  str(value) ? oneLine(str(value)!, LAUNCH_WORDING_CHARS) : null

function detachedJob(
  kind: ClaudeBackgroundTaskKind,
  command: string | null,
  at: number | null
): DetachedJob | null {
  // Read off the whole command, not its clipped wording.
  if (kind !== 'shell' || command === null || at === null || !leavesJobRunning(command)) {
    return null
  }
  return { from: at, until: null, names: detachedJobNames(command), runs: null, seen: false }
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
      command: wording(call.input?.command),
      description: wording(call.input?.description),
      status: 'running',
      startedAt: call.at,
      summary: null,
      endsAt: null,
      runsCommand: kind === 'shell' || (kind === 'monitor' && str(call.input?.command) !== null),
      detached: detachedJob(kind, str(call.input?.command), call.at)
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

/** The launch is over at `at`; from here on a job it left behind is the machine's to vouch for. */
export function endDetachingLaunch(launch: ClaudeBackgroundLaunch, at: number | null): void {
  if (launch.detached && launch.detached.until === null) {
    launch.detached.until = Math.max(at ?? 0, launch.detached.from)
  }
}

/**
 * Reads a launch's result: the call left a task running, it ran in the foreground and is over, or
 * it returned having put a job of its own in the background.
 */
export function settleBackgroundLaunch(
  launches: ClaudeBackgroundLaunches,
  launch: ClaudeBackgroundLaunch,
  outcome: TranscriptRecord | null,
  /** When the result was written (epoch ms). */
  at: number | null
): void {
  if (launch.kind === 'wakeup' && (outcome?.stopped === true || outcome?.cancelledWakeups)) {
    endWakeupsBefore(launches, launch.startedAt, 'stopped')
  }
  launch.taskId = launchedTaskId(launch, outcome) ?? launch.taskId
  if (!launch.taskId && launch.detached) {
    launch.taskId = DETACHED_TASK + launch.toolUseId
    endDetachingLaunch(launch, at)
  }
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
    command: command === undefined ? null : oneLine(command, LAUNCH_WORDING_CHARS),
    description: null,
    status: 'running',
    startedAt: null,
    summary: null,
    endsAt: null,
    // A monitor may watch a socket instead of a command; its launch would have said.
    runsCommand: monitor === undefined,
    detached: null
  })
}
