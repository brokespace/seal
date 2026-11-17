import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { readLiveSessionLinks } from '../links/use-live-session-links'
import { windowAgentSessionWorktreeId } from '../window-sessions/window-agent-session'
import { findExternalAgentSessionTab } from './external-agent-session-tab'

/** The workspace a session's tab belongs to: the one the registry attached it to once the catalog lists it, or the one whose pane this window lists it from. */
export function agentSessionWorktreeId(session: LiveSession): string | null {
  return (
    readLiveSessionLinks().links.get(session.id)?.worktreeId ??
    windowAgentSessionWorktreeId(session)
  )
}

/**
 * The workspace a session's tab shows in, for a click, a drag and the menu alike: the one its tab
 * is open in, else its own. Null for a session with neither, which opens in whichever workspace
 * is in view or under the drop.
 */
export function agentSessionTabWorktreeId(
  sessionId: string,
  session: LiveSession | null
): string | null {
  return (
    findExternalAgentSessionTab(useAppStore.getState(), sessionId)?.worktreeId ??
    (session ? agentSessionWorktreeId(session) : null)
  )
}
