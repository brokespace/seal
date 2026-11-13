import { createHash } from 'node:crypto'
import type {
  LiveSession,
  LiveSessionInputRoute,
  LiveSessionMachine,
  LiveSessionProvider,
  LiveSessionStatus,
  LiveSessionStatusSource
} from '../../../shared/live-sessions/live-session-types'
import type { DiscoveredPane, DiscoveredProcess, DiscoveryOutput } from './discovery-output'
import { parseAgentScreen, type AgentScreen } from './agent-screen'
import type { TranscriptPhase, TranscriptSummary } from './transcript-summary'
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import { agentProcesses, codexHomeOf, processBinary, sessionIdFromArgs } from './agent-processes'
import { conversationTranscripts, distinctSessions } from './session-identity'

export type SummarizedTranscript = {
  path: string
  size: number
  mtimeMs: number
  summary: TranscriptSummary
}

/** A SISomewhere-format hook state file (`~/.config/sisomewhere/agents/<id>.json`). */
type HookState = {
  provider: LiveSessionProvider
  providerSessionId: string
  state: string
  detail: string | null
  updatedMs: number
  pid: number | null
}

/** A transcript written this recently belongs to a running agent even if `ps` missed it. */
const FRESH_WRITE_MS = 2 * 60_000
/** A hook state older than the transcript by more than this has gone quiet; the transcript wins. */
const HOOK_STALE_MS = 2 * 60_000

export function liveSessionId(
  hostId: string,
  provider: LiveSessionProvider,
  providerSessionId: string
): string {
  return `${hostId}:${provider}:${providerSessionId}`
}

export function projectOf(cwd: string | null): string | null {
  if (!cwd) {
    return null
  }
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? null
}

export function parseHookStates(files: { path: string; text: string }[]): HookState[] {
  return files.flatMap(({ path, text }): HookState[] => {
    const raw = parseJsonRecord(text)
    if (!raw) {
      return []
    }
    const provider = raw.provider === 'codex' ? 'codex' : raw.provider ? null : 'claude'
    if (!provider || (raw.provider && raw.provider !== provider)) {
      return []
    }
    const fileId = (path.split('/').pop() ?? '').replace(/\.json$/, '')
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fileId.replace(/^codex-/, '')
    const updated = typeof raw.updated === 'number' ? raw.updated * 1000 : 0
    return [
      {
        provider,
        providerSessionId: id,
        state: typeof raw.state === 'string' ? raw.state : '',
        detail: typeof raw.detail === 'string' && raw.detail ? raw.detail : null,
        updatedMs: updated,
        pid: typeof raw.pid === 'number' ? raw.pid : null
      }
    ]
  })
}

function phaseStatus(phase: TranscriptPhase, running: boolean): LiveSessionStatus {
  if (phase === 'errored') {
    return 'errored'
  }
  if (!running) {
    return 'done'
  }
  switch (phase) {
    case 'working':
    case 'tool-pending':
      return 'working'
    case 'approval-requested':
      return 'needs-permission'
    case 'turn-ended':
    case 'unknown':
      return 'waiting-input'
  }
}

function hookStatus(state: string, running: boolean): LiveSessionStatus | null {
  switch (state) {
    case 'working':
      return 'working'
    case 'needs':
      return 'needs-permission'
    case 'done':
    case 'idle':
      return running ? 'waiting-input' : 'done'
    default:
      return null
  }
}

export function permissionPromptId(paneId: string, screen: AgentScreen): string {
  const approval = screen.approval!
  const facts = [paneId, approval.question, ...approval.options.map((o) => o.label)]
  return createHash('sha256').update(facts.join('\n')).digest('hex').slice(0, 16)
}

type Claim = {
  transcript: SummarizedTranscript | null
  process: (DiscoveredProcess & { provider: LiveSessionProvider }) | null
}

/** Pair agent processes with the transcripts they write. */
function pairProcesses(
  processes: (DiscoveredProcess & { provider: LiveSessionProvider })[],
  transcripts: SummarizedTranscript[],
  claudeSessionByPid: ReadonlyMap<number, string>,
  ownedPaths: ReadonlyMap<number, ReadonlySet<string>>,
  freshSince: number
): Claim[] {
  const free = new Set(transcripts)
  const claims: Claim[] = []
  const take = (t: SummarizedTranscript | undefined) => {
    if (t) {
      free.delete(t)
    }
    return t ?? null
  }
  const pending: typeof processes = []
  for (const process of processes) {
    const named =
      (process.provider === 'claude' ? claudeSessionByPid.get(process.pid) : undefined) ??
      sessionIdFromArgs(process.args)
    const owned = ownedPaths.get(process.pid)
    const match =
      (named
        ? [...free].find(
            (t) => t.summary.provider === process.provider && t.summary.providerSessionId === named
          )
        : undefined) ??
      [...free]
        .filter((t) => t.summary.provider === process.provider && owned?.has(t.path))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (match) {
      claims.push({ process, transcript: take(match) })
    } else {
      pending.push(process)
    }
  }
  // Newer processes write the newer transcripts in a shared folder.
  pending.sort((a, b) => b.pid - a.pid)
  for (const process of pending) {
    const match = [...free]
      .filter((t) => t.summary.provider === process.provider && t.summary.cwd === process.cwd)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    claims.push({ process, transcript: take(match) })
  }
  // A running agent's transcript is being written right now even when its folder says otherwise.
  for (const provider of ['claude', 'codex'] as const) {
    const bare = claims.filter((c) => c.process?.provider === provider && !c.transcript)
    const fresh = [...free].filter(
      (t) => t.summary.provider === provider && t.mtimeMs >= freshSince
    )
    if (bare.length === 1 && fresh.length === 1) {
      bare[0].transcript = take(fresh[0])
    }
  }
  for (const transcript of free) {
    claims.push({ process: null, transcript })
  }
  return claims
}

export function assembleHostSessions(input: {
  machine: LiveSessionMachine
  output: Pick<DiscoveryOutput, 'processes' | 'panes' | 'hookStates' | 'hostNowMs'> &
    Partial<Pick<DiscoveryOutput, 'claudeSessions' | 'pins'>>
  transcripts: SummarizedTranscript[]
  nowMs: number
}): LiveSession[] {
  const { machine, output } = input
  const now = output.hostNowMs ?? input.nowMs
  const panesByTty = new Map<string, DiscoveredPane>(output.panes.map((p) => [p.tty, p]))
  const hooks = new Map(
    parseHookStates(output.hookStates).map((h) => [`${h.provider}:${h.providerSessionId}`, h])
  )
  const claudeSessionByPid = new Map(
    (output.claudeSessions ?? []).map((s) => [s.pid, s.sessionId] as const)
  )
  const ownedPaths = new Map<number, Set<string>>()
  for (const pin of output.pins ?? []) {
    if (pin.kind !== 'cwd') {
      ownedPaths.set(pin.pid, (ownedPaths.get(pin.pid) ?? new Set()).add(pin.path))
    }
  }
  const sessions: LiveSession[] = []
  for (const { process, transcript } of pairProcesses(
    agentProcesses(output.processes),
    conversationTranscripts(input.transcripts),
    claudeSessionByPid,
    ownedPaths,
    now - FRESH_WRITE_MS
  )) {
    const summary = transcript?.summary
    const provider = process?.provider ?? summary!.provider
    // A fresh agent has no transcript until its first prompt; Claude names it in its registry at once.
    const providerSessionId =
      summary?.providerSessionId ??
      (provider === 'claude' ? claudeSessionByPid.get(process!.pid) : undefined) ??
      `pid-${process!.pid}`
    const lastWrite = Math.max(transcript?.mtimeMs ?? 0, summary?.lastAt ?? 0)
    const running = process !== null || now - lastWrite < FRESH_WRITE_MS
    const pane = process?.tty ? panesByTty.get(process.tty) : undefined
    const screen = pane?.screen ? parseAgentScreen(pane.screen) : null
    const hook = hooks.get(`${provider}:${providerSessionId}`)

    let status: LiveSessionStatus = summary ? phaseStatus(summary.phase, running) : 'waiting-input'
    let statusSource: LiveSessionStatusSource = 'transcript'
    let statusDetail = summary?.detail ?? null
    const hookFresh = hook && hook.updatedMs >= lastWrite - HOOK_STALE_MS
    const fromHook = hookFresh ? hookStatus(hook.state, running) : null
    if (fromHook) {
      status = fromHook
      statusSource = 'agent-hooks'
      statusDetail = hook!.detail ?? statusDetail
    }
    let permission: LiveSession['permission'] = null
    if (screen?.approval && pane && running) {
      status = 'needs-permission'
      statusSource = 'screen'
      statusDetail = screen.approval.question
      permission = {
        promptId: permissionPromptId(pane.paneId, screen),
        question: screen.approval.question,
        options: screen.approval.options.map(({ id, label }) => ({ id, label }))
      }
    } else if (screen && running && status === 'needs-permission' && screen.promptBox) {
      // The dialog is gone from the screen: whatever asked has been answered.
      status = 'working'
      statusSource = 'screen'
    }
    if (status !== 'working' && status !== 'needs-permission' && statusDetail === 'Thinking') {
      statusDetail = null
    }
    const inputRoutes: LiveSessionInputRoute[] = []
    if (provider === 'codex' && process && summary) {
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
    if (!running && summary && !providerSessionId.startsWith('pid-')) {
      inputRoutes.push({ kind: 'resume' })
    }
    const cwd = summary?.cwd ?? process?.cwd ?? null
    sessions.push({
      id: liveSessionId(machine.hostId, provider, providerSessionId),
      provider,
      providerSessionId,
      machine,
      origin: 'external',
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
      permission
    })
  }
  return distinctSessions(sessions)
}
