import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import {
  isActiveLiveSession,
  topLiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-status'

/** The workspace a session runs in, when Seal knows one. */
export type LiveSessionLink = { worktreeId: string; repoId: string; name: string }

export type LinkableWorktree = {
  id: string
  repoId: string
  path: string
  name: string
  /** The execution host that owns it; null when unknown. */
  hostId: string | null
}

/**
 * A Seal pane's session belongs to the workspace its tab is in; any other belongs to the workspace
 * whose folder holds its cwd on the same host. Sessions elsewhere stay unlinked.
 */
export function linkLiveSessions(
  sessions: readonly LiveSession[],
  worktrees: readonly LinkableWorktree[],
  worktreeIdByTabId: ReadonlyMap<string, string>,
  hostOf: (session: LiveSession) => string
): Map<string, LiveSessionLink> {
  const byId = new Map(worktrees.map((worktree) => [worktree.id, worktree]))
  const links = new Map<string, LiveSessionLink>()
  for (const session of sessions) {
    let found: LinkableWorktree | undefined
    for (const route of session.inputRoutes) {
      const separator = route.kind === 'seal-pane' ? route.paneKey.lastIndexOf(':') : -1
      if (route.kind === 'seal-pane' && separator > 0) {
        found = byId.get(worktreeIdByTabId.get(route.paneKey.slice(0, separator)) ?? '')
      }
    }
    const cwd = session.cwd
    if (!found && cwd) {
      const host = hostOf(session)
      found = worktrees
        .filter(
          (worktree) =>
            worktree.hostId === host &&
            (cwd === worktree.path || cwd.startsWith(`${worktree.path}/`))
        )
        .sort((a, b) => b.path.length - a.path.length)[0]
    }
    if (found) {
      links.set(session.id, { worktreeId: found.id, repoId: found.repoId, name: found.name })
    }
  }
  return links
}

export type LiveSessionsBadge = { count: number; status: LiveSessionStatus; sessionIds: string[] }

/** Per workspace and per project: how many live sessions it has and the most urgent status among them. */
export function liveSessionBadges(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>
): { byWorktree: Map<string, LiveSessionsBadge>; byProject: Map<string, LiveSessionsBadge> } {
  const byWorktree = new Map<string, LiveSession[]>()
  const byProject = new Map<string, LiveSession[]>()
  for (const session of sessions) {
    const link = links.get(session.id)
    if (!link || !isActiveLiveSession(session)) {
      continue
    }
    byWorktree.set(link.worktreeId, [...(byWorktree.get(link.worktreeId) ?? []), session])
    byProject.set(link.repoId, [...(byProject.get(link.repoId) ?? []), session])
  }
  const badge = (group: LiveSession[]): LiveSessionsBadge => ({
    count: group.length,
    status: topLiveSessionStatus(group.map((session) => session.status))!,
    sessionIds: group.map((session) => session.id)
  })
  return {
    byWorktree: new Map([...byWorktree].map(([id, group]) => [id, badge(group)])),
    byProject: new Map([...byProject].map(([id, group]) => [id, badge(group)]))
  }
}
