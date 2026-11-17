import { useMemo } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { rowConversationName } from '@/components/dashboard/snapshot/dashboard-card-labels'
import {
  getStructuredAgentSessionTabsByPaneKey,
  type StructuredTab
} from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { useWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/useWorktreeAgentRows'
import { getStructuredChatTabNames } from '@/runtime/native-chat/naming/structured-chat-name-observation'
import { readStructuredChatTabSavedName } from '@/runtime/native-chat/naming/structured-chat-tab-name'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessions } from '../live-session-registry-store'
import { windowAgentSession } from '../window-sessions/window-agent-session'
import { windowAgentSessionMachine } from '../window-sessions/window-agent-session-machine'
import {
  workspaceSessionList,
  type WorkspaceSessionListInputs
} from '../window-sessions/workspace-session-list'
import type { LiveSessionLink } from './live-session-links'
import { useLiveSessionLinks } from './use-live-session-links'

type GroupedSessions = {
  byWorkspace: ReadonlyMap<string, readonly LiveSession[]>
  unassigned: readonly LiveSession[]
}

const NONE: readonly LiveSession[] = []

// Every workspace card asks in one render; the links map is new whenever sessions or workspaces change.
const groupedByLinks = new WeakMap<ReadonlyMap<string, LiveSessionLink>, GroupedSessions>()

function groupSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>
): GroupedSessions {
  const known = groupedByLinks.get(links)
  if (known) {
    return known
  }
  const byWorkspace = new Map<string, LiveSession[]>()
  const unassigned: LiveSession[] = []
  for (const session of sessions) {
    const worktreeId = links.get(session.id)?.worktreeId
    if (!worktreeId) {
      unassigned.push(session)
      continue
    }
    const group = byWorkspace.get(worktreeId)
    if (group) {
      group.push(session)
    } else {
      byWorkspace.set(worktreeId, [session])
    }
  }
  const grouped = { byWorkspace, unassigned }
  groupedByLinks.set(links, grouped)
  return grouped
}

function useGroupedSessions(): GroupedSessions {
  const { sessions } = useLiveSessions()
  const { links } = useLiveSessionLinks()
  return groupSessions(sessions, links)
}

/** A chat goes by the name its record will carry; a pane known by its title alone, by what that title names. */
function windowSessionName(
  state: AppState,
  row: DashboardAgentRow,
  chat: StructuredTab | undefined
): string | null {
  if (chat) {
    return readStructuredChatTabSavedName(chat, state)
  }
  if (row.entry.observation?.origin !== 'title') {
    return null
  }
  return (
    rowConversationName(
      row,
      state.settings?.tabAutoGenerateTitle === true,
      state.terminalLayoutsByTabId?.[row.tab.id],
      state.runtimePaneTitlesByTabId?.[row.tab.id],
      getStructuredChatTabNames(),
      state.unifiedTabsByWorktree
    ) ?? null
  )
}

/** Reads the clock as the agent rows' own selector does: each new `rows` carries a fresh decay state. */
function windowSessionBuilder(
  worktreeId: string,
  all: readonly LiveSession[]
): WorkspaceSessionListInputs['build'] {
  const now = Date.now()
  const state = useAppStore.getState()
  return (row, chat, subagents) =>
    windowAgentSession(
      row,
      {
        worktreeId,
        machine: windowAgentSessionMachine(state, row, worktreeId, all),
        chat,
        name: windowSessionName(state, row, chat),
        subagents
      },
      now
    )
}

/**
 * Every session of a workspace, running or ended: the registry's records in its order, then each
 * agent this window's own panes and chats show that no record covers yet, so a session is listed
 * as soon as either knows it and only once. `worktreeId` is a git worktree's id or a folder
 * workspace's key; `hostId` keeps to the agents of one of its hosts.
 */
export function useWorkspaceSessions(
  worktreeId: string,
  hostId?: ExecutionHostId
): readonly LiveSession[] {
  const listed = useGroupedSessions().byWorkspace.get(worktreeId) ?? NONE
  const { sessions: all } = useLiveSessions()
  const rows = useWorktreeAgentRows(worktreeId, true, hostId)
  // Every workspace's chats: the map stays the same while no chat tab changes anywhere.
  const chats = useAppStore((state) =>
    getStructuredAgentSessionTabsByPaneKey(state.unifiedTabsByWorktree)
  )
  return useMemo(
    () =>
      workspaceSessionList({
        listed,
        all,
        rows,
        chats,
        build: windowSessionBuilder(worktreeId, all)
      }),
    [listed, all, rows, chats, worktreeId]
  )
}

/** Every session no workspace holds, or whose workspace this window does not list (yet). */
export function useUnassignedSessions(): readonly LiveSession[] {
  return useGroupedSessions().unassigned
}
