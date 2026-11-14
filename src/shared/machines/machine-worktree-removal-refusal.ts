/** Why Git refused `git worktree remove` on a machine, when a confirmed retry can get past it. */
export type MachineWorktreeRemovalRefusal =
  | { kind: 'changes' }
  | { kind: 'submodules' }
  | { kind: 'locked'; reason: string | null }

const LOCK_REASON = /cannot remove a locked working tree, lock reason: ([^\n]*)/

export function classifyMachineWorktreeRemovalRefusal(
  gitError: string
): MachineWorktreeRemovalRefusal | null {
  if (gitError.includes('cannot remove a locked working tree')) {
    return { kind: 'locked', reason: LOCK_REASON.exec(gitError)?.[1]?.trim() || null }
  }
  if (gitError.includes('contains modified or untracked files')) {
    return { kind: 'changes' }
  }
  if (gitError.includes('working trees containing submodules cannot be moved or removed')) {
    return { kind: 'submodules' }
  }
  return null
}

/** The `removeWorktree` waiver that answers a refusal. */
export function machineWorktreeRemovalWaiver(refusal: MachineWorktreeRemovalRefusal): {
  force: true
  unlock?: true
} {
  return refusal.kind === 'locked' ? { force: true, unlock: true } : { force: true }
}
