import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { LiveTodo } from '../../../shared/live-sessions/live-session-activity'
import { liveSessionStatusFromEvidence } from '../../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionPermissionPrompt,
  LiveSessionStatus
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatContextUsageSummary } from '../../../shared/native-chat/native-chat-context-usage-summary'
import { liveSessionAdapter } from '../adapters/live-session-adapters'
import { sessionCapabilities } from '../adapters/session-capabilities'
import { liveSessionId, projectOf } from '../discovery/session-assembly'
import { oneLine } from '../discovery/transcript-records'
import { structuredSessionActivity } from './structured-session-activity'
import {
  structuredSessionEvidence,
  type StructuredToolInFlight
} from './structured-session-evidence'
import {
  leadingRequest,
  permissionFromRequest,
  type StructuredSessionRequest
} from './structured-session-prompts'

type HandleChain = Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'providerHandleChain'>

export type StructuredSessionSummary = Pick<
  AgentSessionStatusSummary,
  | 'status'
  | 'latestPrompt'
  | 'updatedAt'
  | 'hostExecutionOwned'
  | 'toolName'
  | 'lastAssistantMessage'
  | 'turnOutcome'
  | 'children'
  | 'backgroundTasks'
  | 'model'
>

/** Everything one chat's record is made from; the source reads it from the host. */
export type StructuredSessionFacts = {
  record: HandleChain &
    Pick<
      AgentSessionRecord,
      'conversationName' | 'conversationNameSource' | 'sleptAt' | 'options' | 'createdAt'
    >
  /** The chat this one was forked from, while its record is held. */
  forkedFrom: HandleChain | null
  machine: LiveSessionMachine
  /** The host's published summary, or the one saved with the record. */
  summary: StructuredSessionSummary
  requests: readonly StructuredSessionRequest[]
  toolInFlight: StructuredToolInFlight | null
  todos: readonly LiveTodo[]
  tab: { id: string; visible: boolean }
  /** The host can start or resume the chat, so it takes a message. */
  takesInput: boolean
  cwd: string | null
  configDir: string | null
  /** The agent process, while this host runs one for the chat. */
  pid: number | null
  context: NativeChatContextUsageSummary | null
}

/** The provider's own conversation id, or `seal-<chat>` until the provider has named one. */
export function structuredProviderSessionId(
  record: Pick<AgentSessionRecord, 'sessionId' | 'providerHandleChain'>
): string {
  return (
    agentSessionProviderHandleChainHead(record.providerHandleChain)?.handle.nativeId ??
    `seal-${record.sessionId}`
  )
}

/** Registry ids the conversation went by before: earlier handles, and the chat it was forked from. */
function earlierIds(facts: StructuredSessionFacts, providerSessionId: string): string[] {
  const { record, forkedFrom, machine } = facts
  const ids = new Set<string>()
  const add = (agent: string, id: string): void => {
    const provider = liveSessionAdapter(agent)?.agent
    if (provider && id !== providerSessionId) {
      ids.add(liveSessionId(machine.hostId, provider, id))
    }
  }
  for (const link of record.providerHandleChain.slice(0, -1)) {
    add(record.provider, link.handle.nativeId)
  }
  if (forkedFrom) {
    add(forkedFrom.provider, structuredProviderSessionId(forkedFrom))
  }
  return [...ids]
}

function statusDetail(
  status: LiveSessionStatus,
  summary: StructuredSessionSummary,
  permission: LiveSessionPermissionPrompt | null
): string | null {
  switch (status) {
    case 'working':
      return summary.toolName ?? null
    case 'waiting-input':
      return 'Question for you'
    case 'your-turn':
      return summary.turnOutcome === 'cancellation' || summary.turnOutcome === 'superseded'
        ? 'Interrupted'
        : null
    case 'needs-permission':
      return permission?.question ?? null
    case 'errored':
    case 'running-shell':
    case 'waiting-subagent':
    case 'waiting-task':
    case 'idle':
    case 'done':
      return null
  }
}

/** One chat as the registry lists it; null when no adapter runs the agent as a chat. */
export function structuredLiveSession(facts: StructuredSessionFacts): LiveSession | null {
  const { record, summary, machine } = facts
  const adapter = liveSessionAdapter(record.provider)
  if (!adapter?.chat) {
    return null
  }
  const provider = adapter.agent
  const providerSessionId = structuredProviderSessionId(record)
  const alive = summary.hostExecutionOwned === true
  const activity = structuredSessionActivity(summary, facts.todos)
  const status = liveSessionStatusFromEvidence(
    structuredSessionEvidence({
      summary,
      requests: facts.requests,
      toolInFlight: facts.toolInFlight,
      activity,
      // A chat at rest with its tab open still takes a message: only a closed one has ended.
      ended: !alive && (record.sleptAt !== undefined || !facts.tab.visible || !facts.takesInput)
    })
  )
  const permission = permissionFromRequest(leadingRequest(facts.requests))
  const surface: LiveSession['surface'] = {
    kind: 'chat',
    sessionId: record.sessionId,
    tabId: facts.tab.id
  }
  const inputRoutes: LiveSession['inputRoutes'] = facts.takesInput
    ? [{ kind: 'structured', sessionId: record.sessionId }]
    : []
  const continues = earlierIds(facts, providerSessionId)
  const model = summary.model ?? record.options?.model
  return {
    id: liveSessionId(machine.hostId, provider, providerSessionId),
    provider,
    providerSessionId,
    machine,
    origin: 'seal',
    cwd: facts.cwd,
    project: projectOf(facts.cwd),
    title: record.conversationName ?? (oneLine(summary.latestPrompt, 80) || null),
    ...(record.conversationName && record.conversationNameSource === 'user'
      ? { titleNamed: true as const }
      : {}),
    status,
    statusSource: 'seal-hooks',
    statusDetail: statusDetail(status, summary, permission),
    lastActivityAt: summary.updatedAt,
    startedAt: record.createdAt,
    alive,
    pid: alive ? facts.pid : null,
    transcriptPath: null,
    inputRoutes,
    permission,
    activity,
    lastMessage: summary.lastAssistantMessage ? oneLine(summary.lastAssistantMessage) : null,
    configDir: facts.configDir,
    ...(continues.length > 0 ? { continues } : {}),
    surface,
    capabilities: sessionCapabilities({
      provider,
      providerSessionId,
      surface,
      machine,
      inputRoutes
    }),
    ...(facts.context ? { context: facts.context } : {}),
    ...(model ? { model } : {})
  }
}
