import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../../shared/cross-platform-path'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'

export type SessionWorkspace = NonNullable<LiveSession['workspace']>

/** A workspace a session can attach to: a git worktree or a folder workspace. */
export type LinkableWorkspace = SessionWorkspace & {
  /** The execution host that owns it. */
  hostId: string
  path: string
}

export type SessionPlace = {
  /** The execution host the session runs on. */
  hostId: string
  cwd: string | null
  /** The workspace holding the session's chat or terminal tab. */
  tabWorktreeId: string | null
}

/** What a machine says about a folder. */
export type FolderProbe =
  | {
      kind: 'repository'
      root: string
      /** The main checkout, when `root` is a linked worktree of it. */
      main?: string
      home: string | null
      tmp: string | null
    }
  | { kind: 'folder'; home: string | null; tmp: string | null }
  | { kind: 'unreadable' }

/** The workspace to make for a session no workspace holds. */
export type WorkspacePlan =
  | { kind: 'checkout'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'home'; path: string }
  | { kind: 'unassigned' }

const TEMP_ROOTS = [
  '/tmp',
  '/var/tmp',
  '/private/tmp',
  '/private/var/tmp',
  '/var/folders',
  '/private/var/folders'
]

function pathKey(path: string): string {
  return normalizeRuntimePathForComparison(path)
}

function isFilesystemRoot(key: string): boolean {
  return key === '/' || /^[a-z]:\/?$/i.test(key)
}

/** A home directory, a temp root or a filesystem root: a workspace there holds only sessions started right in it. */
export function isCatchAllFolder(path: string, home: string | null, tmp: string | null): boolean {
  const key = pathKey(path)
  return (
    isFilesystemRoot(key) ||
    [home, tmp, ...TEMP_ROOTS].some((root) => root !== null && pathKey(root) === key)
  )
}

/** Sessions here get no workspace of their own: they share the machine's home workspace. */
export function isSharedFolder(path: string, home: string | null, tmp: string | null): boolean {
  return (
    isCatchAllFolder(path, home, tmp) ||
    [tmp, ...TEMP_ROOTS].some((root) => root !== null && isPathInsideOrEqual(root, path))
  )
}

/**
 * The workspace a session belongs to among those Seal knows: the one its tab is in, else the one on
 * its machine whose folder is its cwd or the longest ancestor of it.
 */
export function workspaceForSession(
  place: SessionPlace,
  workspaces: readonly LinkableWorkspace[],
  home: string | null
): LinkableWorkspace | null {
  const held = place.tabWorktreeId
    ? workspaces.find((workspace) => workspace.worktreeId === place.tabWorktreeId)
    : undefined
  if (held || !place.cwd) {
    return held ?? null
  }
  const cwd = pathKey(place.cwd)
  let found: LinkableWorkspace | null = null
  for (const workspace of workspaces) {
    if (workspace.hostId !== place.hostId) {
      continue
    }
    const holds =
      pathKey(workspace.path) === cwd ||
      (!isCatchAllFolder(workspace.path, home, null) &&
        isPathInsideOrEqual(workspace.path, place.cwd))
    if (holds && (!found || workspace.path.length > found.path.length)) {
      found = workspace
    }
  }
  return found
}

/** What to make for a session in `cwd`, from what its machine said about that folder. */
export function planWorkspace(cwd: string, probe: FolderProbe): WorkspacePlan {
  if (probe.kind === 'unreadable') {
    return { kind: 'unassigned' }
  }
  if (probe.kind === 'repository') {
    return { kind: 'checkout', path: probe.main ?? probe.root }
  }
  if (isSharedFolder(cwd, probe.home, probe.tmp)) {
    return probe.home ? { kind: 'home', path: probe.home } : { kind: 'unassigned' }
  }
  return { kind: 'folder', path: cwd }
}
