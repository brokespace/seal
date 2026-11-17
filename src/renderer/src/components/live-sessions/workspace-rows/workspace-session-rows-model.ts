import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import { compareListedLiveSessions } from '../../../../../shared/live-sessions/live-session-summary'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import { isListedLiveSession } from '../row/live-session-machine-listing'
import { SESSION_FOLD_KEY_PREFIX } from './session-fold-keys'
import {
  matchesSidebarSessionFilters,
  type SidebarSessionFilters
} from './sidebar-session-filter-store'

export type WorkspaceSessionRowsView = {
  /** Pinned first, then what needs the user, working, idle. */
  running: LiveSession[]
  /** Ended in the last day or pinned, newest first. */
  finished: LiveSession[]
  /** What each running session the filters leave out is doing: the card still says it has them. */
  hidden: LiveSessionStatus[]
}

/** The rows one workspace lists: every running session, and the ended ones behind one line. */
export function buildWorkspaceSessionRows(
  sessions: readonly LiveSession[],
  filters: SidebarSessionFilters,
  now: number
): WorkspaceSessionRowsView {
  const running: LiveSession[] = []
  const finished: LiveSession[] = []
  const hidden: LiveSessionStatus[] = []
  for (const session of sessions) {
    if (!isListedLiveSession(session, now)) {
      continue
    }
    if (matchesSidebarSessionFilters(session, filters)) {
      const group = isActiveLiveSession(session) ? running : finished
      group.push(session)
    } else if (isActiveLiveSession(session)) {
      hidden.push(session.status)
    }
  }
  return {
    running: running.sort(compareListedLiveSessions),
    finished: finished.sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    hidden
  }
}

/** A row's identity in its list: the chat or pane it shows, so the row stays itself when the registry's record takes over from this window's. */
export function sessionRowKey(session: LiveSession): string {
  const { surface } = session
  if (surface.kind === 'chat') {
    return `chat:${surface.sessionId}`
  }
  return surface.kind === 'cli' ? `pane:${surface.paneKey}` : session.id
}

/** Present in `collapsedGroups` while a workspace's ended sessions are unfolded; the prefix survives a Projects regrouping. */
export function workspaceFinishedOpenKey(worktreeId: string): string {
  return `${SESSION_FOLD_KEY_PREFIX}finished-open:${worktreeId}`
}
