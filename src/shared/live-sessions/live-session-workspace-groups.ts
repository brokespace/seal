import { folderProjectKey, liveSessionFolderProject } from './live-session-project'
import { compareListedLiveSessions } from './live-session-summary'
import type { LiveSession } from './live-session-types'

/** What grouping reads; mobile's decoded sessions satisfy it too. */
export type WorkspaceGroupableLiveSession = Pick<
  LiveSession,
  'status' | 'lastActivityAt' | 'cwd' | 'project' | 'repository'
> & {
  pinned?: boolean
  machine: { hostId: string; label: string }
  workspace?: { worktreeId: string; projectKey: string; projectName?: string }
}

/** The project and workspace a session is listed under. A null name is one the client words itself. */
export type LiveSessionPlace = {
  projectKey: string
  project: string | null
  workspaceKey: string
  workspace: string | null
}

/**
 * A session's place from its record alone: the workspace its registry linked it to, named by its
 * folder. A record without a link (an older host, or a folder nothing could place) is listed
 * under the project that folder gives it.
 */
export function liveSessionPlaceOf(session: WorkspaceGroupableLiveSession): LiveSessionPlace {
  const folder = session.project ?? session.cwd
  if (session.workspace) {
    return {
      projectKey: session.workspace.projectKey,
      project: session.workspace.projectName ?? folder,
      // A checkout at the same path on two machines has one worktree id.
      workspaceKey: `${session.machine.hostId}\n${session.workspace.worktreeId}`,
      workspace: session.cwd
    }
  }
  const project = liveSessionFolderProject(session)
  return {
    projectKey: project?.key ?? folderProjectKey(''),
    project: project?.name ?? null,
    workspaceKey: `${session.machine.hostId}\n${session.cwd ?? ''}`,
    workspace: session.cwd
  }
}

/** `query` names the project a session is listed under: by its name in any letter case, or by its key. */
export function isLiveSessionPlaceInProject(place: LiveSessionPlace, query: string): boolean {
  return place.projectKey === query || place.project?.toLowerCase() === query.toLowerCase()
}

export type LiveSessionWorkspaceGroup<T extends WorkspaceGroupableLiveSession> = {
  key: string
  label: string | null
  /** A workspace is a folder on one machine: the badge its header and rows carry. */
  machine: T['machine']
  sessions: T[]
}

export type LiveSessionProjectGroup<T extends WorkspaceGroupableLiveSession> = {
  key: string
  label: string | null
  workspaces: LiveSessionWorkspaceGroup<T>[]
}

function byLabel(a: { label: string | null }, b: { label: string | null }): number {
  if (a.label === null || b.label === null) {
    return Number(a.label === null) - Number(b.label === null)
  }
  return a.label.localeCompare(b.label)
}

/**
 * Projects, each with its workspaces, each with its sessions in listed order: the grouping every
 * list of sessions shows. Projects and workspaces keep to their names, so a status change moves a
 * row within its workspace and nothing else.
 */
export function groupLiveSessionsByWorkspace<T extends WorkspaceGroupableLiveSession>(
  sessions: readonly T[],
  placeOf: (session: T) => LiveSessionPlace = liveSessionPlaceOf
): LiveSessionProjectGroup<T>[] {
  const projects = new Map<
    string,
    { label: string | null; workspaces: Map<string, LiveSessionWorkspaceGroup<T>> }
  >()
  for (const session of sessions) {
    const place = placeOf(session)
    let project = projects.get(place.projectKey)
    if (!project) {
      project = { label: place.project, workspaces: new Map() }
      projects.set(place.projectKey, project)
    }
    const workspace = project.workspaces.get(place.workspaceKey)
    if (workspace) {
      workspace.sessions.push(session)
    } else {
      project.workspaces.set(place.workspaceKey, {
        key: place.workspaceKey,
        label: place.workspace,
        machine: session.machine,
        sessions: [session]
      })
    }
  }
  return [...projects]
    .map(([key, project]) => ({
      key,
      label: project.label,
      workspaces: [...project.workspaces.values()]
        .map((workspace) => ({
          ...workspace,
          sessions: workspace.sessions.sort(compareListedLiveSessions)
        }))
        // Two machines' checkouts of one name keep their order whatever their sessions do.
        .sort((a, b) => byLabel(a, b) || a.machine.label.localeCompare(b.machine.label))
    }))
    .sort(byLabel)
}
