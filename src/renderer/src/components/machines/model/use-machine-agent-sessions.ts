import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  selectDetectedWorktreesByRepo,
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/workspace/ownership/worktree-runtime-owner-state'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { groupLiveAgentSessionsByMachine, type MachineAgentSession } from './machine-agent-sessions'

// Statuses go stale without any store write, so freshness is re-evaluated on a slow tick.
const FRESHNESS_TICK_MS = 30_000

export function useMachineAgentSessions(): Map<ExecutionHostId, MachineAgentSession[]> {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const ownerState = useAppStore(
    useShallow((s): WorktreeRuntimeOwnerState => ({
      repos: s.repos,
      settings: s.settings,
      worktreesByRepo: selectWorktreesByRepo(s),
      detectedWorktreesByRepo: selectDetectedWorktreesByRepo(s),
      folderWorkspaces: selectFolderWorkspaces(s),
      projectGroups: s.projectGroups,
      restoredRuntimeHostIdByWorkspaceSessionKey: s.restoredRuntimeHostIdByWorkspaceSessionKey,
      activeWorktreeId: s.activeWorktreeId,
      activeWorkspaceExecutionHostId: s.activeWorkspaceExecutionHostId,
      runtimeEnvironments: s.runtimeEnvironments,
      runtimeEnvironmentCatalogHydrated: s.runtimeEnvironmentCatalogHydrated,
      removedRuntimeEnvironmentIds: s.removedRuntimeEnvironmentIds
    }))
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(
    () =>
      installWindowVisibilityInterval({
        run: () => setNow(Date.now()),
        intervalMs: FRESHNESS_TICK_MS
      }),
    []
  )
  return useMemo(
    () =>
      groupLiveAgentSessionsByMachine(
        agentStatusByPaneKey,
        tabsByWorktree,
        (worktreeId) => getExecutionHostIdForWorktree(ownerState, worktreeId),
        now
      ),
    [agentStatusByPaneKey, tabsByWorktree, ownerState, now]
  )
}
