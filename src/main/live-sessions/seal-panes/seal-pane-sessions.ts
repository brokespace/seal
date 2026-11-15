// Sessions running in Seal's own terminal panes, as Orca's hook server reports them.
import type { AgentStatusIpcPayload } from '../../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { PendingPrompt } from '../../../shared/agent-status/contracts/agent-pending-prompt'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionPermissionPrompt,
  LiveSessionProvider,
  LiveSessionStatus
} from '../../../shared/live-sessions/live-session-types'
import { isAgentStatusHeldOpenByChildWork } from '../../../shared/agent-status/lifecycle/agent-lead-status-fold'
import { agentVerdictDisplayMark } from '../../../shared/agent-status/lifecycle/agent-main-agent-verdict'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status/contracts/agent-status-freshness'
import { isAskUserQuestionTool } from '../../../shared/agent-status/lifecycle/agent-question-answered-intent'
import { isClaudeAskTool } from '../discovery/claude-transcript-phase'
import { liveSessionId, projectOf } from '../discovery/session-assembly'
import { oneLine } from '../discovery/transcript-records'
import { isWaitingOnBackgroundWork } from '../../../shared/live-sessions/live-session-status'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'

/** What a finished turn may still rest on, which a Stop hook does not say. */
const RESTS_ON: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-subagent',
  'waiting-task',
  'waiting-input',
  'errored'
])

/** What a turn at work may be doing, which a tool hook does not say. */
const WORKS_ON: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-subagent',
  'waiting-task',
  'running-shell'
])

export type SealPaneRow = Pick<
  AgentStatusIpcPayload,
  | 'paneKey'
  | 'state'
  | 'agentType'
  | 'providerSession'
  | 'providerSessionOnly'
  | 'receivedAt'
  | 'stateStartedAt'
  | 'connectionId'
  | 'prompt'
  | 'toolName'
  | 'workingMode'
  | 'interrupted'
  | 'mainAgent'
  | 'restoredUnconfirmed'
  | 'evidenceObservedAt'
>

export type SealPane = {
  paneKey: string
  provider: LiveSessionProvider
  providerSessionId: string
  /** Null for this machine; the mux connection id for a remote Seal host. */
  connectionId: string | null
  status: LiveSessionStatus
  statusDetail: string | null
  cwd: string | null
  transcriptPath: string | null
  prompt: string | null
  receivedAt: number
  permission: LiveSessionPermissionPrompt | null
  /** Its hooks went quiet mid-turn, or were last heard by an earlier run of Seal: they no longer say what the agent does now. */
  silent: boolean
}

/** What a pane waits on: a hook reports a question and a permission request alike as `waiting`. */
function waitingStatus(row: SealPaneRow, prompt: PendingPrompt | null): LiveSessionStatus {
  if (prompt?.kind === 'approval') {
    return 'needs-permission'
  }
  if (
    prompt?.kind === 'question' ||
    !row.toolName ||
    isAskUserQuestionTool(row.toolName) ||
    isClaudeAskTool(row.toolName)
  ) {
    return 'waiting-input'
  }
  // Any other tool the agent stopped on waits for its permission prompt.
  return 'needs-permission'
}

function hookStatus(row: SealPaneRow, prompt: PendingPrompt | null): LiveSessionStatus {
  if (row.state === 'blocked') {
    return 'needs-permission'
  }
  if (row.state === 'waiting') {
    return waitingStatus(row, prompt)
  }
  // A failed turn stays news while what it left running goes on.
  if (agentVerdictDisplayMark(row) === 'failed') {
    return 'errored'
  }
  if (row.state === 'done') {
    // A finished turn in a live pane sits at its prompt.
    return 'your-turn'
  }
  // The turn ended and the host still counts work under it: shells and monitors, or agents.
  if (row.workingMode === 'monitoring') {
    return 'waiting-task'
  }
  return isAgentStatusHeldOpenByChildWork(row) ? 'waiting-subagent' : 'working'
}

function hookDetail(
  row: SealPaneRow,
  status: LiveSessionStatus,
  permission: LiveSessionPermissionPrompt | null
): string | null {
  switch (status) {
    case 'working':
      return row.toolName ?? null
    case 'waiting-input':
      return 'Question for you'
    case 'your-turn':
      return agentVerdictDisplayMark(row) === 'interrupted' ? 'Interrupted' : null
    case 'needs-permission':
      return (
        permission?.question ??
        (row.state === 'waiting' && row.toolName ? `Allow ${row.toolName}?` : null)
      )
    default:
      return null
  }
}

export function permissionFromPendingPrompt(
  prompt: PendingPrompt | null
): LiveSessionPermissionPrompt | null {
  if (!prompt || prompt.kind === 'unsupported') {
    return null
  }
  return {
    promptId: prompt.promptId,
    question:
      prompt.kind === 'approval'
        ? `Allow ${prompt.tool}${prompt.summary ? `: ${prompt.summary}` : ''}?`
        : prompt.question,
    options: prompt.options.map(({ id, label }) => ({ id, label }))
  }
}

function wentSilent(row: SealPaneRow, now: number): boolean {
  return (
    row.restoredUnconfirmed === true ||
    (row.state !== 'done' &&
      now - (row.evidenceObservedAt ?? row.receivedAt) > AGENT_STATUS_STALE_AFTER_MS)
  )
}

export function sealPanesFromRows(
  rows: SealPaneRow[],
  pendingPrompt: (paneKey: string, agent: LiveSessionProvider) => PendingPrompt | null,
  now: number
): SealPane[] {
  return rows.flatMap((row) => {
    const provider: LiveSessionProvider | null =
      row.agentType === 'claude' ? 'claude' : row.agentType === 'codex' ? 'codex' : null
    const id = row.providerSession?.id
    if (!provider || !id || row.providerSessionOnly) {
      return []
    }
    const prompt =
      row.state === 'blocked' || row.state === 'waiting'
        ? pendingPrompt(row.paneKey, provider)
        : null
    const status = hookStatus(row, prompt)
    const permission = permissionFromPendingPrompt(prompt)
    return [
      {
        paneKey: row.paneKey,
        provider,
        providerSessionId: id,
        connectionId: row.connectionId,
        status,
        statusDetail: hookDetail(row, status, permission),
        cwd: row.providerSession?.cwd ?? null,
        transcriptPath: row.providerSession?.transcriptPath ?? null,
        prompt: row.prompt ? oneLine(row.prompt, 80) : null,
        receivedAt: row.receivedAt,
        permission,
        silent: wentSilent(row, now)
      }
    ]
  })
}

const REMOTE_SEAL_MACHINE: LiveSessionMachine = {
  hostId: 'seal-remote',
  label: 'Remote Seal host',
  kind: 'remote'
}

/**
 * A pane's hooks say when a turn starts, asks and stops. What it runs meanwhile and what it left
 * behind when it stopped come from the agent itself: its transcript, its processes, its own state.
 */
function discoveryKnowsMore(pane: SealPane, found: LiveSession): boolean {
  if (pane.silent) {
    return true
  }
  if (found.statusSource === 'screen') {
    return found.permission !== null
  }
  if (found.statusSource === 'classifier') {
    return false
  }
  if (endedWithoutHook(pane, found)) {
    return true
  }
  // Claude's own word on a prompt or a turn its hooks did not announce (a wake-up, a compaction).
  const agentSays =
    found.statusSource === 'agent-state' &&
    (found.status === 'working' ||
      found.status === 'needs-permission' ||
      found.status === 'waiting-input')
  if (pane.status === 'your-turn') {
    return RESTS_ON.has(found.status) || agentSays
  }
  if (pane.status === 'working') {
    return WORKS_ON.has(found.status) || (agentSays && found.status !== 'working')
  }
  // Which kind of work, and how much of it.
  return isWaitingOnBackgroundWork(pane.status) && isWaitingOnBackgroundWork(found.status)
}

/** How much later than a pane's last hook its transcript must record the end of the turn. */
const TURN_END_AFTER_HOOK_MS = 3_000

/**
 * A turn cut short fires no Stop hook (Esc, a crash): the pane's last hook still says a tool runs,
 * and the transcript, written after it, says the turn is over. Both clocks are this machine's.
 */
function endedWithoutHook(pane: SealPane, found: LiveSession): boolean {
  return (
    pane.status === 'working' &&
    pane.connectionId === null &&
    found.statusSource === 'transcript' &&
    (found.status === 'your-turn' || found.status === 'errored') &&
    found.lastActivityAt - pane.receivedAt > TURN_END_AFTER_HOOK_MS
  )
}

/** Seal's hooks know its own panes best; discovery adds what they don't say (machine, liveness, title). */
export function mergeSealPanes(
  discovered: LiveSession[],
  panes: SealPane[],
  localMachine: LiveSessionMachine,
  /** Told of each pane whose session discovery finds with no process running it. */
  onUnseenAgent?: (paneKey: string) => void
): LiveSession[] {
  const out = [...discovered]
  for (const pane of panes) {
    const sameHost = (s: LiveSession) =>
      s.provider === pane.provider &&
      (pane.connectionId === null) === (s.machine.hostId === LOCAL_HOST_ID)
    // The pane's own process, found before its first prompt or under another file name.
    const index = [
      (s: LiveSession) => s.providerSessionId === pane.providerSessionId,
      (s: LiveSession) => pane.transcriptPath !== null && s.transcriptPath === pane.transcriptPath,
      (s: LiveSession) =>
        s.providerSessionId.startsWith('pid-') && s.alive && s.cwd === pane.cwd && s.cwd !== null
    ]
      .map((matches) => out.findIndex((s) => sameHost(s) && matches(s)))
      .find((i) => i !== -1)
    const route = { kind: 'seal-pane' as const, paneKey: pane.paneKey }
    if (index !== undefined) {
      const found = out[index]
      const fromDiscovery = discoveryKnowsMore(pane, found)
      if (!found.alive) {
        onUnseenAgent?.(pane.paneKey)
      }
      const named = found.providerSessionId.startsWith('pid-')
        ? {
            id: liveSessionId(found.machine.hostId, pane.provider, pane.providerSessionId),
            providerSessionId: pane.providerSessionId,
            transcriptPath: found.transcriptPath ?? pane.transcriptPath
          }
        : {}
      out[index] = {
        ...found,
        ...named,
        origin: 'seal',
        status: fromDiscovery ? found.status : pane.status,
        statusSource: fromDiscovery ? found.statusSource : 'seal-hooks',
        statusDetail:
          fromDiscovery || (pane.statusDetail === null && found.status === pane.status)
            ? found.statusDetail
            : pane.statusDetail,
        lastActivityAt: Math.max(found.lastActivityAt, pane.receivedAt),
        alive: true,
        inputRoutes: [route, ...found.inputRoutes.filter((r) => r.kind !== 'resume')],
        permission: pane.permission ?? found.permission
      }
      continue
    }
    const machine = pane.connectionId === null ? localMachine : REMOTE_SEAL_MACHINE
    out.push({
      id: liveSessionId(machine.hostId, pane.provider, pane.providerSessionId),
      provider: pane.provider,
      providerSessionId: pane.providerSessionId,
      machine,
      origin: 'seal',
      cwd: pane.cwd,
      project: projectOf(pane.cwd),
      title: pane.prompt,
      status: pane.status,
      statusSource: 'seal-hooks',
      statusDetail: pane.statusDetail,
      lastActivityAt: pane.receivedAt,
      startedAt: null,
      alive: true,
      pid: null,
      transcriptPath: pane.transcriptPath,
      inputRoutes: [route],
      permission: pane.permission
    })
  }
  return out
}
