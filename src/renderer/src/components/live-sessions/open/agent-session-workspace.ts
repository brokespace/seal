import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { readLiveSessionLinks } from '../links/use-live-session-links'

/** The workspace a session's tab belongs to: the one the registry attached it to, once the catalog lists it. */
export function agentSessionWorktreeId(session: LiveSession): string | null {
  return readLiveSessionLinks().links.get(session.id)?.worktreeId ?? null
}
