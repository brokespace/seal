import type {
  LiveSession,
  LiveSessionInputRoute,
  LiveSessionMachine,
  LiveSessionProvider,
  LiveSessionStatus,
  LiveSessionStatusSource
} from '../../../shared/live-sessions/live-session-types'
import type { DiscoveredPane, DiscoveryOutput } from './discovery-output'
import { parseAgentScreen } from './agent-screen'
import { withAgentScreen } from './agent-screen-status'
import type { TranscriptSummary } from './transcript-summary'
import {
  backgroundLeftoverLabel,
  type LiveTodo
} from '../../../shared/live-sessions/live-session-activity'
import type { ClaudeActivityState } from './claude-transcript-activity'
import type { SubagentFileSummary } from './claude-subagent-files'
import type { NamedJobs } from './detached-job-lookup'
import { pendingCallStatus, turnStatus, withBackgroundWait } from './session-status'
import { toolProcesses } from './agent-tool-processes'
import {
  backgroundWaitOf,
  claudeBackgroundWait,
  leftoverCommands,
  namedJobTasks
} from './claude-background-wait'
import {
  claudeRegistryBackgroundShells,
  claudeRegistryHoldsBusy,
  withClaudeRegistryState
} from './claude-session-registry'
import { isRestingLiveSessionStatus } from '../../../shared/live-sessions/live-session-status'
import { codexHelperThreads, sessionActivityOf } from './session-activity'
import { hookStatus, parseHookStates } from './agent-hook-states'
import {
  agentProcesses,
  agentSessionPidOf,
  approvalModeFromArgs,
  codexHomeOf,
  processBinary,
  runsInPane
} from './agent-processes'
import { pairProcesses, type UnreadTranscript } from './session-process-pairing'
import type { CodexTerminalState } from './codex-background-terminals'
import { conversations, distinctSessions } from './session-identity'
import { sessionCapabilities } from '../adapters/session-capabilities'
import { liveSessionId, projectOf } from '../../../shared/live-sessions/live-session-id'

export type SummarizedTranscript = {
  path: string
  size: number
  mtimeMs: number
  summary: TranscriptSummary
  /** Claude: what the transcript launched, folded scan after scan. */
  claudeActivity?: ClaudeActivityState
  /** Claude: the session's subagent transcripts. */
  subagents?: SubagentFileSummary[]
  /** Claude: running jobs the reply names that no launch accounts for, as the host last found them. */
  namedJobs?: NamedJobs
  /** Codex: the newest `update_plan`. */
  codexPlan?: LiveTodo[] | null
  /** Codex: the background terminals its rollout left running, folded scan after scan. */
  codexTerminals?: CodexTerminalState
  /** The agent process an earlier scan paired with it. */
  agentPid?: number
  /** An earlier scan found several agents that could each have written it. */
  contested?: boolean
}

/** A transcript written this recently belongs to a running agent even if `ps` missed it. */
const FRESH_WRITE_MS = 2 * 60_000
/** A hook state older than the transcript by more than this has gone quiet; the transcript wins. */
const HOOK_STALE_MS = 2 * 60_000

export { liveSessionId, projectOf }

/** The provider config folder a transcript lives under: `<dir>/projects/…` or `<dir>/sessions/…`. */
export function configDirOf(provider: LiveSessionProvider, path: string | null): string | null {
  const at = path?.lastIndexOf(provider === 'claude' ? '/projects/' : '/sessions/') ?? -1
  return at > 0 ? path!.slice(0, at) : null
}

export function assembleHostSessions(input: {
  machine: LiveSessionMachine
  output: Pick<DiscoveryOutput, 'processes' | 'panes' | 'hookStates' | 'hostNowMs'> &
    Partial<
      Pick<DiscoveryOutput, 'claudeSessions' | 'pins' | 'children' | 'processesListed' | 'complete'>
    >
  transcripts: SummarizedTranscript[]
  unread?: readonly UnreadTranscript[]
  nowMs: number
  /** Told of each transcript several running agents could each have written. */
  onContested?: (transcript: SummarizedTranscript) => void
}): LiveSession[] {
  const { machine, output } = input
  const now = output.hostNowMs ?? input.nowMs
  const panesByTty = new Map<string, DiscoveredPane>(output.panes.map((p) => [p.tty, p]))
  const hooks = new Map(
    parseHookStates(output.hookStates).map((h) => [`${h.provider}:${h.providerSessionId}`, h])
  )
  const claudeRegistry = new Map((output.claudeSessions ?? []).map((s) => [s.pid, s] as const))
  const claudeSessionByPid = new Map(
    [...claudeRegistry.values()].map((s) => [s.pid, s.sessionId] as const)
  )
  const ownedPaths = new Map<number, Set<string>>()
  const openTranscripts = new Set<string>()
  const sessionPidOf = agentSessionPidOf(output.processes)
  for (const pin of output.pins ?? []) {
    if (pin.kind !== 'cwd') {
      const pid = sessionPidOf(pin.pid)
      ownedPaths.set(pid, (ownedPaths.get(pid) ?? new Set()).add(pin.path))
    }
    if (pin.kind === 'open') {
      openTranscripts.add(pin.path)
    }
  }
  const commandsUnder = toolProcesses(output, now)
  const listedPids = new Set(output.processes.map((p) => p.pid))
  const sessions: LiveSession[] = []
  // A Codex helper thread writes its own rollout, but it is its session's subagent, not a session.
  const helpers = codexHelperThreads(input.transcripts)
  const found = conversations(input.transcripts.filter((t) => !t.summary.parentSessionId))
  const earlierOf = new Map(found.map((c) => [c.transcript, c.earlier]))
  for (const { process, transcript, contested, unproven } of pairProcesses(
    agentProcesses(output.processes),
    found.map((c) => c.transcript),
    claudeSessionByPid,
    ownedPaths,
    now - FRESH_WRITE_MS,
    input.unread,
    output.complete === false
  )) {
    if (contested && transcript) {
      input.onContested?.(transcript)
    }
    const summary = transcript?.summary
    const provider = process?.provider ?? summary!.provider
    // A fresh agent has no transcript until its first prompt; Claude names it in its registry at once.
    const providerSessionId =
      summary?.providerSessionId ??
      (provider === 'claude' ? claudeSessionByPid.get(process!.pid) : undefined) ??
      `pid-${process!.pid}`
    const helperThreads = helpers.get(providerSessionId) ?? []
    // Subagents write to their own files while their session's stands still.
    const lastWrite = Math.max(
      transcript?.mtimeMs ?? 0,
      summary?.lastAt ?? 0,
      ...(transcript?.subagents ?? []).map((sub) => sub.mtimeMs),
      ...helperThreads.map((helper) => helper.mtimeMs)
    )
    // One Codex app-server holds many threads open but pairs with one; the rest still have it.
    const heldOpen = transcript !== null && openTranscripts.has(transcript.path)
    // The process seen running it is off the host's list: it exited, however fresh its last
    // write (Claude writes its closing records on its way out).
    const last = transcript?.agentPid
    const exited =
      last !== undefined && output.processesListed === true && !heldOpen && !listedPids.has(last)
    const running = process !== null || (!exited && now - lastWrite < FRESH_WRITE_MS)
    // A pairing nothing proves shows the transcript as running, and types nothing into the agent.
    const onTty = process?.tty && !unproven ? panesByTty.get(process.tty) : undefined
    // A container's `pts/1` is not this machine's: the pane is the agent's when it runs under it.
    const pane = onTty && process && runsInPane(process, onTty.panePid) ? onTty : undefined
    const screen = pane?.screen ? parseAgentScreen(pane.screen) : null
    const hook = hooks.get(`${provider}:${providerSessionId}`)
    const gone = output.processesListed === true && !running && !heldOpen
    const commands = process ? commandsUnder(process.pid, provider) : null
    // The registry speaks for the process's current conversation only.
    const registered =
      process && provider === 'claude' ? claudeRegistry.get(process.pid) : undefined
    const registry = registered?.sessionId === providerSessionId ? registered : null

    let status: LiveSessionStatus = turnStatus(summary, running, now - lastWrite, gone)
    let statusSource: LiveSessionStatusSource = 'transcript'
    let statusDetail = summary?.detail ?? null
    const hookFresh = hook && hook.updatedMs >= lastWrite - HOOK_STALE_MS
    // A question the transcript holds open is what the agent waits on, whatever its hooks wrote
    // around the call: the file says "working" or "needs" until the answer, and never "asked".
    const fromHook =
      hookFresh && summary?.phase !== 'input-requested'
        ? hookStatus(hook, running, summary, output.processesListed === true && !running)
        : null
    if (fromHook) {
      status = fromHook
      statusSource = 'agent-hooks'
      statusDetail = hook!.detail ?? statusDetail
    }
    const fromRegistry = withClaudeRegistryState(
      { status, statusDetail },
      summary,
      registry,
      transcript?.mtimeMs ?? lastWrite
    )
    if (fromRegistry) {
      ;({ status, statusDetail } = fromRegistry)
      statusSource = 'agent-state'
      if (status === 'needs-permission' && summary?.phase === 'tool-pending' && statusDetail) {
        statusDetail = `Allow ${statusDetail}?`
      }
    }
    const activity = sessionActivityOf({
      transcript,
      helperThreads,
      running,
      turnOpen: status === 'working',
      backgroundShells:
        provider === 'codex'
          ? commands && (commands.length > 0 ? 'running' : 'none')
          : (claudeRegistryBackgroundShells(registry) ??
            (registry?.state ? null : leftoverCommands(commands, summary, status))),
      // With no process seen there is nobody to be woken by a job.
      named: process ? namedJobTasks(transcript) : [],
      nowMs: now
    })
    // With no process seen there is nobody to be woken, however fresh the last write.
    const left = claudeBackgroundWait(process && transcript, activity, commands, registry)
    const waits = withBackgroundWait({ status, statusDetail }, summary, activity, left)
    ;({ status, statusDetail } = waits)
    if (claudeRegistryHoldsBusy({ status, statusDetail }, summary, registry)) {
      status = 'working'
      statusSource = 'agent-state'
      statusDetail = null
    }
    // The transcript cannot tell a running command from one a prompt holds; the process list can.
    const inferred =
      status === 'working' && process
        ? pendingCallStatus(summary, {
            processStarts: commands?.map((command) => command.startedAt) ?? null,
            approvalMode: summary?.approvalMode ?? approvalModeFromArgs(process.args),
            nowMs: now
          })
        : null
    // An agent that says it is busy has no prompt up, however long its call stands with no process.
    const fromProcesses =
      inferred === 'needs-permission' && registry?.state === 'busy' ? null : inferred
    if (fromProcesses) {
      status = fromProcesses
      statusSource = 'process'
      if (fromProcesses === 'needs-permission' && statusDetail) {
        statusDetail = `Allow ${statusDetail}?`
      }
    }
    let permission: LiveSession['permission'] = null
    if (screen && pane && running) {
      ;({ status, statusSource, statusDetail, permission } = withAgentScreen(
        { status, statusSource, statusDetail },
        { screen, paneId: pane.paneId, summary }
      ))
    }
    if (status !== 'working' && status !== 'needs-permission' && statusDetail === 'Thinking') {
      statusDetail = null
    }
    if (status === 'done') {
      statusDetail = summary?.detail === 'Interrupted' ? 'Interrupted' : null
    } else if (isRestingLiveSessionStatus(status)) {
      statusDetail =
        summary?.detail === 'Interrupted' ? 'Interrupted' : backgroundLeftoverLabel(activity)
    }
    const inputRoutes: LiveSessionInputRoute[] = []
    if (provider === 'codex' && process && summary && !unproven) {
      inputRoutes.push({
        kind: 'codex-queue',
        thread: providerSessionId,
        binary: processBinary(process.args, 'codex'),
        codexHome: codexHomeOf(transcript?.path ?? null)
      })
    }
    if (pane && process) {
      inputRoutes.push({ kind: 'tmux', target: pane.paneId, socket: pane.socket })
    }
    // Resuming next to a live process would fork the conversation, so only closed sessions resume.
    if (!running && !contested && summary && !providerSessionId.startsWith('pid-')) {
      inputRoutes.push({ kind: 'resume' })
    }
    const cwd = summary?.cwd ?? process?.cwd ?? null
    const continues = (transcript ? (earlierOf.get(transcript) ?? []) : []).map((id) =>
      liveSessionId(machine.hostId, provider, id)
    )
    const surface = { kind: 'external' as const }
    sessions.push({
      id: liveSessionId(machine.hostId, provider, providerSessionId),
      provider,
      providerSessionId,
      machine,
      origin: 'external',
      surface,
      capabilities: sessionCapabilities({
        provider,
        providerSessionId,
        machine,
        inputRoutes,
        surface
      }),
      cwd,
      project: projectOf(cwd),
      title: summary?.title ?? null,
      status,
      statusSource,
      statusDetail,
      // 0 until the session writes anything; the scanner fills in when it first saw it.
      lastActivityAt: Math.max(lastWrite, hook?.updatedMs ?? 0),
      startedAt: summary?.firstAt ?? null,
      alive: process !== null,
      pid: process?.pid ?? null,
      transcriptPath: transcript?.path ?? null,
      inputRoutes,
      permission,
      activity,
      lastMessage: summary?.lastMessage ?? null,
      ...backgroundWaitOf(left, status),
      configDir: configDirOf(provider, transcript?.path ?? null),
      ...(continues.length > 0 ? { continues } : {}),
      ...(summary?.titleNamed ? { titleNamed: true as const } : {}),
      ...(summary?.context ? { context: summary.context } : {}),
      ...(summary?.context?.model ? { model: summary.context.model } : {})
    })
  }
  return distinctSessions(sessions)
}
