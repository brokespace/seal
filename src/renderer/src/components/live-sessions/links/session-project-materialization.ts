import { useEffect } from 'react'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { useAppStore } from '@/store/index'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSessionProject } from '../../../../../shared/live-sessions/live-session-types'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import { getProjectGroupHeaderKey } from '../../../../../shared/sidebar-list/sections/group-keys'
import { isAutoProjectGroup } from './auto-project-listing'
import type { SidebarSessionGroups } from './sidebar-session-groups'
import { readSidebarSessionGroups, useSidebarSessionGroups } from './use-workspace-sessions'

// Why wait: other hosts' projects load after the sessions do; one of theirs is no new project.
const SETTLE_MS = 10_000

/** The projects a running agent names that no project is yet, with when the newest of those started. */
function projectsToMake({
  unknownProjects
}: Pick<SidebarSessionGroups, 'unknownProjects'>): (LiveSessionProject & { startedAt: number })[] {
  return unknownProjects.flatMap(({ project, sessions }) => {
    const running = sessions.filter(isActiveLiveSession)
    return running.length > 0
      ? [{ ...project, startedAt: Math.max(...running.map((s) => s.startedAt ?? 0)) }]
      : []
  })
}

/** Auto projects the user hid that an agent started in since: hiding one lasts until then. */
function autoProjectsToShow(
  projectGroups: readonly ProjectGroup[],
  { runningByHeader }: Pick<SidebarSessionGroups, 'runningByHeader'>
): ProjectGroup[] {
  return projectGroups.filter(
    (group) =>
      isAutoProjectGroup(group) &&
      group.hiddenAt !== undefined &&
      (runningByHeader.get(getProjectGroupHeaderKey(group.id))?.startedAt ?? 0) > group.hiddenAt
  )
}

/**
 * Makes each project a running agent names a real project once the catalogs settle, so its header
 * has every project action, and shows again an auto project the user hid once an agent starts in
 * it. The main process makes each once and skips one the user removed before its agent started.
 */
export function useSessionProjectMaterialization(): void {
  const groups = useSidebarSessionGroups()
  const projectGroups = useAppStore((state) => state.projectGroups)
  const names = projectsToMake(groups)
    .map(({ name }) => name)
    .sort()
    .join('\n')
  const shown = autoProjectsToShow(projectGroups, groups)
    .map(({ id }) => id)
    .join('\n')
  useEffect(() => {
    // A paired web client lists its host's projects; that host shows and makes them.
    if (!shown || isPairedWebClientWindow()) {
      return
    }
    const { projectGroups: current, updateProjectGroup } = useAppStore.getState()
    for (const group of autoProjectsToShow(current, readSidebarSessionGroups())) {
      void updateProjectGroup(
        group.id,
        { hiddenAt: null },
        { hostId: getRepoExecutionHostId(group) }
      ).catch((error: unknown) => console.error('Failed to show an auto project:', error))
    }
  }, [shown])
  useEffect(() => {
    if (!names || isPairedWebClientWindow()) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        await useAppStore.getState().awaitLocalRepoCatalogSettlement()
        const projects = projectsToMake(readSidebarSessionGroups())
        if (cancelled || projects.length === 0) {
          return
        }
        await window.api.projectGroups.ensureSessionProjects({ projects })
      })().catch((error: unknown) => console.error('Failed to make session projects:', error))
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [names])
}
