import { useRef } from 'react'
import { useAppStore } from '@/store'
import {
  getRuntimeGitHistory,
  getRuntimeGitStatus
} from '@/runtime/source-control/git/runtime-git-status-client'
import { resolveDeleteTargetGitContext } from '@/components/sidebar/workspace-actions/deletion/use-delete-worktree-status-hydration'
import type { GitHistoryItem } from '../../../../shared/git/history/git-history-types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { summarizeGitChanges, type GitChangeSummary } from './project-overview-model'
import { useProjectOverviewLoad, type ProjectOverviewLoad } from './use-project-overview-load'

/** Reading every checkout of a large project would queue a long line of `git status` calls. */
export const PROJECT_CHANGES_MAX_WORKTREES = 12
export const PROJECT_RECENT_COMMITS = 8

/** A `git status` per workspace is cheap next to an agent's own work, and edits show within a few seconds. */
const PROJECT_CHANGES_LIVE_MS = 5_000

export type ProjectChangeReading = {
  summary: GitChangeSummary
  readAt: number
  /** When git last failed to answer since `readAt`; null while the summary is the current answer. */
  failedAt: number | null
}

/** Null for a workspace git has not answered for yet: its machine is not reachable, or git fails. */
export type ProjectChangeSummaries = ReadonlyMap<string, ProjectChangeReading | null>

async function readGitChanges(
  worktree: Worktree,
  repos: readonly Repo[],
  signal: AbortSignal
): Promise<GitChangeSummary | null> {
  const context = resolveDeleteTargetGitContext(worktree, repos)
  if (!context) {
    return null
  }
  try {
    const status = await getRuntimeGitStatus(context, { admissionTier: 'background', signal })
    return status.readError ? null : summarizeGitChanges(status)
  } catch {
    return null
  }
}

/** `git status` of the project's workspaces, each read on the machine that holds it, kept live. */
export function useProjectGitChanges(
  worktrees: readonly Worktree[]
): ProjectOverviewLoad<ProjectChangeSummaries> {
  const targets = worktrees.slice(0, PROJECT_CHANGES_MAX_WORKTREES)
  // A read that fails (a rebase holding the index, a machine that dropped off) is no reason to
  // forget what the workspace last said: the row keeps it and says how old it is.
  const lastGood = useRef(new Map<string, ProjectChangeReading>())
  // Keyed by which workspaces, not their order or head: the repeat picks up a commit, and a list
  // that is re-sorted or gains a workspace keeps the rows it has already read.
  return useProjectOverviewLoad(
    targets.map(getWorktreeHostIdentity).sort().join('\n'),
    async (signal) => {
      const repos = useAppStore.getState().repos
      const kept = lastGood.current
      const entries = await Promise.all(
        targets.map(async (worktree): Promise<[string, ProjectChangeReading | null]> => {
          const summary = await readGitChanges(worktree, repos, signal)
          if (summary) {
            const reading = { summary, readAt: Date.now(), failedAt: null }
            kept.set(worktree.id, reading)
            return [worktree.id, reading]
          }
          const last = kept.get(worktree.id)
          return [worktree.id, last ? { ...last, failedAt: Date.now() } : null]
        })
      )
      return new Map(entries)
    },
    { liveMs: PROJECT_CHANGES_LIVE_MS, keepLast: true }
  )
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
