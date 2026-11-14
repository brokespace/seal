import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectSidebarLineageParentIdentities } from '@/store/slices/worktrees/metadata/cross-store-lineage-parents'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { projectWorktrees, rankProjectWorktrees } from './project-overview-model'

/** A registration's workspaces in the sidebar's order, re-ranked when the sidebar re-ranks. */
export function useProjectWorktrees(repo: Repo): Worktree[] {
  const repos = useAppStore((s) => s.repos)
  const repoWorktrees = useAppStore((s) => selectWorktreesByRepo(s)[repo.id])
  const sortBy = useAppStore((s) => s.sortBy)
  const settledSortEpoch = useAppStore((s) => s.settledSortEpoch)
  const sortOrderEpoch = useAppStore((s) => s.sortOrderEpoch)
  const lineageById = useAppStore((s) => s.worktreeLineageById)
  const lineageParents = useAppStore(selectSidebarLineageParentIdentities)

  const ranked = useMemo(() => {
    const state = useAppStore.getState()
    return rankProjectWorktrees(selectWorktreesByRepo(state)[repo.id], repo, repos, {
      sortBy,
      sources: state,
      now: Date.now()
    })
    // The sidebar holds its ranking between these two epochs, so a rename or new activity moves
    // a row in both lists at once.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the epochs are triggers, not inputs.
  }, [repo, repos, sortBy, settledSortEpoch, sortOrderEpoch])

  return useMemo(
    () =>
      projectWorktrees(repoWorktrees, repo, repos, { sortBy, ranked, lineageById, lineageParents }),
    [repoWorktrees, repo, repos, sortBy, ranked, lineageById, lineageParents]
  )
}
