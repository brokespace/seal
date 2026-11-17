// The evidence on a Claude Code turn that ended with commands of its own still running.
import type {
  LiveBackgroundTask,
  LiveSessionActivity
} from '../../../shared/live-sessions/live-session-activity'
import { isRestingLiveSessionStatus } from '../../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../shared/live-sessions/live-session-types'
import type {
  BackgroundWaitCommand,
  BackgroundWaitEvidence
} from '../../../shared/live-sessions/live-session-background-wait'
import type { ToolProcess } from './agent-tool-processes'
import { detachedJobOf, type ClaudeBackgroundLaunch } from './claude-background-launches'
import { claudeSessionTasks } from './claude-session-launches'
import type { ClaudeRegistryEntry } from './claude-session-registry'
import type { ClaudeActivityState } from './claude-transcript-activity'
import type { NamedJob } from './detached-job-lookup'
import type { SummarizedTranscript } from './session-assembly'
import type { TranscriptSummary } from './transcript-summary'

/** `ps` counts whole seconds, and the launching record lands a moment before its shell starts. */
const SAME_START_MS = 5_000
const MAX_COMMANDS = 8

function turnOf(
  launch: ClaudeBackgroundLaunch,
  state: ClaudeActivityState
): BackgroundWaitCommand['turn'] {
  if (launch.startedAt === null) {
    return null
  }
  return state.userSpokeAt === null || launch.startedAt >= state.userSpokeAt ? 'final' : 'earlier'
}

const namedTaskId = (job: NamedJob): string => `named-${job.pid}`

/** The jobs the reply names, as tasks of the session: each is something it may be waiting on. */
export function namedJobTasks(transcript: SummarizedTranscript | null): LiveBackgroundTask[] {
  return (transcript?.namedJobs?.jobs ?? []).map((job) => ({
    id: namedTaskId(job),
    label: job.label,
    status: 'running',
    startedAt: job.startedAt,
    summary: null
  }))
}

/** The shell of Claude's Bash tool that started when the launch did; each shell stands for one launch. */
function shellOf(
  launch: ClaudeBackgroundLaunch,
  shells: ToolProcess[],
  claimed: Set<ToolProcess>
): ToolProcess | undefined {
  const near = shells
    .filter((shell) => !claimed.has(shell) && launch.startedAt !== null)
    .map((shell) => ({ shell, off: Math.abs(shell.startedAt - launch.startedAt!) }))
    .filter(({ off }) => off <= SAME_START_MS)
    .sort((a, b) => a.off - b.off)[0]?.shell
  if (near) {
    claimed.add(near)
  }
  return near
}

/**
 * Null unless the turn ended by itself and a command it or an earlier turn started still runs:
 * every other session is settled without it.
 */
export function claudeBackgroundWait(
  transcript: SummarizedTranscript | null,
  activity: LiveSessionActivity,
  /** The commands running under the agent; null when the host listed no processes. */
  processes: readonly ToolProcess[] | null,
  registry: ClaudeRegistryEntry | null
): BackgroundWaitEvidence | null {
  const state = transcript?.claudeActivity
  const turn = transcript?.summary
  if (!state || turn?.phase !== 'turn-ended' || turn.detail === 'Interrupted') {
    return null
  }
  const running = new Set(
    activity.tasks.filter((task) => task.status === 'running').map((task) => task.id)
  )
  const shells = processes?.filter((process) => process.claudeBash) ?? null
  const claimed = new Set<ToolProcess>()
  const commands: BackgroundWaitCommand[] = claudeSessionTasks(state, transcript.subagents)
    .filter(({ launch }) => launch.runsCommand)
    .map(({ launch, subagent }): BackgroundWaitCommand => {
      const live = running.has(launch.taskId)
      const job = detachedJobOf(launch)
      return {
        kind: launch.kind === 'monitor' ? 'monitor' : 'shell',
        command: launch.command,
        description: launch.description,
        // A subagent's command belongs to the turn of its session that it ran in.
        turn: turnOf(launch, state),
        startedAt: launch.startedAt,
        state: live ? 'running' : launch.status === 'running' ? 'completed' : launch.status,
        runs: job
          ? job.runs
          : live && shells
            ? (shellOf(launch, shells, claimed)?.runs ?? null)
            : null,
        ...(job ? { origin: 'detached' as const } : {}),
        ...(subagent ? { subagent: true as const } : {})
      }
    })
    .filter((command) => command.state === 'running' || command.turn === 'final')
  for (const job of transcript.namedJobs?.jobs ?? []) {
    if (running.has(namedTaskId(job))) {
      commands.push({
        kind: 'shell',
        command: null,
        description: null,
        turn: 'final',
        startedAt: job.startedAt,
        state: 'running',
        runs: [job.runs],
        origin: 'named',
        named: job.label
      })
    }
  }
  // A command the agent vouches for whose launch lies before what was read of the transcript.
  if (running.has('background')) {
    const unread = shells?.filter((shell) => !claimed.has(shell)) ?? []
    commands.push({
      kind: 'shell',
      command: null,
      description: null,
      turn: null,
      startedAt: null,
      state: 'running',
      runs: shells ? [...new Set(unread.flatMap((shell) => shell.runs))].sort() : null
    })
  }
  if (!commands.some((command) => command.state === 'running')) {
    return null
  }
  return {
    reply: turn.replyExcerpt ?? turn.lastMessage,
    endedAt: turn.lastAt,
    registry: registry?.state ?? null,
    commands: commands
      .sort(
        (a, b) =>
          Number(b.state === 'running') - Number(a.state === 'running') ||
          (b.startedAt ?? 0) - (a.startedAt ?? 0)
      )
      .slice(0, MAX_COMMANDS)
  }
}

/** Kept only where the turn still rests on it: a hook or the screen may have said otherwise. */
export function backgroundWaitOf(
  left: BackgroundWaitEvidence | null,
  status: LiveSessionStatus
): Pick<LiveSession, 'backgroundWait'> {
  return left && (status === 'your-turn' || status === 'waiting-task')
    ? { backgroundWait: left }
    : {}
}

/**
 * A host with no word from the agent itself still shows what runs under it: a command of its
 * Bash tool that outlives a settled turn was left in the background, and with none left, none is.
 */
export function leftoverCommands(
  commands: readonly ToolProcess[] | null,
  turn: TranscriptSummary | undefined,
  status: LiveSessionStatus
): 'running' | 'none' | null {
  if (commands === null) {
    return null
  }
  if (!commands.some((command) => command.claudeBash)) {
    return 'none'
  }
  const settled = turn?.phase === 'turn-ended' && turn.settled && isRestingLiveSessionStatus(status)
  return settled ? 'running' : null
}
