import { useMemo, useSyncExternalStore } from 'react'
import { splitViewStore } from './split-view-store'
import { useSplitViewShowing } from './split-view-showing'

/** Worktree id to the pane it shows in; a null pane is the single view's whole area. */
export type VisibleWorkspacePanes = ReadonlyMap<string, string | null>

const NONE: VisibleWorkspacePanes = new Map()

/**
 * Every workspace on screen. Without split view that is the active workspace on the workspace
 * view; in split view the panes alone decide, whichever view the focused pane put the app on.
 */
export function useVisibleWorkspacePanes(
  activeView: string,
  activeWorktreeId: string | null
): { visibleWorkspacePanes: VisibleWorkspacePanes; splitViewShowing: boolean } {
  const splitViewShowing = useSplitViewShowing()
  const inPanes = useSyncExternalStore(
    splitViewStore.subscribe,
    splitViewStore.getVisibleWorkspaces
  )
  const visibleWorkspacePanes = useMemo<VisibleWorkspacePanes>(() => {
    if (splitViewShowing) {
      return inPanes
    }
    return activeView === 'terminal' && activeWorktreeId
      ? new Map([[activeWorktreeId, null]])
      : NONE
  }, [activeView, activeWorktreeId, inPanes, splitViewShowing])
  return { visibleWorkspacePanes, splitViewShowing }
}

/** Adds every workspace whose visibility differs between two sets. */
export function addWorkspacesWithChangedVisibility(
  changed: Set<string>,
  previous: VisibleWorkspacePanes,
  next: VisibleWorkspacePanes
): void {
  if (previous === next) {
    return
  }
  for (const worktreeId of previous.keys()) {
    if (!next.has(worktreeId)) {
      changed.add(worktreeId)
    }
  }
  for (const worktreeId of next.keys()) {
    if (!previous.has(worktreeId)) {
      changed.add(worktreeId)
    }
  }
}
