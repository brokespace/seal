import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { structuredSessionIdFromNotificationPane } from '../../shared/structured-session-notification-pane'
import { LOCAL_HOST_ID } from '../live-sessions/hosts/live-session-hosts'

/** The machine the registry lists a remote Seal host's panes under. */
const REMOTE_SEAL_HOST_ID = 'seal-remote'

/**
 * The registry's id for the session in a pane (`<host>:<agent>:<provider session>`), which the
 * hook row names before the registry lists it. An agent with no session id yet goes by its chat or
 * its pane.
 */
export function paneRecordId(
  paneKey: string,
  row: Pick<AgentStatusIpcPayload, 'agentType' | 'providerSession' | 'connectionId'>
): string {
  const chat = structuredSessionIdFromNotificationPane(paneKey)
  const session = row.providerSession?.id ?? (chat ? `seal-${chat}` : `pane-${paneKey}`)
  const host = row.connectionId === null ? LOCAL_HOST_ID : REMOTE_SEAL_HOST_ID
  return `${host}:${row.agentType ?? 'unknown'}:${session}`
}
