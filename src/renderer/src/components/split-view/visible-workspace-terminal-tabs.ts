import type { AppState } from '@/store/types'
import type { VisibleWorkspacePanes } from './visible-workspace-panes'

type ActiveTerminalTabState = Pick<
  AppState,
  'groupsByWorktree' | 'activeGroupIdByWorktree' | 'unifiedTabsByWorktree'
>

/**
 * The terminal tab each workspace shown in a pane has in front, joined by newlines. Agents in
 * them are on screen, so they count as foreground and are not hibernated.
 */
export function selectPaneWorkspaceTerminalTabIds(
  state: ActiveTerminalTabState,
  visibleWorkspacePanes: VisibleWorkspacePanes
): string {
  const tabIds: string[] = []
  for (const [worktreeId, paneId] of visibleWorkspacePanes) {
    if (paneId === null) {
      continue
    }
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const groupId = state.activeGroupIdByWorktree[worktreeId] ?? groups[0]?.id
    const activeTabId = groups.find((group) => group.id === groupId)?.activeTabId
    const tab = activeTabId
      ? state.unifiedTabsByWorktree[worktreeId]?.find((candidate) => candidate.id === activeTabId)
      : undefined
    if (tab?.contentType === 'terminal') {
      tabIds.push(tab.entityId)
    }
  }
  return tabIds.join('\n')
}
