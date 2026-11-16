import { useCallback } from 'react'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'

/** `<contentType>\n<entityId>` of the active tab of the workspace on view; null off the workspace view. */
function showingTabKey(state: AppState): string | null {
  const worktreeId = state.activeView === 'terminal' ? state.activeWorktreeId : null
  if (!worktreeId) {
    return null
  }
  const groupId = state.activeGroupIdByWorktree[worktreeId]
  const group = (state.groupsByWorktree[worktreeId] ?? []).find((g) => g.id === groupId)
  const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.id === group?.activeTabId
  )
  return tab ? `${tab.contentType}\n${tab.entityId}` : null
}

/** The tab a session shows in, as `showingTabKey` spells it. */
function sessionTabKey(session: LiveSession): string {
  const { surface } = session
  if (surface.kind === 'chat') {
    return `agent-session\n${surface.sessionId}`
  }
  if (surface.kind === 'cli') {
    return `terminal\n${surface.paneKey.slice(0, surface.paneKey.lastIndexOf(':'))}`
  }
  return `external-agent-session\n${session.id}`
}

/** Whether a session's tab is the one on view: what marks its row as current. */
export function useIsAgentSessionShowing(): (session: LiveSession) => boolean {
  const showing = useAppStore(showingTabKey)
  return useCallback((session) => showing !== null && sessionTabKey(session) === showing, [showing])
}
