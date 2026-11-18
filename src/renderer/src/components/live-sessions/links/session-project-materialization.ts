import { useEffect } from 'react'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { useAppStore } from '@/store/index'
import type { LiveSessionProject } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { isListedLiveSession } from '../row/live-session-machine-listing'
import type { SidebarSessionGroups } from './sidebar-session-groups'
import { readSidebarSessionGroups, useSidebarSessionGroups } from './use-workspace-sessions'

// Why wait: other hosts' projects load after the sessions do; one of theirs is no new project.
const SETTLE_MS = 10_000

/** The projects a listed session names that no project is yet. */
function projectsToMake(
  { unknownProjects }: Pick<SidebarSessionGroups, 'unknownProjects'>,
  now: number
): LiveSessionProject[] {
  return unknownProjects
    .filter(({ sessions }) => sessions.some((session) => isListedLiveSession(session, now)))
    .map(({ project }) => project)
}

/**
 * Makes each project the sidebar's sessions name a real project once the catalogs settle, so its
 * header has every project action. The main process makes each once and skips ones the user removed.
 */
export function useSessionProjectMaterialization(): void {
  const groups = useSidebarSessionGroups()
  const now = useLiveSessionClock()
  const names = projectsToMake(groups, now)
    .map(({ name }) => name)
    .sort()
    .join('\n')
  useEffect(() => {
    // A paired web client lists its host's projects; that host makes them.
    if (!names || isPairedWebClientWindow()) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        await useAppStore.getState().awaitLocalRepoCatalogSettlement()
        const projects = projectsToMake(readSidebarSessionGroups(), Date.now())
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
