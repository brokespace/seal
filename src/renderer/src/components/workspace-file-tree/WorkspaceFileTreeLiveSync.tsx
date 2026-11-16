import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SourceControlScope } from '@/components/right-sidebar/source-control/panel/worktree-scope'
import { useWorktreeGitStatusObservation } from '@/components/right-sidebar/source-control/sync/use-worktree-git-status-observation'
import { getSidebarWatchConsumer, resolveWatchTargets } from '@/hooks/editor-external-watch-targets'
import { useSourceControlWatchConsumer } from '@/hooks/source-control-watch-consumers'
import {
  ORCA_WORKTREE_FILE_CHANGE_EVENT,
  type WorktreeFileChangeEventDetail
} from '@/hooks/worktree-file-change-event'
import { resolveReviewRepository } from '@/lib/source-control/review/review-owner'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { useWorktreeById } from '@/store/workspaces/selection/use-selected-worktree'
import type { ExecutionHostId } from '../../../../shared/execution-host'

type LiveSyncProps = {
  worktreeId: string
  /** The split-view pane's host for the workspace; null follows the selection. */
  executionHostId: ExecutionHostId | null
}

function selectWatchRoot(state: AppState, worktreeId: string, hostId: ExecutionHostId | null) {
  // Why a view: the sidebar's consumer reads the selected host; an unfocused pane names its own.
  const view =
    hostId && hostId !== state.activeWorkspaceExecutionHostId
      ? { ...state, activeWorkspaceExecutionHostId: hostId }
      : state
  const consumer = getSidebarWatchConsumer(view, worktreeId)
  const [target] = resolveWatchTargets(
    state,
    new Map([[worktreeId, new Map([['', consumer]])]])
  ).values()
  return target
    ? {
        worktreePath: target.worktreePath,
        connectionId: target.connectionId,
        runtimeEnvironmentId: target.runtimeEnvironmentId
      }
    : null
}

/** The app watches a workspace's files only for the right sidebar and open tabs; an open tree asks too. */
function useFileTreeWatch({ worktreeId, executionHostId }: LiveSyncProps): void {
  const root = useAppStore(
    useShallow((state) => selectWatchRoot(state, worktreeId, executionHostId))
  )
  useSourceControlWatchConsumer(
    `workspace-file-tree::${executionHostId ?? ''}::${worktreeId}`,
    root ? { worktreeId, ...root } : null
  )
  const path = root?.worktreePath
  const connectionId = root?.connectionId
  const clientWatched = root?.runtimeEnvironmentId === null
  useEffect(() => {
    // Why only here: a runtime watch resyncs on install, and an unselected workspace's observation fetches on mount.
    if (!path || !clientWatched || useAppStore.getState().activeWorktreeId !== worktreeId) {
      return
    }
    // Edits made while nothing watched the workspace left its git marks stale; an overflow re-reads status.
    window.dispatchEvent(
      new CustomEvent<WorktreeFileChangeEventDetail>(ORCA_WORKTREE_FILE_CHANGE_EVENT, {
        detail: {
          payload: {
            worktreePath: path,
            events: [{ kind: 'overflow', absolutePath: path }],
            ...(connectionId ? { connectionId } : {})
          },
          runtimeEnvironmentId: null
        }
      })
    )
  }, [worktreeId, path, connectionId, clientWatched])
}

/** The scope of a workspace the app's own git polling skips: every one but the selected. */
function useUnselectedGitScope({
  worktreeId,
  executionHostId
}: LiveSyncProps): SourceControlScope | null {
  const selected = useAppStore((state) => state.activeWorktreeId === worktreeId)
  const worktree = useWorktreeById(selected ? null : worktreeId, executionHostId ?? undefined)
  const repos = useAppStore((state) => state.repos)
  const knownHostId = useAppStore((state) => getExecutionHostIdForWorktree(state, worktreeId))
  return useMemo(() => {
    const repo = worktree ? resolveReviewRepository(repos, worktree) : null
    return worktree && repo
      ? {
          worktreeId,
          repoId: worktree.repoId,
          executionHostId: worktree.hostId ?? executionHostId ?? knownHostId,
          worktree,
          attachedAt: 0,
          repo,
          placementWorkspaceId: worktreeId
        }
      : null
  }, [worktree, repos, worktreeId, executionHostId, knownHostId])
}

function GitStatusObservation({ scope }: { scope: SourceControlScope }): null {
  useWorktreeGitStatusObservation(scope, { enabled: true })
  return null
}

/**
 * Rendered beside an open tree: keeps its listing and git marks current while the right sidebar,
 * whose views drive the app's file watch and git polling, is closed or on another workspace.
 */
export function WorkspaceFileTreeLiveSync(props: LiveSyncProps): React.JSX.Element | null {
  useFileTreeWatch(props)
  const scope = useUnselectedGitScope(props)
  return scope ? <GitStatusObservation scope={scope} /> : null
}
