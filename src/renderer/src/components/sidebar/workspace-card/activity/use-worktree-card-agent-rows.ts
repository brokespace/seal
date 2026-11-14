import { useMemo } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { useLiveSessionPaneKeys } from '@/components/live-sessions/links/use-live-session-pane-keys'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { agentRowsWithoutSessionPanes } from './agent-rows-without-session-panes'
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
