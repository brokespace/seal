import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import { selectFolderWorkspaces } from '@/store/workspaces/catalog/workspace-record-fields'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import { getProjectGroupHeaderKey } from '../../../../../shared/sidebar-list/sections/group-keys'
import { useSidebarSessionGroups } from './use-workspace-sessions'

const NO_GROUPS: readonly ProjectGroup[] = []

/** A project Seal made for sessions that the user has not made permanent. */
export function isAutoProjectGroup(
  group: Pick<ProjectGroup, 'sessionProject' | 'keptAt'>
): boolean {
  return group.sessionProject !== undefined && group.keptAt === undefined
}

/**
 * Drops each auto project no agent runs in and none of the user's projects or folders sit in:
 * one lists only while it is in use. The same array while none is dropped.
 */
export function withoutIdleAutoProjects<G extends ProjectGroup>(
  groups: readonly G[],
  runningHeaders: ReadonlySet<string>,
  occupiedGroupIds: ReadonlySet<string>
): readonly G[] {
  const idle = (group: G): boolean =>
    isAutoProjectGroup(group) &&
    !occupiedGroupIds.has(group.id) &&
    !runningHeaders.has(getProjectGroupHeaderKey(group.id))
  return groups.some(idle) ? groups.filter((group) => !idle(group)) : groups
}

/** The project groups the sidebar lists: every one but an auto project nothing is in now. */
export function useListedProjectGroups(): readonly ProjectGroup[] {
  const projectGroups = useAppStore((state) => state.projectGroups ?? NO_GROUPS)
  const repos = useAppStore((state) => state.repos)
  const folderWorkspaces = useAppStore((state) => selectFolderWorkspaces(state))
  // Why by name: sessions change far more often than which projects have a running one.
  const running = [...useSidebarSessionGroups().runningByHeader.keys()].sort().join('\n')
  return useMemo(() => {
    const occupied = new Set<string>()
    for (const { projectGroupId } of [...repos, ...folderWorkspaces]) {
      if (projectGroupId) {
        occupied.add(projectGroupId)
      }
    }
    return withoutIdleAutoProjects(projectGroups, new Set(running.split('\n')), occupied)
  }, [projectGroups, repos, folderWorkspaces, running])
}
