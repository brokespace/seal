import { useMemo, useSyncExternalStore } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { getStructuredAgentSessionTabsByPaneKey } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import {
  createWorktreeAgentRowsSelector,
  getSharedWorktreeAgentRowsSelector
} from '@/components/sidebar/workspace-card/activity/worktree-agent-rows-projection'
import { useAppStore } from '@/store/index'
import { useAppStateView, useAppStateViewActive } from '@/store/retained-views/app-state-view'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { SessionWorkspaceRef } from '../../../../../shared/sidebar-list/row-types'
import { useLiveSessions } from '../live-session-registry-store'
import { workspaceSessionList } from '../window-sessions/workspace-session-list'
import { useSidebarSessionGroups, windowSessionBuilder } from './use-workspace-sessions'

const NONE: readonly LiveSession[] = []
const NO_WORKSPACES: readonly SessionWorkspaceRef[] = []

type AgentRowsSnapshot = readonly (readonly DashboardAgentRow[])[]

/** Reads each workspace's agent rows; returns the same array while none of them changes. */
function workspacesAgentRowsReader(
  workspaces: readonly SessionWorkspaceRef[],
  live: boolean,
  store: ReturnType<typeof useAppStateView>
): () => AgentRowsSnapshot {
  // Live reads share the cards' selectors; a retained view's frozen state keeps its own memo.
  const selectors = workspaces.map(({ worktreeId, hostId }) =>
    live
      ? getSharedWorktreeAgentRowsSelector(worktreeId, hostId)
      : createWorktreeAgentRowsSelector(worktreeId, hostId)
  )
  let last: AgentRowsSnapshot = []
  return () => {
    const state = store.getState()
    const next = selectors.map((select) => select(state))
    if (next.length !== last.length || next.some((rows, index) => rows !== last[index])) {
      last = next
    }
    return last
  }
}

/** Each workspace's agents as the window's own status feed shows them. */
function useWorkspacesAgentRows(workspaces: readonly SessionWorkspaceRef[]): AgentRowsSnapshot {
  const store = useAppStateView()
  const live = useAppStateViewActive()
  const getRows = useMemo(
    () => workspacesAgentRowsReader(workspaces, live, store),
    [workspaces, live, store]
  )
  return useSyncExternalStore(store.subscribe, getRows, getRows)
}

/** Every session of several workspaces in one list, each as its card would list it. */
export function useWorkspacesSessions(
  workspaces: readonly SessionWorkspaceRef[] = NO_WORKSPACES
): readonly LiveSession[] {
  const { byWorkspace } = useSidebarSessionGroups()
  const { sessions: all } = useLiveSessions()
  const rows = useWorkspacesAgentRows(workspaces)
  const chats = useAppStore((state) =>
    getStructuredAgentSessionTabsByPaneKey(state.unifiedTabsByWorktree)
  )
  return useMemo(() => {
    if (workspaces.length === 0) {
      return NONE
    }
    const ids = new Set<string>()
    return workspaces.flatMap(({ worktreeId }, index) =>
      workspaceSessionList({
        listed: byWorkspace.get(worktreeId) ?? NONE,
        all,
        rows: rows[index] ?? [],
        chats,
        build: windowSessionBuilder(worktreeId, all)
      }).filter((session) => {
        const fresh = !ids.has(session.id)
        ids.add(session.id)
        return fresh
      })
    )
  }, [workspaces, byWorkspace, all, rows, chats])
}
