import { useMemo } from 'react'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../src/shared/execution-host'
import {
  compareLiveSessions,
  isActiveLiveSession
} from '../../../../src/shared/live-sessions/live-session-status'
import type { LiveSession } from '../../seal/live-sessions/live-session-schemas'
import { useLiveSessionsFeed } from '../../seal/live-sessions/live-sessions-feed'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { getWorktreeRowIdentity } from '../../worktree/worktree-host-row-identity'
import type { Worktree } from '../../worktree/workspace-list-types'

type SessionRow = Pick<Worktree, 'worktreeId' | 'hostId' | 'path'>

const NO_SESSIONS: ReadonlyMap<string, readonly LiveSession[]> = new Map()

function placeKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

/**
 * Each listed workspace's running sessions, as the desktop card lists them: the workspace the
 * registry linked, else the one at the session's folder on its machine. Seal panes are left out;
 * the row's agents already show them.
 */
export function hostWorkspaceSessions(
  sessions: readonly LiveSession[],
  rows: readonly SessionRow[]
): ReadonlyMap<string, readonly LiveSession[]> {
  const byPlace = new Map<string, string>()
  const byFolder = new Map<string, string>()
  for (const row of rows) {
    const host = row.hostId ?? LOCAL_EXECUTION_HOST_ID
    const identity = getWorktreeRowIdentity(row)
    byPlace.set(placeKey(host, row.worktreeId), identity)
    if (row.path) {
      byFolder.set(placeKey(host, row.path), identity)
    }
  }
  const listed = new Map<string, LiveSession[]>()
  for (const session of sessions) {
    if (session.surface?.kind === 'cli' || !isActiveLiveSession(session)) {
      continue
    }
    const host = session.machine.executionHostId ?? LOCAL_EXECUTION_HOST_ID
    const identity = session.workspace
      ? byPlace.get(placeKey(host, session.workspace.worktreeId))
      : session.cwd
        ? byFolder.get(placeKey(host, session.cwd))
        : undefined
    if (identity) {
      listed.set(identity, [...(listed.get(identity) ?? []), session])
    }
  }
  for (const rowSessions of listed.values()) {
    rowSessions.sort(compareLiveSessions)
  }
  return listed
}

/** The host's registry sessions keyed by the row identity of the workspace each runs in. */
export function useHostWorkspaceSessions(
  client: RpcClient | null,
  rows: readonly SessionRow[]
): ReadonlyMap<string, readonly LiveSession[]> {
  const { sessions } = useLiveSessionsFeed(client)
  return useMemo(
    () => (sessions.length === 0 ? NO_SESSIONS : hostWorkspaceSessions(sessions, rows)),
    [sessions, rows]
  )
}
