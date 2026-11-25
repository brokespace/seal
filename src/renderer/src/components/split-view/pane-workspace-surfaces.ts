import { useSyncExternalStore } from 'react'

const shownWorktreeIds = new Map<string, number>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** The workbench has a surface for this workspace laid over a pane slot. Returns the undo. */
export function reportWorkspaceSurfaceInPane(worktreeId: string): () => void {
  shownWorktreeIds.set(worktreeId, (shownWorktreeIds.get(worktreeId) ?? 0) + 1)
  notify()
  return () => {
    const count = (shownWorktreeIds.get(worktreeId) ?? 1) - 1
    if (count > 0) {
      shownWorktreeIds.set(worktreeId, count)
    } else {
      shownWorktreeIds.delete(worktreeId)
    }
    notify()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** False while a pane's workspace has no surface yet: not loaded, or it has no tabs to show. */
export function useWorkspaceSurfaceInPane(worktreeId: string): boolean {
  return useSyncExternalStore(subscribe, () => shownWorktreeIds.has(worktreeId))
}
