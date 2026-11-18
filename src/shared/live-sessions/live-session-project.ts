import type { LiveSession, LiveSessionProject } from './live-session-types'

const FOLDER_PROJECT_KEY_PREFIX = 'folder:'

/** One project per name: a folder or repository of that name on any machine is that project. */
export function sessionProjectNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** A project known by its name alone: the same folder or repository name is one project on every machine. */
export function folderProjectKey(name: string): string {
  return `${FOLDER_PROJECT_KEY_PREFIX}${name}`
}

/**
 * The project a session's folder gives it when no workspace holds it: its repository (the main
 * checkout's folder name, keyed by its remote when it has one), else the folder it runs in.
 * Null for a session with no folder.
 */
export function liveSessionFolderProject(
  session: Pick<LiveSession, 'cwd' | 'project' | 'repository'>
): LiveSessionProject | null {
  const name = session.repository?.name ?? session.project ?? session.cwd
  if (!name) {
    return null
  }
  return { key: session.repository?.projectKey ?? folderProjectKey(name), name }
}
