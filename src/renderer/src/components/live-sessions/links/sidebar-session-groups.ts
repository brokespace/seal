import { liveSessionFolderProject } from '../../../../../shared/live-sessions/live-session-project'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionLink } from './live-session-links'
import { sessionsHeaderKey, UNASSIGNED_SESSION_GROUP } from '../workspace-rows/session-fold-keys'
import { sessionProjectNameKey, type SessionProjectCatalog } from './session-project-catalog'

/** A header the sessions bring to the list: a project it has none for, named by their folder or by the user, or none at all. */
export type SessionsHeader = { key: string; name: string | null }

/** Where the sidebar lists a session: on a workspace's card, or under a header of the list. */
export type SidebarSessionPlace =
  | { kind: 'workspace'; worktreeId: string }
  | { kind: 'header'; headerKey: string }

export type SidebarSessionGroups = {
  places: ReadonlyMap<string, SidebarSessionPlace>
  byWorkspace: ReadonlyMap<string, readonly LiveSession[]>
  /** Sessions no workspace holds, by the key of the header they sit under. */
  byHeader: ReadonlyMap<string, readonly LiveSession[]>
  /** The headers among those that the list has not got itself: projects by name, then the one for no project. */
  sessionHeaders: readonly SessionsHeader[]
}

function add<K>(groups: Map<K, LiveSession[]>, key: K, session: LiveSession): void {
  const group = groups.get(key)
  if (group) {
    group.push(session)
  } else {
    groups.set(key, [session])
  }
}

/**
 * Where the sidebar lists each session: under the project the user moved it to, else on its
 * workspace's card, else under the project its folder gives it. `listedHeaders` are the project
 * headers the list has now; a project without one gets a header after the last workspace.
 */
export function groupSidebarSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>,
  catalog: SessionProjectCatalog,
  listedHeaders: ReadonlySet<string>
): SidebarSessionGroups {
  const byWorkspace = new Map<string, LiveSession[]>()
  const byHeader = new Map<string, LiveSession[]>()
  const named = new Map<string, string>()
  const places = new Map<string, SidebarSessionPlace>()
  const unassignedKey = sessionsHeaderKey(UNASSIGNED_SESSION_GROUP)
  for (const session of sessions) {
    const link = links.get(session.id)
    const moved = session.assignedProject
    const movedTo = moved && catalog.find(moved)
    // Moved to the project its workspace is already in, it stays on that workspace's card.
    if (link && (!moved || (movedTo && movedTo === catalog.ofWorkspace(link.repoId)))) {
      add(byWorkspace, link.worktreeId, session)
      places.set(session.id, { kind: 'workspace', worktreeId: link.worktreeId })
      continue
    }
    const own = moved ?? liveSessionFolderProject(session)
    const project = movedTo ?? (own && catalog.find(own))
    let headerKey = unassignedKey
    if (project && listedHeaders.has(project.headerKey)) {
      headerKey = project.headerKey
    } else if (own) {
      const name = project?.name ?? own.name
      headerKey = sessionsHeaderKey(`project:${sessionProjectNameKey(name)}`)
      if (!named.has(headerKey)) {
        named.set(headerKey, name)
      }
    }
    add(byHeader, headerKey, session)
    places.set(session.id, { kind: 'header', headerKey })
  }
  const sessionHeaders: SessionsHeader[] = [...named]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([key, name]) => ({ key, name }))
  if (byHeader.has(unassignedKey)) {
    sessionHeaders.push({ key: unassignedKey, name: null })
  }
  return { places, byWorkspace, byHeader, sessionHeaders }
}
