import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import {
  isActiveLiveSession,
  topLiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-status'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'
import { worktreeIdentityKey } from '../../../../../shared/worktree/id'

/** The workspace a session runs in, when Seal knows one. */
export type LiveSessionLink = { worktreeId: string; repoId: string; name: string }

/** Finds a registry workspace id among the workspaces this window lists, under this window's id for it. */
export function workspaceLinkFinder(
  state: Pick<AppState, 'repos' | 'worktreesByRepo' | 'folderWorkspaces'>
): (worktreeId: string) => LiveSessionLink | undefined {
  const projectNames = new Map(state.repos.map((repo) => [repo.id, repo.displayName]))
  const links = [...getIndexedWorktreeMap(selectWorktreesByRepo(state) ?? {}).values()].map(
    (worktree): LiveSessionLink => {
      const project = projectNames.get(worktree.repoId)
      return {
        worktreeId: worktree.id,
        repoId: worktree.repoId,
        // "shop / checkout"; a primary checkout named for its branch alone says little.
        name:
          project && project !== worktree.displayName
            ? `${project} / ${worktree.displayName}`
            : worktree.displayName
      }
    }
  )
  // Folder workspaces hold sessions too; they have no git worktree behind them.
  for (const folder of selectFolderWorkspaces(state) ?? []) {
    links.push({
      worktreeId: folderWorkspaceKey(folder.id),
      repoId: folder.projectGroupId,
      name: folder.name
    })
  }
  const byId = new Map(links.map((link) => [link.worktreeId, link]))
  // The registry may spell a checkout's path differently than this window's row does.
  const byIdentity = new Map(links.map((link) => [worktreeIdentityKey(link.worktreeId), link]))
  return (worktreeId) => byId.get(worktreeId) ?? byIdentity.get(worktreeIdentityKey(worktreeId))
}

export type LiveSessionsBadge = { count: number; status: LiveSessionStatus; sessionIds: string[] }

/** Per project: how many live sessions it has and the most urgent status among them. */
export function projectSessionBadges(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>
): Map<string, LiveSessionsBadge> {
  const byProject = new Map<string, LiveSession[]>()
  for (const session of sessions) {
    const link = links.get(session.id)
    if (!link || !isActiveLiveSession(session)) {
      continue
    }
    byProject.set(link.repoId, [...(byProject.get(link.repoId) ?? []), session])
  }
  return new Map(
    [...byProject].map(([id, group]) => [
      id,
      {
        count: group.length,
        status: topLiveSessionStatus(group.map((session) => session.status))!,
        sessionIds: group.map((session) => session.id)
      }
    ])
  )
}
