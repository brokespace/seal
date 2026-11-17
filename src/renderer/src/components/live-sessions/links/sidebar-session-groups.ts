import { liveSessionFolderProject } from '../../../../../shared/live-sessions/live-session-project'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionLink } from './live-session-links'
import { UNASSIGNED_SESSION_GROUP } from '../workspace-rows/session-fold-keys'
import { sessionProjectNameKey, type SessionProjectCatalog } from './session-project-catalog'

/** A project the sidebar list has no header for, named by its sessions' folder or by the user. */
export type LooseSessionProject = { key: string; name: string; sessions: LiveSession[] }

/** Where the sidebar lists a session: a workspace's card, or a group named as its folds are keyed. */
export type SidebarSessionPlace =
  | { kind: 'workspace'; worktreeId: string }
  | { kind: 'header'; headerKey: string; group: string }
  | { kind: 'group'; group: string }

export function headerSessionGroup(headerKey: string): string {
  return `header:${headerKey}`
}

export function looseSessionGroup(projectNameKey: string): string {
  return `project:${projectNameKey}`
}

export type SidebarSessionGroups = {
  places: ReadonlyMap<string, SidebarSessionPlace>
  byWorkspace: ReadonlyMap<string, readonly LiveSession[]>
  /** Sessions no workspace holds, under their project's header in the list, by that header's key. */
  byHeader: ReadonlyMap<string, readonly LiveSession[]>
  /** Sessions of projects the list draws no header for, by name. */
  loose: readonly LooseSessionProject[]
  /** Sessions with no folder to name a project by. */
  unassigned: readonly LiveSession[]
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
 * headers the list has now; a project without one is listed after the list.
 */
export function groupSidebarSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>,
  catalog: SessionProjectCatalog,
  listedHeaders: ReadonlySet<string>
): SidebarSessionGroups {
  const byWorkspace = new Map<string, LiveSession[]>()
  const byHeader = new Map<string, LiveSession[]>()
  const loose = new Map<string, LooseSessionProject>()
  const unassigned: LiveSession[] = []
  const places = new Map<string, SidebarSessionPlace>()
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
    const named = moved ?? liveSessionFolderProject(session)
    if (!named) {
      unassigned.push(session)
      places.set(session.id, { kind: 'group', group: UNASSIGNED_SESSION_GROUP })
      continue
    }
    const project = movedTo ?? catalog.find(named)
    if (project && listedHeaders.has(project.headerKey)) {
      add(byHeader, project.headerKey, session)
      places.set(session.id, {
        kind: 'header',
        headerKey: project.headerKey,
        group: headerSessionGroup(project.headerKey)
      })
      continue
    }
    const name = project?.name ?? named.name
    const key = sessionProjectNameKey(name)
    places.set(session.id, { kind: 'group', group: looseSessionGroup(key) })
    const group = loose.get(key)
    if (group) {
      group.sessions.push(session)
    } else {
      loose.set(key, { key, name, sessions: [session] })
    }
  }
  return {
    places,
    byWorkspace,
    byHeader,
    loose: [...loose.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unassigned
  }
}
