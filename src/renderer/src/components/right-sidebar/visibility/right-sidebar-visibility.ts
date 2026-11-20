import type { AppState } from '@/store/types'
import { splitViewStore } from '@/components/split-view/split-view-store'
import { getIndexedRepoMap } from '@/store/repos/repository-catalog-index'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'

type ActiveView = AppState['activeView']

const RIGHT_SIDEBAR_SUPPRESSED_VIEWS = new Set<ActiveView>([
  'home',
  'settings',
  'tasks',
  'activity',
  'automations',
  'space',
  'skills',
  'artifacts',
  'mobile',
  'project'
])

export function canShowRightSidebarForView(activeView: ActiveView): boolean {
  // Split view keeps the sidebar on the last focused workspace, as the session page does.
  if (activeView === 'project' && splitViewStore.hasLayout()) {
    return true
  }
  return !RIGHT_SIDEBAR_SUPPRESSED_VIEWS.has(activeView)
}

/** Workspace and creation surfaces have no titlebar strip, so the closed sidebar needs its own toggle there. */
export function showsFloatingRightSidebarToggle(layout: {
  activeView: ActiveView
  workspaceChromeActive: boolean
  creationLayoutActive: boolean
  rightSidebarOpen: boolean
}): boolean {
  return (
    (layout.workspaceChromeActive || layout.creationLayoutActive) &&
    !layout.rightSidebarOpen &&
    canShowRightSidebarForView(layout.activeView)
  )
}

export function rightSidebarShowsPullRequestData(
  state: Pick<
    AppState,
    | 'activeView'
    | 'activeWorktreeId'
    | 'repos'
    | 'rightSidebarOpen'
    | 'rightSidebarTab'
    | 'worktreesByRepo'
  >
): boolean {
  if (
    !canShowRightSidebarForView(state.activeView) ||
    !state.rightSidebarOpen ||
    (state.rightSidebarTab !== 'checks' && state.rightSidebarTab !== 'source-control')
  ) {
    return false
  }

  const activeWorktree = state.activeWorktreeId
    ? getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(state.activeWorktreeId)
    : undefined
  const activeRepo = activeWorktree
    ? getIndexedRepoMap(state.repos).get(activeWorktree.repoId)
    : null
  if (!activeRepo || isFolderRepo(activeRepo)) {
    return false
  }

  return true
}
