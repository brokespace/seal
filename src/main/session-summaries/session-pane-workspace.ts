import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { AgentSessionSurface } from '../../shared/live-sessions/live-session-types'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'

export type PaneWorkspaceRuntime = {
  agentTransitions: { latestRow(paneKey: string): AgentStatusIpcPayload | null }
}

/** The workspace holding the chat or terminal pane a session runs in; null when this host has none. */
export function sessionPaneWorkspaceId(
  runtime: PaneWorkspaceRuntime,
  surface: AgentSessionSurface
): string | null {
  if (surface.kind === 'cli') {
    return runtime.agentTransitions.latestRow(surface.paneKey)?.worktreeId ?? null
  }
  if (surface.kind === 'chat') {
    const record = getStructuredAgentSessionHost()?.deps.store.getRecord(surface.sessionId)
    return record?.location.workspaceId ?? null
  }
  return null
}
