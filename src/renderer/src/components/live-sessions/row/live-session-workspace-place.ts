import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import {
  liveSessionPlaceOf,
  type LiveSessionPlace
} from '../../../../../shared/live-sessions/live-session-workspace-groups'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { LiveSessionLink } from '../links/live-session-links'
import { useLiveSessionLinks } from '../links/use-live-session-links'

/** A workspace this window knows, as the sidebar names it and its project. */
export type KnownSessionWorkspace = {
  projectKey: string
  project: string | null
  workspace: string
}

/**
 * Where a session is listed on the desktop: the workspace its registry linked it to, else the one
 * this window links it to, under the names the sidebar shows. A workspace this window does not
 * know keeps the record's own place.
 */
export function liveSessionPlaceResolver(
  links: ReadonlyMap<string, Pick<LiveSessionLink, 'worktreeId'>>,
  workspaces: ReadonlyMap<string, KnownSessionWorkspace>
): (session: LiveSession) => LiveSessionPlace {
  return (session) => {
    const worktreeId = session.workspace?.worktreeId ?? links.get(session.id)?.worktreeId
    const known = worktreeId === undefined ? undefined : workspaces.get(worktreeId)
    if (worktreeId === undefined || !known) {
      return liveSessionPlaceOf(session)
    }
    return {
      // This window's project id, so a session the registry linked sits with one linked here.
      ...liveSessionPlaceOf({
        ...session,
        workspace: { worktreeId, projectKey: known.projectKey }
      }),
      project: known.project,
      workspace: known.workspace
    }
  }
}

/** Every workspace in the catalogue by id: git worktrees under their project, folders under their group. */
export function knownSessionWorkspaces(
  state: Pick<AppState, 'repos' | 'projectGroups' | 'worktreesByRepo' | 'folderWorkspaces'>
): Map<string, KnownSessionWorkspace> {
  const projects = new Map(state.repos.map((repo) => [repo.id, repo.displayName]))
  const groups = new Map(state.projectGroups.map((group) => [group.id, group.name]))
  const known = new Map<string, KnownSessionWorkspace>()
  for (const worktree of getIndexedWorktreeMap(selectWorktreesByRepo(state) ?? {}).values()) {
    known.set(worktree.id, {
      projectKey: worktree.repoId,
      project: projects.get(worktree.repoId) ?? null,
      workspace: worktree.displayName
    })
  }
  for (const folder of selectFolderWorkspaces(state) ?? []) {
    known.set(folderWorkspaceKey(folder.id), {
      projectKey: folder.projectGroupId,
      project: groups.get(folder.projectGroupId) ?? null,
      workspace: folder.name
    })
  }
  return known
}

/** `liveSessionPlaceResolver` over this window's links and catalogue. */
export function useLiveSessionPlaceOf(): (session: LiveSession) => LiveSessionPlace {
  const { links } = useLiveSessionLinks()
  const repos = useAppStore((state) => state.repos)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const folderWorkspaces = useAppStore(selectFolderWorkspaces)
  return useMemo(
    () =>
      liveSessionPlaceResolver(
        links,
        knownSessionWorkspaces({ repos, projectGroups, worktreesByRepo, folderWorkspaces })
      ),
    [links, repos, projectGroups, worktreesByRepo, folderWorkspaces]
  )
}
