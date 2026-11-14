import type { Repo } from '../../../../shared/repo-types'
import type { ProjectRuntimeResolutionStore } from '../../../workspaces/execution-host/local-project-runtime-resolution'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import {
  resolveWorktreeRemovalHome,
  type WorktreeRemovalRoute
} from '../../../workspaces/removal/worktree-removal-execution-host-route'
import { findRegisteredDeletableWorktree } from '../../../workspaces/removal/worktree-removal-safety'
import { unlockWorktreeForConfirmedRemoval } from '../../../git/worktrees/removal/worktree-unlock'
import type { LocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { getLocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { listWorktreesStrict } from '../../../git/worktrees/catalog/worktree-listing'

/** Require a validated local removal route before listing, preventing reads before non-local hosts are refused. */
export async function listWorktreesOnRemovalRoute(
  _route: WorktreeRemovalRoute,
  repo: Repo,
  store: ProjectRuntimeResolutionStore
): Promise<{
  localWorktreeGitOptions: LocalProjectWorktreeGitOptions
  registeredWorktrees: GitWorktreeInfo[]
}> {
  const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  return {
    localWorktreeGitOptions,
    registeredWorktrees: Object.keys(localWorktreeGitOptions).length
      ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
      : await listWorktreesStrict(repo.path)
  }
}

/** The listing and the registered worktree a removal acts on, after releasing its lock when the caller confirmed that. */
export async function findRegisteredWorktreeOnRemovalRoute(args: {
  route: WorktreeRemovalRoute
  repo: Repo
  store: ProjectRuntimeResolutionStore
  worktreePath: string
  unlockLockedWorktree: boolean
}): Promise<{
  localWorktreeGitOptions: LocalProjectWorktreeGitOptions
  registeredWorktrees: GitWorktreeInfo[]
  registeredWorktree: GitWorktreeInfo | null
}> {
  const { route, repo, store } = args
  const find = (worktrees: GitWorktreeInfo[]): GitWorktreeInfo | null =>
    findRegisteredDeletableWorktree(
      repo.path,
      args.worktreePath,
      worktrees,
      resolveWorktreeRemovalHome(route)
    )
  const listed = await listWorktreesOnRemovalRoute(route, repo, store)
  const registeredWorktree = find(listed.registeredWorktrees)
  if (
    !args.unlockLockedWorktree ||
    !(await unlockWorktreeForConfirmedRemoval(
      repo.path,
      registeredWorktree,
      listed.localWorktreeGitOptions
    ))
  ) {
    return { ...listed, registeredWorktree }
  }
  // Every later lock check reads a listing, so they must see the released lock.
  const relisted = await listWorktreesOnRemovalRoute(route, repo, store)
  return { ...relisted, registeredWorktree: find(relisted.registeredWorktrees) }
}
