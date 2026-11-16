import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import { compareListedLiveSessions } from '../../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { isListedLiveSession } from '../active-agents/active-agents-model'
import {
  matchesSidebarSessionFilters,
  type SidebarSessionFilters
} from './sidebar-session-filter-store'

export type WorkspaceSessionRowsView = {
  /** Pinned first, then what needs the user, working, idle. */
  running: LiveSession[]
  /** Ended in the last day or pinned, newest first. */
  finished: LiveSession[]
}

/** The rows one workspace lists: every running session, and the ended ones behind one line. */
export function buildWorkspaceSessionRows(
  sessions: readonly LiveSession[],
  filters: SidebarSessionFilters,
  now: number
): WorkspaceSessionRowsView {
  const running: LiveSession[] = []
  const finished: LiveSession[] = []
  for (const session of sessions) {
    if (isListedLiveSession(session, now) && matchesSidebarSessionFilters(session, filters)) {
      const group = isActiveLiveSession(session) ? running : finished
      group.push(session)
    }
  }
  return {
    running: running.sort(compareListedLiveSessions),
    finished: finished.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }
}

/** Present in `collapsedGroups` while a workspace's ended sessions are unfolded; the prefix survives a Projects regrouping. */
export function workspaceFinishedOpenKey(worktreeId: string): string {
  return `active-agents:finished-open:${worktreeId}`
}
