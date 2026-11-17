import { useCallback, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store/index'
import { selectActiveTabForWorktree } from '@/store/slices/tabs/active-tab-selection'
import type { AppState } from '@/store/types'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { Tab } from '../../../../../shared/tab-types'
import { readWorkspaceSessions } from '../links/use-workspace-sessions'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { isSessionTab } from './agent-session-tab-match'

/** The workspace whose tabs the main area shows; null off the workspace view. */
function worktreeOnView(state: AppState): string | null {
  return state.activeView === 'terminal' ? state.activeWorktreeId : null
}

function tabOnView(state: AppState): Tab | null {
  const worktreeId = worktreeOnView(state)
  return worktreeId ? selectActiveTabForWorktree(state, worktreeId) : null
}

/** Whether a session's tab is the one on view: what marks its row as current. */
export function useIsAgentSessionShowing(): (session: LiveSession) => boolean {
  const contentType = useAppStore((state) => tabOnView(state)?.contentType)
  const entityId = useAppStore((state) => tabOnView(state)?.entityId)
  return useCallback(
    (session) =>
      contentType !== undefined &&
      entityId !== undefined &&
      isSessionTab({ contentType, entityId }, session),
    [contentType, entityId]
  )
}

/** Whether a workspace's tab on view is a listed session's: then that row is marked, not the workspace's card. */
export function isSessionOnViewIn(worktreeId: string): boolean {
  const tab = selectActiveTabForWorktree(useAppStore.getState(), worktreeId)
  if (!tab) {
    return false
  }
  const shows = (session: LiveSession): boolean => isSessionTab(tab, session)
  return (
    liveSessionRegistryStore.getState().sessions.some(shows) ||
    readWorkspaceSessions(worktreeId).some(shows)
  )
}

function isSessionOnView(): boolean {
  const worktreeId = worktreeOnView(useAppStore.getState())
  return worktreeId !== null && isSessionOnViewIn(worktreeId)
}

function subscribeToSessionOnView(listener: () => void): () => void {
  const stopTabs = useAppStore.subscribe(listener)
  const stopSessions = liveSessionRegistryStore.subscribe(listener)
  return () => {
    stopTabs()
    stopSessions()
  }
}

/** `isSessionOnViewIn` for the workspace on view, re-rendering only when the answer flips. */
export function useIsSessionOnView(): boolean {
  return useSyncExternalStore(subscribeToSessionOnView, isSessionOnView)
}
