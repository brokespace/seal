import {
  folderProjectKey,
  liveSessionFolderProject
} from '../../../../../shared/live-sessions/live-session-project'
import type {
  LiveSession,
  LiveSessionProject
} from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionLink } from './live-session-links'
import { sessionProjectNameKey, type SessionProjectCatalog } from './session-project-catalog'
import type { LooseSessionProject } from './sidebar-session-groups'
import { useLiveSessionLinks } from './use-live-session-links'
import { useSessionProjectCatalog, useSidebarSessionGroups } from './use-workspace-sessions'

export type SessionProjectChoice = LiveSessionProject & {
  /** The session is listed under it now. */
  current: boolean
}

export type SessionProjectChoices = {
  /** Every project a session can move to, by name. */
  choices: readonly SessionProjectChoice[]
  /** The user moved it; it can go back to the project its folder or workspace gives it. */
  moved: boolean
}

/** A project by a name the user typed: the sidebar's project of that name, else one named by it alone. */
export function sessionProjectNamed(
  name: string,
  catalog: SessionProjectCatalog
): LiveSessionProject {
  const trimmed = name.trim()
  const known = catalog.find({ key: folderProjectKey(trimmed), name: trimmed })
  return known
    ? { key: known.key, name: known.name }
    : { key: folderProjectKey(trimmed), name: trimmed }
}

export function sessionProjectChoices(
  session: LiveSession,
  link: LiveSessionLink | undefined,
  catalog: SessionProjectCatalog,
  loose: readonly LooseSessionProject[]
): SessionProjectChoices {
  const moved = session.assignedProject
  const named = moved ?? (link ? undefined : liveSessionFolderProject(session))
  const listed = named ? catalog.find(named) : link && catalog.ofWorkspace(link.repoId)
  const currentName = sessionProjectNameKey(listed?.name ?? named?.name ?? '')
  const byName = new Map<string, LiveSessionProject>()
  for (const project of [
    ...catalog.projects,
    ...loose.map(({ name }) => ({ key: folderProjectKey(name), name }))
  ]) {
    const nameKey = sessionProjectNameKey(project.name)
    if (!byName.has(nameKey)) {
      byName.set(nameKey, { key: project.key, name: project.name })
    }
  }
  return {
    choices: [...byName]
      .map(([nameKey, project]) => ({ ...project, current: nameKey === currentName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    moved: moved !== undefined
  }
}

/** The projects a session's menu offers to move it to. */
export function useSessionProjectChoices(session: LiveSession): SessionProjectChoices {
  const { links } = useLiveSessionLinks()
  const catalog = useSessionProjectCatalog()
  const { loose } = useSidebarSessionGroups()
  return sessionProjectChoices(session, links.get(session.id), catalog, loose)
}
