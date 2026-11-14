import { useAppStore } from '@/store'
import {
  getRuntimeGitHistory,
  getRuntimeGitStatus
} from '@/runtime/source-control/git/runtime-git-status-client'
import { resolveDeleteTargetGitContext } from '@/components/sidebar/workspace-actions/deletion/use-delete-worktree-status-hydration'
import type { GitHistoryItem } from '../../../../shared/git/history/git-history-types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../../shared/worktree/types'
import { summarizeGitChanges, type GitChangeSummary } from './project-overview-model'
import { useProjectOverviewLoad, type ProjectOverviewLoad } from './use-project-overview-load'

/** Reading every checkout of a large project would queue a long line of `git status` calls. */
export const PROJECT_CHANGES_MAX_WORKTREES = 12
export const PROJECT_RECENT_COMMITS = 8

/** Null for a workspace whose machine is not reachable right now. */
export type ProjectChangeSummaries = ReadonlyMap<string, GitChangeSummary | null>

/** `git status` of the project's workspaces, each read on the machine that holds it. */
export function useProjectGitChanges(
  worktrees: readonly Worktree[]
): ProjectOverviewLoad<ProjectChangeSummaries> & { reload: () => void } {
  const targets = worktrees.slice(0, PROJECT_CHANGES_MAX_WORKTREES)
  const key = targets.map((worktree) => `${getWorktreeHostIdentity(worktree)}@${worktree.head}`)
  return useProjectOverviewLoad(key.join('\n'), async (signal) => {
    const repos = useAppStore.getState().repos
    const entries = await Promise.all(
      targets.map(async (worktree): Promise<[string, GitChangeSummary | null]> => {
        const context = resolveDeleteTargetGitContext(worktree, repos)
        if (!context) {
          return [worktree.id, null]
        }
        try {
          const status = await getRuntimeGitStatus(context, { admissionTier: 'background', signal })
          return [worktree.id, status.readError ? null : summarizeGitChanges(status)]
        } catch {
          return [worktree.id, null]
        }
      })
    )
    return new Map(entries)
  })
}

/** The latest commits on a checkout: the project's code timeline. */
export function useProjectRecentCommits(
  worktree: Worktree | null
): ProjectOverviewLoad<GitHistoryItem[]> {
  const key = worktree ? `${getWorktreeHostIdentity(worktree)}@${worktree.head}` : null
  return useProjectOverviewLoad(key, async () => {
    const context = worktree
      ? resolveDeleteTargetGitContext(worktree, useAppStore.getState().repos)
      : null
    if (!context) {
      throw new Error('unreachable')
    }
    const history = await getRuntimeGitHistory(context, { limit: PROJECT_RECENT_COMMITS })
    return history.items
  })
}
