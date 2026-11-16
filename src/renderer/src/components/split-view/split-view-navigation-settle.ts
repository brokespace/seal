import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { registerRemovedActiveWorktreeTakeover } from '@/lib/workspace/activation/active-worktree-removal-takeover'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { hasWorktreeSleepIntent } from '@/lib/workspace/sleep/worktree-sleep-intent'
import { neighbourSplitViewPane } from './split-view-chip-transitions'
import {
  closeSplitViewItems,
  currentSplitViewItem,
  focusSplitViewPane,
  navigateToSplitViewItem,
  revealItemInSplitView,
  workspaceSplitViewItem
} from './split-view-commands'
import { resolveSplitViewItem } from './split-view-item-resolution'
import { isSplitViewShowing } from './split-view-showing'
import { splitViewStore } from './split-view-store'
import {
  activeSplitViewItem,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewState
} from './split-view-types'

function gridItems(): SplitViewItem[] {
  return Object.values(splitViewStore.getState().panes).flatMap((pane) =>
    pane.tabs.map((tab) => tab.item)
  )
}

/**
 * The user put the focused pane's workspace to sleep. Opening it again would wake it, so focus
 * moves on, as single view leaves a workspace it puts to sleep.
 */
function leaveSleepingPane(state: SplitViewState): void {
  const app = useAppStore.getState()
  const paneId = neighbourSplitViewPane(state, 1, (candidate) => {
    const item = activeSplitViewItem(state, candidate)
    if (!item) {
      return false
    }
    const asleep = item.kind === 'workspace' && hasWorktreeSleepIntent(item.worktreeId)
    return !asleep && resolveSplitViewItem(item, app) !== null
  })
  if (paneId) {
    focusSplitViewPane(paneId)
  }
}

/**
 * Keeps "the current item is the focused pane's active chip" in both directions, and closes the
 * chips of workspaces and projects that went away. Started once by the app shell.
 */
export function installSplitViewNavigationSettle(): () => void {
  // Only an item this run saw exist can be pruned, so a slow catalog never empties a restored grid.
  const seenKeys = new Set<string>()
  let scheduled = false
  // Undefined while no creation surface covers the grid.
  let workspaceBeforeCreation: string | null | undefined

  const pruneVanishedItems = (): void => {
    const state = useAppStore.getState()
    const vanished = new Set<string>()
    for (const item of gridItems()) {
      const key = splitViewItemKey(item)
      if (resolveSplitViewItem(item, state)) {
        seenKeys.add(key)
      } else if (seenKeys.has(key)) {
        vanished.add(key)
      }
    }
    for (const key of vanished) {
      seenKeys.delete(key)
    }
    closeSplitViewItems(vanished)
  }

  const settle = (): void => {
    scheduled = false
    // Before the saved session is back there is no current item to settle on, and no catalog.
    if (!splitViewStore.hasLayout() || !useAppStore.getState().workspaceSessionReady) {
      return
    }
    pruneVanishedItems()
    const app = useAppStore.getState()
    if (selectWorktreeCreationSurfaceShown(app)) {
      workspaceBeforeCreation ??= app.activeWorktreeId
    }
    if (!isSplitViewShowing()) {
      return
    }
    const state = splitViewStore.getState()
    const focused = state.focusedPaneId ? activeSplitViewItem(state, state.focusedPaneId) : null
    // A cancelled creation leaves the terminal view on the last workspace, which nobody opened.
    const creationCancelled =
      workspaceBeforeCreation !== undefined &&
      app.activeView === 'terminal' &&
      app.activeWorktreeId === workspaceBeforeCreation
    workspaceBeforeCreation = undefined
    const current = creationCancelled ? null : currentSplitViewItem()
    if (!current) {
      if (focused?.kind === 'workspace' && hasWorktreeSleepIntent(focused.worktreeId)) {
        leaveSleepingPane(state)
      } else if (focused) {
        navigateToSplitViewItem(focused)
      }
      return
    }
    revealItemInSplitView(current)
  }

  // Why a microtask: open paths write the view and then the item; settle must only see the pair.
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true
      queueMicrotask(settle)
    }
  }

  const stopWatchingApp = useAppStore.subscribe((next: AppState, previous: AppState) => {
    if (
      next.activeView !== previous.activeView ||
      next.workspaceSessionReady !== previous.workspaceSessionReady ||
      next.activeWorktreeId !== previous.activeWorktreeId ||
      next.projectOverviewTarget !== previous.projectOverviewTarget ||
      next.activePendingCreationId !== previous.activePendingCreationId ||
      next.pendingWorktreeCreations !== previous.pendingWorktreeCreations ||
      next.repos !== previous.repos ||
      selectWorktreesByRepo(next) !== selectWorktreesByRepo(previous) ||
      selectFolderWorkspaces(next) !== selectFolderWorkspaces(previous)
    ) {
      schedule()
    }
  })
  const stopWatchingGrid = splitViewStore.subscribe(schedule)
  // The removed workspace's successor comes from the grid, never from outside it.
  const stopTakingOver = registerRemovedActiveWorktreeTakeover((worktreeId) => {
    const key = splitViewItemKey(workspaceSplitViewItem({ id: worktreeId }))
    if (!gridItems().some((item) => splitViewItemKey(item) === key)) {
      return false
    }
    seenKeys.delete(key)
    closeSplitViewItems(new Set([key]))
    return true
  })
  schedule()

  return () => {
    stopWatchingApp()
    stopWatchingGrid()
    stopTakingOver()
  }
}
