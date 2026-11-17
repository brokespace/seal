// An agent as this window's own status feed shows it, in the registry's record shape, for the time no registry record covers it.
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import type { StructuredTab } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { agentNoUpdateLabel } from '../../../../../shared/agent-status/presentation/agent-row-decay-state'
import { agentSessionAdapter } from '../../../../../shared/live-sessions/adapters/agent-session-adapters'
import type { LiveSubagent } from '../../../../../shared/live-sessions/live-session-activity'
import { liveSessionId, projectOf } from '../../../../../shared/live-sessions/live-session-id'
import { isProvisionalLiveSessionId } from '../../../../../shared/live-sessions/live-session-provisional-id'
import type {
  AgentSessionCapabilityFlags,
  LiveSession,
  LiveSessionMachine,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import {
  sealPaneFromRow,
  sealPaneRecord,
  type SealPane
} from '../../../../../shared/live-sessions/seal-pane-session'

/** Sends, answers, history and removal go through the registry: they wait for its record. */
const SHOWN_AND_OPENED_ONLY: AgentSessionCapabilityFlags = {
  send: false,
  answer: 'none',
  transcript: false,
  recap: false,
  context: 'none',
  switchSurface: { toChat: false, toCli: false },
  takeOver: false
}

const worktreeBySession = new WeakMap<LiveSession, string>()

/** The workspace whose pane or chat a window-listed session runs in; null for a registry record. */
export function windowAgentSessionWorktreeId(session: LiveSession): string | null {
  return worktreeBySession.get(session) ?? null
}

export type WindowAgentSessionPlace = {
  worktreeId: string
  machine: LiveSessionMachine
  /** The chat tab behind the row; absent for a terminal pane. */
  chat: StructuredTab | undefined
  /** The name its tab shows where the prompt is not the title: a named chat, or a pane known by its title alone. */
  name: string | null
  /** The workspace's folder, where the agent runs unless its hooks say otherwise. */
  cwd: string | null
  /** The row's child rows, which the card listed under it. */
  subagents: readonly DashboardAgentRow[]
}

function statusOf(row: DashboardAgentRow, pane: SealPane): LiveSessionStatus {
  if (row.rowSource === 'retained') {
    return pane.status === 'errored' ? 'errored' : 'done'
  }
  // Decayed, or a title that shows no activity: nothing says it is at work.
  return row.state === 'idle' || row.state === 'unverifiable' ? 'idle' : pane.status
}

/** The agents a row started, as its child rows carry them. */
export function windowSubagents(rows: readonly DashboardAgentRow[]): LiveSubagent[] {
  return rows.flatMap(({ childRow: child }) =>
    child?.kind === 'agent'
      ? [
          {
            id: child.id,
            title: child.name,
            agentType: child.agentType ?? null,
            model: child.model ?? null,
            status: child.settled ? 'completed' : 'running',
            background: false,
            activity: null,
            startedAt: child.firstObservedAt > 0 ? child.firstObservedAt : null,
            lastActivityAt: child.observedAt ?? null,
            transcriptPath: null
          }
        ]
      : []
  )
}

/** Null for an agent the launcher does not know: it has no icon, name or resume to show. */
export function windowAgentSession(
  row: DashboardAgentRow,
  place: WindowAgentSessionPlace,
  now: number
): LiveSession | null {
  const adapter = agentSessionAdapter(row.agentType)
  if (!adapter) {
    return null
  }
  const { entry } = row
  const pane = sealPaneFromRow(
    {
      paneKey: row.paneKey,
      state: entry.state,
      agentType: entry.agentType,
      providerSession: entry.providerSession,
      receivedAt: entry.updatedAt,
      stateStartedAt: entry.stateStartedAt,
      connectionId: entry.connectionId ?? null,
      prompt: entry.prompt,
      toolName: entry.toolName,
      lastAssistantMessage: entry.lastAssistantMessage,
      lastAssistantMessageIsToolOutput: entry.lastAssistantMessageIsToolOutput,
      workingMode: entry.workingMode,
      interrupted: entry.interrupted,
      mainAgent: entry.mainAgent,
      restoredUnconfirmed: entry.restoredUnconfirmed,
      evidenceObservedAt: entry.evidenceObservedAt
    },
    adapter,
    null,
    now
  )
  const { chat } = place
  // A chat its provider has not named goes by the id its host's record will carry.
  const providerSessionId =
    chat && isProvisionalLiveSessionId(pane.providerSessionId)
      ? `seal-${chat.entityId}`
      : pane.providerSessionId
  const status = statusOf(row, pane)
  const cwd = pane.cwd ?? place.cwd
  const titleOnly = entry.observation?.origin === 'title'
  const model = entry.model?.trim()
  const subagents = windowSubagents(place.subagents)
  const session: LiveSession = {
    ...sealPaneRecord(pane, place.machine),
    id: liveSessionId(place.machine.hostId, adapter.agent, providerSessionId),
    providerSessionId,
    cwd,
    project: projectOf(cwd),
    ...(place.name ? { title: place.name } : {}),
    status,
    statusDetail:
      row.state === 'unverifiable'
        ? agentNoUpdateLabel(entry, now)
        : status === pane.status
          ? pane.statusDetail
          : null,
    // A title-derived row's message only repeats its status.
    lastMessage: titleOnly ? null : pane.lastMessage,
    startedAt: row.startedAt > 0 ? row.startedAt : null,
    alive: row.rowSource !== 'retained',
    inputRoutes: [],
    capabilities: SHOWN_AND_OPENED_ONLY,
    ...(chat ? { surface: { kind: 'chat', sessionId: chat.entityId, tabId: chat.id } } : {}),
    ...(model ? { model } : {}),
    ...(subagents.length > 0 ? { activity: { subagents, tasks: [], todos: [] } } : {})
  }
  worktreeBySession.set(session, place.worktreeId)
  return session
}
