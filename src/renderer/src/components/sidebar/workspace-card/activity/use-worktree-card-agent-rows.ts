import { useMemo } from 'react'
import { useStore } from 'zustand'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { useLiveSessionPaneKeys } from '@/components/live-sessions/links/use-live-session-pane-keys'
import { useAppStateView } from '@/store/retained-views/app-state-view'
import type { ExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import {
  agentKeysWithoutSessionPanes,
  agentRowsWithoutSessionPanes
} from './agent-rows-without-session-panes'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'

/** The agent rows a workspace card lists inline. */
export function useWorktreeCardAgentRows(
  worktreeId: string,
  active = true,
  hostId?: ExecutionHostId
): DashboardAgentRow[] {
  const rows = useWorktreeAgentRows(worktreeId, active, hostId)
  const sessionPaneKeys = useLiveSessionPaneKeys()
  return useMemo(() => agentRowsWithoutSessionPanes(rows, sessionPaneKeys), [rows, sessionPaneKeys])
}

/** The root agent keys a workspace card lists inline. */
export function useWorktreeCardAgentRootKeys(roots: readonly string[]): readonly string[] {
  const sessionPaneKeys = useLiveSessionPaneKeys()
  const store = useAppStateView()
  const projection = useStore(store, (state) => state.agentStatusByPaneKey.projection)
  return useMemo(
    () => agentKeysWithoutSessionPanes(roots, sessionPaneKeys, (key) => projection.row(key)),
    [roots, sessionPaneKeys, projection]
  )
}
