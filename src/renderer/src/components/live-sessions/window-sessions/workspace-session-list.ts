// One row per agent session: the registry's records, and each agent this window shows that no record covers yet.
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import type { StructuredTab } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { agentSessionAdapter } from '../../../../../shared/live-sessions/adapters/agent-session-adapters'
import { isProvisionalLiveSessionId } from '../../../../../shared/live-sessions/live-session-provisional-id'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { findAgentSessionRecord } from '../chat/use-agent-session-record'
import { windowSubagents } from './window-agent-session'

export type WorkspaceSessionListInputs = {
  /** The registry's records of this workspace. */
  listed: readonly LiveSession[]
  /** Every registry record: one may cover an agent here while it is listed elsewhere. */
  all: readonly LiveSession[]
  /** This workspace's agents as the window's own status feed shows them. */
  rows: readonly DashboardAgentRow[]
  /** This workspace's chat tabs by the pane key their status rows carry. */
  chats: ReadonlyMap<string, StructuredTab>
  build: (
    row: DashboardAgentRow,
    chat: StructuredTab | undefined,
    subagents: readonly DashboardAgentRow[]
  ) => LiveSession | null
}

const namedByRecords = new WeakMap<readonly LiveSession[], Map<string, LiveSession>>()

function namedRecords(all: readonly LiveSession[]): Map<string, LiveSession> {
  let named = namedByRecords.get(all)
  if (!named) {
    named = new Map()
    for (const session of all) {
      if (!isProvisionalLiveSessionId(session.providerSessionId)) {
        named.set(session.providerSessionId, session)
      }
    }
    namedByRecords.set(all, named)
  }
  return named
}

/** The record of a row's agent: by its chat, its pane, or the session its hooks named. */
function recordOf(
  all: readonly LiveSession[],
  row: DashboardAgentRow,
  chat: StructuredTab | undefined
): LiveSession | null {
  const record = findAgentSessionRecord(
    all,
    chat ? { kind: 'chat', sessionId: chat.entityId } : { kind: 'pane', paneKey: row.paneKey },
    (sessionId) => sessionId
  )
  const named = row.entry.providerSession?.id
  return record ?? (named ? (namedRecords(all).get(named) ?? null) : null)
}

/** Discovery lists a fresh agent's process before its hooks name the session: that agent, not a second one. */
function unnamedProcessOf(
  listed: readonly LiveSession[],
  row: DashboardAgentRow,
  taken: ReadonlySet<LiveSession>
): LiveSession | null {
  if (row.entry.providerSession?.id || row.rowSource === 'retained') {
    return null
  }
  const agent = agentSessionAdapter(row.agentType)?.agent
  return (
    listed.find(
      (session) =>
        session.alive &&
        session.surface.kind === 'external' &&
        session.provider === agent &&
        session.providerSessionId.startsWith('pid-') &&
        !taken.has(session)
    ) ?? null
  )
}

const filledRecords = new WeakMap<LiveSession, { from: string; filled: LiveSession }>()

/** A record whose host reports no model, or no subagents, shows the ones this window's feed carries. */
function recordWithWindowDetails(
  record: LiveSession,
  row: DashboardAgentRow,
  children: readonly DashboardAgentRow[]
): LiveSession {
  const model = record.model ? undefined : row.entry.model?.trim()
  const subagents = record.activity?.subagents.length ? [] : windowSubagents(children)
  if (!model && subagents.length === 0) {
    return record
  }
  const from = `${model ?? ''}|${subagents.map((child) => `${child.id}:${child.status}`).join()}`
  const known = filledRecords.get(record)
  if (known?.from === from) {
    return known.filled
  }
  const filled: LiveSession = {
    ...record,
    ...(model ? { model } : {}),
    ...(subagents.length > 0
      ? { activity: { tasks: [], todos: [], ...record.activity, subagents } }
      : {})
  }
  filledRecords.set(record, { from, filled })
  return filled
}

/** `listed` itself while the registry covers every agent of the workspace. */
export function workspaceSessionList(inputs: WorkspaceSessionListInputs): readonly LiveSession[] {
  const { listed, all, rows, chats, build } = inputs
  let out: LiveSession[] | null = null
  const taken = new Set<LiveSession>()
  const added = new Set<string>()
  const subagents = new Map<string, DashboardAgentRow[]>()
  for (const row of rows) {
    if (row.rowSource === 'subagent' && row.activationPaneKey) {
      subagents.set(row.activationPaneKey, [...(subagents.get(row.activationPaneKey) ?? []), row])
    }
  }
  // Running agents first: an ended row never takes the id its resumed session goes by.
  const agents = rows.filter((row) => row.rowSource !== 'subagent')
  const ordered = [
    ...agents.filter((row) => row.rowSource !== 'retained'),
    ...agents.filter((row) => row.rowSource === 'retained')
  ]
  for (const row of ordered) {
    const chat = chats.get(row.paneKey)
    const record = recordOf(all, row, chat)
    if (record) {
      const filled = recordWithWindowDetails(record, row, subagents.get(row.paneKey) ?? [])
      const at = filled === record ? -1 : listed.indexOf(record)
      if (at !== -1) {
        out ??= [...listed]
        out[at] = filled
      }
      continue
    }
    const process = chat ? null : unnamedProcessOf(listed, row, taken)
    if (process) {
      taken.add(process)
      continue
    }
    const session = build(row, chat, subagents.get(row.paneKey) ?? [])
    if (session && !added.has(session.id)) {
      added.add(session.id)
      out ??= [...listed]
      out.push(session)
    }
  }
  return out ?? listed
}
