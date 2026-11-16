import { agentSessionAccountHomePath } from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import { agentSessionConversationView } from '../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { structuredAgentSessionTabId } from '../../../shared/agent-session/view/structured-agent-session-projection'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { savedStructuredAgentSessionStatus } from '../../native-chat/agent-session-wire/observations/structured-agent-session-saved-status'
import { hostCanStartRecord } from '../../native-chat/agent-session-wire/providers/structured-agent-session-provider-support'
import type { StructuredSessionJournalDetail } from './structured-session-journal-detail'
import { structuredSessionRequests } from './structured-session-prompts'
import type { StructuredSessionFacts } from './structured-session-record'

export type StructuredSessionFactsHost = Pick<
  StructuredAgentSessionHost,
  'deps' | 'readStatusSummary' | 'currentWork' | 'getSessionTabId' | 'isSessionTabVisible'
>

/** The window external discovery keeps an ended session listed for. */
const LISTED_FOR_MS = 12 * 60 * 60_000

/** The host runs a chat's agent only where its own store's id says the chat executes. */
export function hostOwnsStructuredSession(
  host: Pick<StructuredAgentSessionHost, 'deps'>,
  record: Pick<AgentSessionRecord, 'location'>
): boolean {
  return record.location.executionHostId === host.deps.store.hostId
}

/** One chat as its host knows it now, without a journal read; null when it is not listed. */
export function structuredSessionHostFacts(
  host: StructuredSessionFactsHost,
  record: AgentSessionRecord,
  known: {
    machine: LiveSessionMachine
    detail: StructuredSessionJournalDetail | null
    cwd: string | null
    now: number
  }
): StructuredSessionFacts | null {
  const { store } = host.deps
  const { sessionId } = record
  const summary =
    host.readStatusSummary(sessionId) ??
    savedStructuredAgentSessionStatus(agentSessionConversationView(record))
  const visible = host.isSessionTabVisible(sessionId)
  if (!visible && known.now - summary.updatedAt > LISTED_FOR_MS) {
    return null
  }
  return {
    record,
    forkedFrom: record.forkedFrom ? store.getRecord(record.forkedFrom.sessionId) : null,
    machine: known.machine,
    summary,
    requests: structuredSessionRequests(host.currentWork(sessionId)?.actionablePrompts() ?? []),
    toolInFlight: known.detail?.toolInFlight ?? null,
    todos: known.detail?.todos ?? [],
    tab: { id: host.getSessionTabId(sessionId) ?? structuredAgentSessionTabId(sessionId), visible },
    takesInput:
      !store.readOnly &&
      store.selectWritableRecord(sessionId).kind === 'writable' &&
      hostCanStartRecord(host.deps, record),
    cwd: known.cwd,
    configDir: agentSessionAccountHomePath(record.accountHome),
    pid: record.lease.ownerProcess?.pid ?? null,
    context: known.detail?.context ?? null
  }
}
