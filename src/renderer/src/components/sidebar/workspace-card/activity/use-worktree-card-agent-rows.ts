import { useMemo } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { useLiveSessionPaneKeys } from '@/components/live-sessions/links/use-live-session-pane-keys'
import { agentRowsWithoutSessionPanes } from './agent-rows-without-session-panes'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'

/** The agent rows a workspace card lists inline. */
export function useWorktreeCardAgentRows(worktreeId: string, active = true): DashboardAgentRow[] {
  const rows = useWorktreeAgentRows(worktreeId, active)
  const sessionPaneKeys = useLiveSessionPaneKeys()
  return useMemo(() => agentRowsWithoutSessionPanes(rows, sessionPaneKeys), [rows, sessionPaneKeys])
}
