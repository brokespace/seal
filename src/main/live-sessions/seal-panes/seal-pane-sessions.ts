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
import { liveSessionId, projectOf } from '../discovery/session-assembly'
import { oneLine } from '../discovery/transcript-summary'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'

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
}

function hookStatus(state: SealPaneRow['state']): LiveSessionStatus {
  switch (state) {
    case 'working':
      return 'working'
    case 'blocked':
      return 'needs-permission'
    default:
      // A finished turn in a live pane waits for the next prompt.
      return 'waiting-input'
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

export function sealPanesFromRows(
  rows: SealPaneRow[],
  pendingPrompt: (paneKey: string, agent: LiveSessionProvider) => PendingPrompt | null
): SealPane[] {
  return rows.flatMap((row) => {
    const provider: LiveSessionProvider | null =
      row.agentType === 'claude' ? 'claude' : row.agentType === 'codex' ? 'codex' : null
    const id = row.providerSession?.id
    if (!provider || !id || row.providerSessionOnly) {
      return []
    }
    const status = hookStatus(row.state)
    const permission =
      status === 'needs-permission' || row.state === 'waiting'
        ? permissionFromPendingPrompt(pendingPrompt(row.paneKey, provider))
        : null
    return [
      {
        paneKey: row.paneKey,
        provider,
        providerSessionId: id,
        connectionId: row.connectionId,
        status,
        statusDetail:
          status === 'working' && row.toolName
            ? row.toolName
            : row.state === 'waiting'
              ? 'Question for you'
              : (permission?.question ?? null),
        cwd: row.providerSession?.cwd ?? null,
        transcriptPath: row.providerSession?.transcriptPath ?? null,
        prompt: row.prompt ? oneLine(row.prompt, 80) : null,
        receivedAt: row.receivedAt,
        permission
      }
    ]
  })
}

const REMOTE_SEAL_MACHINE: LiveSessionMachine = {
  hostId: 'seal-remote',
  label: 'Remote Seal host',
  kind: 'ssh'
}

/** Seal's hooks know its own panes best; discovery adds what they don't say (machine, liveness, title). */
export function mergeSealPanes(
  discovered: LiveSession[],
  panes: SealPane[],
  localMachine: LiveSessionMachine
): LiveSession[] {
  const out = [...discovered]
  for (const pane of panes) {
    const index = out.findIndex(
      (s) =>
        s.provider === pane.provider &&
        s.providerSessionId === pane.providerSessionId &&
        (pane.connectionId === null) === (s.machine.hostId === LOCAL_HOST_ID)
    )
    const route = { kind: 'seal-pane' as const, paneKey: pane.paneKey }
    if (index !== -1) {
      const found = out[index]
      const screenAsks = found.statusSource === 'screen' && found.permission !== null
      out[index] = {
        ...found,
        origin: 'seal',
        status: screenAsks ? found.status : pane.status,
        statusSource: screenAsks ? 'screen' : 'seal-hooks',
        statusDetail: screenAsks ? found.statusDetail : (pane.statusDetail ?? found.statusDetail),
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
