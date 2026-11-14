// A session's subagents, background tasks and todo list, joined from what its transcript launched
// and what its subagents' own transcripts say.
import type {
  LiveBackgroundTask,
  LiveSessionActivity,
  LiveSubagent,
  LiveSubagentStatus
} from '../../../shared/live-sessions/live-session-activity'
import { claudeTodos } from './claude-transcript-activity'
import type { ClaudeActivityState, ClaudeAgentLaunch } from './claude-transcript-activity'
import type { SubagentFileSummary } from './claude-subagent-files'
import type { SummarizedTranscript } from './session-assembly'

/** A subagent that wrote this recently is running, whatever else is unknown about it. */
const SUBAGENT_FRESH_MS = 3 * 60_000
/** A subagent stopped mid-turn for longer than this was abandoned, not left running. */
const SUBAGENT_STALL_MS = 30 * 60_000
/** A launch with no transcript and no end in sight for this long is over. */
const LAUNCH_STALE_MS = 6 * 60 * 60_000
const MAX_LISTED = 40

export type SessionActivityInput = {
  state: ClaudeActivityState | null
  files: readonly SubagentFileSummary[]
  /** The session's agent process is running. */
  running: boolean
  /** Its main turn is in progress, so subagents that block the turn can be running. */
  turnOpen: boolean
  nowMs: number
}

function fileStatus(
  file: SubagentFileSummary,
  launch: ClaudeAgentLaunch | undefined,
  input: SessionActivityInput
): LiveSubagentStatus {
  const ended =
    input.state?.ended.get(file.agentId) ??
    (file.toolUseId ? input.state?.ended.get(file.toolUseId) : undefined)
  if (launch && launch.status !== 'running') {
    return launch.status
  }
  if (ended) {
    return ended
  }
  if (file.finished) {
    return 'completed'
  }
  if (!input.running) {
    return 'stopped'
  }
  const quietFor = input.nowMs - file.mtimeMs
  const background = launch?.background ?? file.background ?? false
  if (launch) {
    return background || input.turnOpen ? 'running' : 'completed'
  }
  if (quietFor < SUBAGENT_FRESH_MS) {
    return 'running'
  }
  return file.midTurn && quietFor < SUBAGENT_STALL_MS && (background || input.turnOpen)
    ? 'running'
    : 'completed'
}

function launchStatus(launch: ClaudeAgentLaunch, input: SessionActivityInput): LiveSubagentStatus {
  if (launch.status !== 'running') {
    return launch.status
  }
  if (!input.running) {
    return 'stopped'
  }
  if (!launch.background && !input.turnOpen) {
    return 'completed'
  }
  return launch.startedAt !== null && input.nowMs - launch.startedAt > LAUNCH_STALE_MS
    ? 'completed'
    : 'running'
}

function newestFirst<T extends { status: LiveSubagentStatus }>(
  items: T[],
  at: (item: T) => number
): T[] {
  return items
    .sort(
      (a, b) => Number(b.status === 'running') - Number(a.status === 'running') || at(b) - at(a)
    )
    .slice(0, MAX_LISTED)
}

export function claudeSessionActivity(input: SessionActivityInput): LiveSessionActivity {
  const launches = [...(input.state?.agents.values() ?? [])]
  const claimed = new Set<ClaudeAgentLaunch>()
  const subagents: LiveSubagent[] = input.files.map((file) => {
    const launch = launches.find(
      (l) =>
        (file.toolUseId !== null && l.toolUseId === file.toolUseId) || l.agentId === file.agentId
    )
    if (launch) {
      claimed.add(launch)
    }
    return {
      id: file.agentId,
      title: file.title ?? launch?.title ?? 'Subagent',
      agentType: file.agentType ?? launch?.agentType ?? null,
      model: file.model ?? launch?.model ?? null,
      status: fileStatus(file, launch, input),
      background: launch?.background ?? file.background ?? false,
      activity: file.activity,
      startedAt: launch?.startedAt ?? null,
      lastActivityAt: file.lastAt ?? file.mtimeMs,
      transcriptPath: file.path
    }
  })
  for (const launch of launches) {
    if (!claimed.has(launch)) {
      subagents.push({
        id: launch.agentId ?? launch.toolUseId,
        title: launch.title,
        agentType: launch.agentType,
        model: launch.model,
        status: launchStatus(launch, input),
        background: launch.background,
        activity: null,
        startedAt: launch.startedAt,
        lastActivityAt: launch.startedAt,
        transcriptPath: null
      })
    }
  }
  const tasks: LiveBackgroundTask[] = [...(input.state?.shells.values() ?? [])]
    .filter((shell) => shell.taskId !== null)
    .map((shell) => ({
      id: shell.taskId!,
      label: shell.label,
      status: shell.status === 'running' && !input.running ? 'stopped' : shell.status,
      startedAt: shell.startedAt,
      summary: shell.summary
    }))
  return {
    subagents: newestFirst(subagents, (s) => s.lastActivityAt ?? 0),
    tasks: newestFirst(tasks, (t) => t.startedAt ?? 0),
    todos: input.state ? claudeTodos(input.state) : []
  }
}

/** Codex helper threads by the session that (transitively) spawned them. */
export function codexHelperThreads(
  transcripts: readonly SummarizedTranscript[]
): Map<string, SummarizedTranscript[]> {
  const parentOf = new Map(
    transcripts.flatMap((t) =>
      t.summary.parentSessionId
        ? [[t.summary.providerSessionId, t.summary.parentSessionId] as const]
        : []
    )
  )
  const out = new Map<string, SummarizedTranscript[]>()
  for (const transcript of transcripts) {
    let root = transcript.summary.parentSessionId
    for (let hops = 0; root && parentOf.has(root) && hops < 8; hops++) {
      root = parentOf.get(root)!
    }
    if (root) {
      out.set(root, [...(out.get(root) ?? []), transcript])
    }
  }
  return out
}

function helperStatus(
  helper: SummarizedTranscript,
  running: boolean,
  nowMs: number
): LiveSubagentStatus {
  const { phase } = helper.summary
  if (phase === 'errored') {
    return 'failed'
  }
  if (phase === 'turn-ended') {
    return helper.summary.detail === 'Interrupted' ? 'stopped' : 'completed'
  }
  const quietFor = nowMs - helper.mtimeMs
  if (phase === 'unknown') {
    return running && quietFor < SUBAGENT_FRESH_MS ? 'running' : 'completed'
  }
  return running && quietFor < SUBAGENT_STALL_MS ? 'running' : 'stopped'
}

/** A session's activity, whichever agent runs it. */
export function sessionActivityOf(input: {
  transcript: SummarizedTranscript | null
  helperThreads: readonly SummarizedTranscript[]
  running: boolean
  turnOpen: boolean
  nowMs: number
}): LiveSessionActivity {
  const { transcript, running, nowMs } = input
  if (transcript?.summary.provider !== 'codex') {
    return claudeSessionActivity({
      state: transcript?.claudeActivity ?? null,
      files: transcript?.subagents ?? [],
      running,
      turnOpen: input.turnOpen,
      nowMs
    })
  }
  const subagents: LiveSubagent[] = input.helperThreads.map((helper) => ({
    id: helper.summary.providerSessionId,
    title: helper.summary.agentName ?? helper.summary.title ?? 'Helper',
    agentType: helper.summary.agentType,
    model: null,
    status: helperStatus(helper, running, nowMs),
    background: true,
    activity: helper.summary.detail ?? helper.summary.lastMessage,
    startedAt: helper.summary.firstAt,
    lastActivityAt: helper.summary.lastAt ?? helper.mtimeMs,
    transcriptPath: helper.path
  }))
  return {
    subagents: newestFirst(subagents, (s) => s.lastActivityAt ?? 0),
    tasks: [],
    todos: transcript.codexPlan ?? []
  }
}
