import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { isAgentSessionAgentId } from '../../shared/live-sessions/adapters/agent-session-agent-ids'
import { structuredSessionIdFromNotificationPane } from '../../shared/structured-session-notification-pane'
import { liveSessionId } from '../live-sessions/discovery/session-assembly'
import { LOCAL_HOST_ID } from '../live-sessions/hosts/live-session-hosts'
import { REMOTE_SEAL_MACHINE } from '../live-sessions/seal-panes/seal-pane-sessions'

/**
 * The registry's id for the session in a pane, which the hook row names before the registry lists
 * it. No record can name an agent without a session id yet, or one with no adapter: it goes by its
 * chat or its pane.
 */
export function paneRecordId(
  paneKey: string,
  row: Pick<AgentStatusIpcPayload, 'agentType' | 'providerSession' | 'connectionId'>
): string {
  const session = row.providerSession?.id
  if (session && isAgentSessionAgentId(row.agentType)) {
    const hostId = row.connectionId === null ? LOCAL_HOST_ID : REMOTE_SEAL_MACHINE.hostId
    return liveSessionId(hostId, row.agentType, session)
  }
  const chat = structuredSessionIdFromNotificationPane(paneKey)
  const where = chat ? `chat ${chat}` : `pane ${paneKey}`
  return [where, row.agentType ?? 'unknown', session ?? ''].join(' ')
}
