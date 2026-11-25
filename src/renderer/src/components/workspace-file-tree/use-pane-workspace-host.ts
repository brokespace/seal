import { useSyncExternalStore } from 'react'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { splitViewStore } from '../split-view/split-view-store'
import { activeSplitViewItem } from '../split-view/split-view-types'

/**
 * The host a split-view pane names for the workspace it shows. Null in the single view, where the
 * workspace is the selected one and the selection names its host.
 */
export function usePaneWorkspaceHostId(
  paneId: string | null,
  worktreeId: string
): ExecutionHostId | null {
  return useSyncExternalStore(splitViewStore.subscribe, () => {
    const item = paneId ? activeSplitViewItem(splitViewStore.getState(), paneId) : null
    return item?.kind === 'workspace' && item.worktreeId === worktreeId
      ? normalizeExecutionHostId(item.hostId)
      : null
  })
}
