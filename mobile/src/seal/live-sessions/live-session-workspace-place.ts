import {
  liveSessionPlaceOf,
  type LiveSessionPlace
} from '../../../../src/shared/live-sessions/live-session-workspace-groups'
import {
  HOST_LIST_TARGET,
  hostWorktreeCatalogQuery,
  NO_HOST_LIST_INPUT
} from '../../host-screen/catalog/host-list-queries'
import { useHostQuery } from '../../query/host-query'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { Worktree } from '../../worktree/workspace-list-types'
import { getLiveWorktreeDisplayName } from '../../worktree/worktree-display-name'
import type { LiveSession } from './live-session-schemas'

export type KnownSessionWorkspace = Pick<Worktree, 'worktreeId' | 'repo' | 'displayName' | 'path'>

const NO_WORKSPACES: readonly KnownSessionWorkspace[] = []

/** The workspaces the host list reads: what names a session's place and finds its chat's workspace. */
export function useKnownSessionWorkspaces(
  hostId: string,
  client: RpcClient | null,
  connected: boolean
): readonly KnownSessionWorkspace[] {
  const { data } = useHostQuery(
    hostWorktreeCatalogQuery,
    { hostId, client: connected ? client : null },
    HOST_LIST_TARGET,
    NO_HOST_LIST_INPUT
  )
  return data?.worktrees ?? NO_WORKSPACES
}

/** The workspace a session runs in: the one its registry linked, else the one checked out at its folder. */
export function liveSessionWorktreeId(
  session: Pick<LiveSession, 'workspace' | 'cwd'>,
  workspaces: readonly KnownSessionWorkspace[]
): string | null {
  if (session.workspace) {
    return session.workspace.worktreeId
  }
  const { cwd } = session
  return (cwd && workspaces.find((workspace) => workspace.path === cwd)?.worktreeId) || null
}

/**
 * Where a session is listed on the phone: a workspace its registry linked it to goes by the names
 * the host list shows. A record without a link, or to a workspace this phone has not read, keeps
 * its own place.
 */
export function liveSessionPlaceResolver(
  workspaces: readonly KnownSessionWorkspace[]
): (session: LiveSession) => LiveSessionPlace {
  const known = new Map(workspaces.map((workspace) => [workspace.worktreeId, workspace]))
  return (session) => {
    const place = liveSessionPlaceOf(session)
    const workspace = session.workspace ? known.get(session.workspace.worktreeId) : undefined
    if (!workspace) {
      return place
    }
    return {
      ...place,
      project: workspace.repo || place.project,
      workspace: getLiveWorktreeDisplayName(workspaces, workspace.worktreeId) ?? place.workspace
    }
  }
}
