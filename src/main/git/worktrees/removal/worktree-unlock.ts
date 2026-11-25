import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import { windowsLongPathGitArgs } from '../../../../shared/windows-long-path-git-args'
import { gitExecFileAsync } from '../../command-runner/git-exec-file'
import { bumpWorktreeScanGeneration } from '../catalog/worktree-scan-cache'
import { gitExecOptions, type GitWorktreeExecOptions } from '../worktree-operation-options'

/**
 * Releases Git's lock on a worktree the user confirmed deleting anyway. Returns whether a lock was
 * released, so the caller re-lists before its lock checks run.
 */
export async function unlockWorktreeForConfirmedRemoval(
  repoPath: string,
  worktree: Pick<GitWorktreeInfo, 'path' | 'locked'> | null | undefined,
  options: GitWorktreeExecOptions = {}
): Promise<boolean> {
  if (!worktree?.locked) {
    return false
  }
  try {
    await gitExecFileAsync(
      [...windowsLongPathGitArgs(repoPath), 'worktree', 'unlock', worktree.path],
      gitExecOptions(repoPath, options)
    )
  } finally {
    bumpWorktreeScanGeneration(repoPath)
  }
  return true
}
