import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import { splitViewStore, useSplitViewHasLayout } from './split-view-store'

type ItemViewState = Pick<
  AppState,
  'activeView' | 'activePendingCreationId' | 'pendingWorktreeCreations'
>

/** The main area is on a view that shows items (a workspace, a session, a project), not another page. */
export function selectItemViewShown(state: ItemViewState): boolean {
  return (
    (state.activeView === 'terminal' ||
      state.activeView === 'sessions' ||
      state.activeView === 'project') &&
    !selectWorktreeCreationSurfaceShown(state)
  )
}

/** The grid is what the main area renders. Which pane is focused plays no part. */
export function isSplitViewShowing(): boolean {
  return splitViewStore.hasLayout() && selectItemViewShown(useAppStore.getState())
}

export function useSplitViewShowing(): boolean {
  const hasLayout = useSplitViewHasLayout()
  const itemViewShown = useAppStore(selectItemViewShown)
  return hasLayout && itemViewShown
}
