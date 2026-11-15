import { splitViewStore } from './split-view-store'

/**
 * The workspaces split-view panes put on screen (worktree id to pane id) while `activeView` is one
 * the grid shows on, or null when that view shows no grid. Reads no app state, so store slices can ask.
 */
export function splitViewWorkspacesOnView(activeView: string): ReadonlyMap<string, string> | null {
  const showsItems =
    activeView === 'terminal' || activeView === 'sessions' || activeView === 'project'
  return showsItems && splitViewStore.hasLayout() ? splitViewStore.getVisibleWorkspaces() : null
}
