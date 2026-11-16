import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessions } from '../live-session-registry-store'
import type { LiveSessionLink } from './live-session-links'
import { useLiveSessionLinks } from './use-live-session-links'

type GroupedSessions = {
  byWorkspace: ReadonlyMap<string, readonly LiveSession[]>
  unassigned: readonly LiveSession[]
}

const NONE: readonly LiveSession[] = []

// Every workspace card asks in one render; the links map is new whenever sessions or workspaces change.
const groupedByLinks = new WeakMap<ReadonlyMap<string, LiveSessionLink>, GroupedSessions>()

function groupSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>
): GroupedSessions {
  const known = groupedByLinks.get(links)
  if (known) {
    return known
  }
  const byWorkspace = new Map<string, LiveSession[]>()
  const unassigned: LiveSession[] = []
  for (const session of sessions) {
    const worktreeId = links.get(session.id)?.worktreeId
    if (!worktreeId) {
      unassigned.push(session)
      continue
    }
    const group = byWorkspace.get(worktreeId)
    if (group) {
      group.push(session)
    } else {
      byWorkspace.set(worktreeId, [session])
    }
  }
  const grouped = { byWorkspace, unassigned }
  groupedByLinks.set(links, grouped)
  return grouped
}

function useGroupedSessions(): GroupedSessions {
  const { sessions } = useLiveSessions()
  const { links } = useLiveSessionLinks()
  return groupSessions(sessions, links)
}

/**
 * Every session of a workspace, running or ended, in the registry's order. `worktreeId` is a git
 * worktree's id or a folder workspace's key.
 */
export function useWorkspaceSessions(worktreeId: string): readonly LiveSession[] {
  return useGroupedSessions().byWorkspace.get(worktreeId) ?? NONE
}

/** Every session no workspace holds, or whose workspace this window does not list (yet). */
export function useUnassignedSessions(): readonly LiveSession[] {
  return useGroupedSessions().unassigned
}
