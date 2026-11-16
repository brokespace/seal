type Takeover = (removedWorktreeId: string) => boolean

let takeover: Takeover | null = null

/** Lets split view choose what follows a removed active workspace: its next chip, not a sibling. */
export function registerRemovedActiveWorktreeTakeover(next: Takeover): () => void {
  takeover = next
  return () => {
    if (takeover === next) {
      takeover = null
    }
  }
}

/** True when the removed workspace's place was taken, so no successor workspace should open. */
export function takeOverRemovedActiveWorktree(removedWorktreeId: string): boolean {
  return takeover?.(removedWorktreeId) ?? false
}
