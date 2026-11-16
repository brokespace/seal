import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { resolveProjectOverviewRepo } from '@/components/project-overview/project-overview-model'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isWorktreeRetiredByRemoval } from '../../../../shared/worktree/removal/removal-visibility'
import type { Repo } from '../../../../shared/repo-types'
import type { SplitViewItem } from './split-view-types'

type CatalogState = Pick<AppState, 'worktreesByRepo' | 'folderWorkspaces' | 'repos'>

export type ResolvedSplitViewItem =
  | {
      kind: 'workspace'
      title: string
      /** Tells apart workspaces of the same name, such as every project's `main`. */
      projectName: string | null
      isFolder: boolean
      repoId: string | null
    }
  | { kind: 'project'; repo: Repo }

/** The live thing an item names, or null while it is not (or no longer) there. */
export function resolveSplitViewItem(
  item: SplitViewItem,
  state: CatalogState
): ResolvedSplitViewItem | null {
  switch (item.kind) {
    case 'workspace': {
      const scope = parseWorkspaceKey(item.worktreeId)
      if (scope?.type === 'folder') {
        const folder = selectFolderWorkspaces(state).find(
          (workspace) => workspace.id === scope.folderWorkspaceId
        )
        return folder
          ? {
              kind: 'workspace',
              title: folder.name,
              projectName: null,
              isFolder: true,
              repoId: null
            }
          : null
      }
      const worktree = getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(item.worktreeId)
      if (!worktree || isWorktreeRetiredByRemoval(worktree)) {
        return null
      }
      const repo = state.repos.find((candidate) => candidate.id === worktree.repoId)
      const isFolder = repo !== undefined && !isGitRepoKind(repo)
      return {
        kind: 'workspace',
        title: worktree.displayName,
        // A folder project is its one workspace; naming both would say the same thing twice.
        projectName: repo && !isFolder ? repo.displayName : null,
        isFolder,
        repoId: worktree.repoId
      }
    }
    case 'project': {
      const repo = resolveProjectOverviewRepo(state.repos, item)
      return repo ? { kind: 'project', repo } : null
    }
  }
}
