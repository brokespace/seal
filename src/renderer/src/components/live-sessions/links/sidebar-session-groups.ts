import {
  liveSessionFolderProject,
  sessionProjectNameKey
} from '../../../../../shared/live-sessions/live-session-project'
import type {
  LiveSession,
  LiveSessionProject
} from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionLink } from './live-session-links'
import { sessionsHeaderKey, UNASSIGNED_SESSION_GROUP } from '../workspace-rows/session-fold-keys'
import type { SessionProjectCatalog } from './session-project-catalog'

/** The header the sessions bring to the list: the one for sessions under no listed project. */
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
  /** The headers among those that the list has not got itself: only the one for no project. */
  sessionHeaders: readonly SessionsHeader[]
  /** Projects sessions name that no project is yet, one per name, with those sessions: Seal makes each a project. */
  unknownProjects: readonly UnknownSessionProject[]
}

export type UnknownSessionProject = {
  project: LiveSessionProject
  sessions: readonly LiveSession[]
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
 * headers the list has now; a session whose project has none listed (hidden, filtered out, or not
 * made yet) sits under the header for no project, so every project header is a project's own.
 */
export function groupSidebarSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>,
  catalog: SessionProjectCatalog,
  listedHeaders: ReadonlySet<string>
): SidebarSessionGroups {
  const byWorkspace = new Map<string, LiveSession[]>()
  const byHeader = new Map<string, LiveSession[]>()
  const unknown = new Map<string, { project: LiveSessionProject; sessions: LiveSession[] }>()
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
    if (own && !project) {
      const nameKey = sessionProjectNameKey(own.name)
      const named = unknown.get(nameKey)
      if (named) {
        named.sessions.push(session)
      } else {
        unknown.set(nameKey, { project: own, sessions: [session] })
      }
    }
    const headerKey =
      project && listedHeaders.has(project.headerKey) ? project.headerKey : unassignedKey
    add(byHeader, headerKey, session)
    places.set(session.id, { kind: 'header', headerKey })
  }
  return {
    places,
    byWorkspace,
    byHeader,
    sessionHeaders: byHeader.has(unassignedKey) ? [{ key: unassignedKey, name: null }] : [],
    unknownProjects: [...unknown.values()]
  }
}
