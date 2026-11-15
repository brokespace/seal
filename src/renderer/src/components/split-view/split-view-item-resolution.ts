import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { resolveProjectOverviewRepo } from '@/components/project-overview/project-overview-model'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isWorktreeRetiredByRemoval } from '../../../../shared/worktree/removal/removal-visibility'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
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
  | { kind: 'session'; session: LiveSession }
  | { kind: 'project'; repo: Repo }

/** The live thing an item names, or null while it is not (or no longer) there. */
export function resolveSplitViewItem(
  item: SplitViewItem,
  state: CatalogState,
  sessions: readonly LiveSession[]
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
      return worktree && !isWorktreeRetiredByRemoval(worktree)
        ? {
            kind: 'workspace',
            title: worktree.displayName,
            projectName:
              state.repos.find((repo) => repo.id === worktree.repoId)?.displayName ?? null,
            isFolder: false,
            repoId: worktree.repoId
          }
        : null
    }
    case 'session': {
      const session = sessions.find((candidate) => candidate.id === item.sessionId)
      return session ? { kind: 'session', session } : null
    }
    case 'project': {
      const repo = resolveProjectOverviewRepo(state.repos, item)
      return repo ? { kind: 'project', repo } : null
    }
  }
}
