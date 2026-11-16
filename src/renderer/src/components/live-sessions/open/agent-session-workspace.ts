import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { readLiveSessionLinks } from '../links/use-live-session-links'

/** The workspace a session's tab belongs to: the registry's link, else the one Seal works out here. */
export function agentSessionWorktreeId(session: LiveSession): string | null {
  return (
    session.workspace?.worktreeId ??
    readLiveSessionLinks().links.get(session.id)?.worktreeId ??
    null
  )
}
