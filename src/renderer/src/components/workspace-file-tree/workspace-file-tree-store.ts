import { useSyncExternalStore } from 'react'
import { clampSidebarResizeWidth } from '@/hooks/useSidebarResize'

export const WORKSPACE_FILE_TREE_STORAGE_KEY = 'seal.workspaceFileTree.v1'
export const WORKSPACE_FILE_TREE_MIN_WIDTH = 180
export const WORKSPACE_FILE_TREE_MAX_WIDTH = 560
const DEFAULT_WIDTH = 260
// Why capped: a deleted workspace never closes its tree, so its id would stay forever.
const MAX_OPEN_WORKSPACES = 200

export type WorkspaceFileTreeState = {
  /** Worktree ids whose tree is open; every other workspace has it closed. */
  open: ReadonlySet<string>
  /** One width for every workspace's tree. */
  width: number
}

function restore(): WorkspaceFileTreeState {
  try {
    const saved: unknown = JSON.parse(
      globalThis.localStorage?.getItem(WORKSPACE_FILE_TREE_STORAGE_KEY) ?? 'null'
    )
    const fields = new Map<string, unknown>(
      saved && typeof saved === 'object' ? Object.entries(saved) : []
    )
    const open = fields.get('open')
    const width = fields.get('width')
    return {
      open: new Set(
        Array.isArray(open) ? open.filter((id): id is string => typeof id === 'string') : []
      ),
      width:
        typeof width === 'number' && Number.isFinite(width)
          ? clampSidebarResizeWidth(
              width,
              WORKSPACE_FILE_TREE_MIN_WIDTH,
              WORKSPACE_FILE_TREE_MAX_WIDTH
            )
          : DEFAULT_WIDTH
    }
  } catch {
    // Unreadable or absent: every tree starts closed.
    return { open: new Set(), width: DEFAULT_WIDTH }
  }
}

function save(state: WorkspaceFileTreeState): void {
  try {
    globalThis.localStorage?.setItem(
      WORKSPACE_FILE_TREE_STORAGE_KEY,
      JSON.stringify({ open: [...state.open], width: state.width })
    )
  } catch {
    // Storage full or unavailable: the panel still works for this run.
  }
}

/** Which workspaces show their file tree, and how wide it is. Kept across restarts. */
export class WorkspaceFileTreeStore {
  private state: WorkspaceFileTreeState
  private readonly listeners = new Set<() => void>()

  constructor(initial?: WorkspaceFileTreeState) {
    this.state = initial ?? restore()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): WorkspaceFileTreeState => this.state

  setOpen(worktreeId: string, open: boolean): void {
    if (this.state.open.has(worktreeId) === open) {
      return
    }
    const ids = new Set(this.state.open)
    if (open) {
      ids.add(worktreeId)
    } else {
      ids.delete(worktreeId)
    }
    // Sets keep insertion order, so the oldest opened ids go first.
    this.set({ open: new Set([...ids].slice(-MAX_OPEN_WORKSPACES)) })
  }

  toggle(worktreeId: string): void {
    this.setOpen(worktreeId, !this.state.open.has(worktreeId))
  }

  setWidth(width: number): void {
    const next = clampSidebarResizeWidth(
      width,
      WORKSPACE_FILE_TREE_MIN_WIDTH,
      WORKSPACE_FILE_TREE_MAX_WIDTH
    )
    if (next !== this.state.width) {
      this.set({ width: next })
    }
  }

  private set(patch: Partial<WorkspaceFileTreeState>): void {
    this.state = { ...this.state, ...patch }
    save(this.state)
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const workspaceFileTreeStore = new WorkspaceFileTreeStore()

export function useWorkspaceFileTreeOpen(worktreeId: string): boolean {
  return useSyncExternalStore(workspaceFileTreeStore.subscribe, () =>
    workspaceFileTreeStore.getState().open.has(worktreeId)
  )
}

export function useWorkspaceFileTreeWidth(): number {
  return useSyncExternalStore(
    workspaceFileTreeStore.subscribe,
    () => workspaceFileTreeStore.getState().width
  )
}
