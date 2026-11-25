import { useMemo } from 'react'
import { recomputeOn } from '@/lib/recompute-on'
import { useAppStore } from '@/store'
import { selectSidebarLineageParentIdentities } from '@/store/slices/worktrees/metadata/cross-store-lineage-parents'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorkspaceSortBy } from '../../../../shared/workspace-view/workspace-row-sort'
import { projectWorktrees, rankProjectWorktrees } from './project-overview-model'

/** The ranking as the store and the clock stand now, the snapshot the sidebar's own ranking takes. */
function rankFromStore(repo: Repo, repos: readonly Repo[], sortBy: WorkspaceSortBy): string[] {
  const state = useAppStore.getState()
  return rankProjectWorktrees(selectWorktreesByRepo(state)[repo.id], repo, repos, {
    sortBy,
    sources: state,
    now: Date.now()
  })
}

/** A registration's workspaces in the sidebar's order, re-ranked when the sidebar re-ranks. */
export function useProjectWorktrees(repo: Repo): Worktree[] {
  const repos = useAppStore((s) => s.repos)
  const repoWorktrees = useAppStore((s) => selectWorktreesByRepo(s)[repo.id])
  const sortBy = useAppStore((s) => s.sortBy)
  const settledSortEpoch = useAppStore((s) => s.settledSortEpoch)
  const sortOrderEpoch = useAppStore((s) => s.sortOrderEpoch)
  const lineageById = useAppStore((s) => s.worktreeLineageById)
  const lineageParents = useAppStore(selectSidebarLineageParentIdentities)

  // The sidebar holds its ranking between these two epochs, so a rename or new activity moves a
  // row in both lists at once.
  const ranked = useMemo(
    () => recomputeOn([settledSortEpoch, sortOrderEpoch], () => rankFromStore(repo, repos, sortBy)),
    [repo, repos, sortBy, settledSortEpoch, sortOrderEpoch]
  )

  return useMemo(
    () =>
      projectWorktrees(repoWorktrees, repo, repos, { sortBy, ranked, lineageById, lineageParents }),
    [repoWorktrees, repo, repos, sortBy, ranked, lineageById, lineageParents]
  )
}
