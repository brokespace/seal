// One agent in a Seal pane as its status row reports it, and the record that row makes on its own.
import type { PendingPrompt } from '../agent-status/contracts/agent-pending-prompt'
import { AGENT_STATUS_STALE_AFTER_MS } from '../agent-status/contracts/agent-status-freshness'
import type { AgentStatusIpcPayload } from '../agent-status/contracts/agent-status-ipc-payload'
import { agentVerdictDisplayMark } from '../agent-status/lifecycle/agent-main-agent-verdict'
import type { AgentSessionAdapter } from './adapters/agent-session-adapter'
import { hookRowEvidence } from './hook-row-evidence'
import { liveSessionId, projectOf } from './live-session-id'
import { liveSessionStatusFromEvidence } from './live-session-status'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionPermissionPrompt,
  LiveSessionStatus
} from './live-session-types'
import { oneLine } from './one-line-text'

export type SealPaneRow = Pick<
  AgentStatusIpcPayload,
  | 'paneKey'
  | 'state'
  | 'agentType'
  | 'providerSession'
  | 'providerSessionOnly'
  | 'structuredHost'
  | 'receivedAt'
  | 'stateStartedAt'
  | 'connectionId'
  | 'prompt'
  | 'toolName'
  | 'lastAssistantMessage'
  | 'lastAssistantMessageIsToolOutput'
  | 'workingMode'
  | 'interrupted'
  | 'mainAgent'
  | 'restoredUnconfirmed'
  | 'evidenceObservedAt'
>

export type SealPane = {
  paneKey: string
  provider: LiveSession['provider']
  /** `pane-<paneKey>` while the agent's hooks have named no session. */
  providerSessionId: string
  /** Null for this machine; the mux connection id for a remote Seal host. */
  connectionId: string | null
  status: LiveSessionStatus
  statusDetail: string | null
  cwd: string | null
  transcriptPath: string | null
  prompt: string | null
  /** The agent's newest message as its hooks carried it, one line. */
  lastMessage: string | null
  receivedAt: number
  permission: LiveSessionPermissionPrompt | null
  /** Its hooks went quiet mid-turn, or were last heard by an earlier run of Seal: they no longer say what the agent does now. */
  silent: boolean
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
    case 'errored':
    case 'running-shell':
    case 'waiting-subagent':
    case 'waiting-task':
    case 'idle':
    case 'done':
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

/** The provider session a pane's hooks have named, if they have. */
export function sealPaneProviderSession(
  row: SealPaneRow,
  adapter: AgentSessionAdapter
): { id: string; cwd?: string; transcriptPath?: string } | null {
  return (adapter.cli?.sessionOf ? adapter.cli.sessionOf(row) : row.providerSession) ?? null
}

/** `prompt` is the question or approval the pane waits on, where the caller can read one. */
export function sealPaneFromRow(
  row: SealPaneRow,
  adapter: AgentSessionAdapter,
  prompt: PendingPrompt | null,
  now: number
): SealPane {
  const session = sealPaneProviderSession(row, adapter)
  const status = liveSessionStatusFromEvidence(hookRowEvidence(row, prompt, adapter))
  const permission = permissionFromPendingPrompt(prompt)
  const message = row.lastAssistantMessageIsToolOutput ? undefined : row.lastAssistantMessage
  return {
    paneKey: row.paneKey,
    provider: adapter.agent,
    providerSessionId: session?.id || `pane-${row.paneKey}`,
    connectionId: row.connectionId,
    status,
    statusDetail: hookDetail(row, status, permission),
    cwd: session?.cwd ?? null,
    transcriptPath: session?.transcriptPath ?? null,
    prompt: row.prompt ? oneLine(row.prompt, 80) : null,
    lastMessage: message ? oneLine(message, 200) : null,
    receivedAt: row.receivedAt,
    permission,
    silent: wentSilent(row, now)
  }
}

/** The record of a pane nothing else has found; what it can do is the listing side's to say. */
export function sealPaneRecord(
  pane: SealPane,
  machine: LiveSessionMachine
): Omit<LiveSession, 'capabilities'> {
  return {
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
    inputRoutes: [{ kind: 'seal-pane', paneKey: pane.paneKey }],
    permission: pane.permission,
    lastMessage: pane.lastMessage,
    surface: { kind: 'cli', paneKey: pane.paneKey }
  }
}
