import { useSyncExternalStore } from 'react'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import { splitViewPaneIds } from './split-view-layout-transitions'
import {
  SPLIT_VIEW_STORAGE_KEY,
  parseSavedSplitView,
  serializeSplitView,
  splitViewFromSessionTwoUp
} from './split-view-saved-state'
import { activeSplitViewItem, type SplitViewState } from './split-view-types'

const LEGACY_SESSION_TABS_KEY = 'seal.liveSessionTabs.v1'
const NO_VISIBLE_WORKSPACES: ReadonlyMap<string, string> = new Map()

export function createSplitViewPaneId(): string {
  return createNonSecureContextUuid()
}

function restoreSessionTwoUp(): SplitViewState {
  const saved: unknown = JSON.parse(
    globalThis.localStorage?.getItem(LEGACY_SESSION_TABS_KEY) ?? 'null'
  )
  const fields = new Map<string, unknown>(
    saved && typeof saved === 'object' ? Object.entries(saved) : []
  )
  const tabs = fields.get('tabs')
  const text = (key: string): string | null => {
    const value = fields.get(key)
    return typeof value === 'string' ? value : null
  }
  return splitViewFromSessionTwoUp(
    Array.isArray(tabs) ? tabs.filter((id): id is string => typeof id === 'string') : [],
    text('activeId'),
    text('splitId'),
    { first: createSplitViewPaneId(), second: createSplitViewPaneId() }
  )
}

function restore(): SplitViewState {
  try {
    const raw = globalThis.localStorage?.getItem(SPLIT_VIEW_STORAGE_KEY)
    return raw ? parseSavedSplitView(raw) : restoreSessionTwoUp()
  } catch {
    // Unreadable or absent: start with no split view.
    return parseSavedSplitView(null)
  }
}

/** Which panes are on screen: all of them, or only the focused one when maximized or too narrow. */
export function visibleSplitViewPaneIds(state: SplitViewState, narrow: boolean): string[] {
  if ((narrow || state.maximizedPaneId !== null) && state.focusedPaneId) {
    return [state.focusedPaneId]
  }
  return splitViewPaneIds(state.layout)
}

/** The grid of panes in the main area. Kept across restarts; items are looked up live. */
export class SplitViewStore {
  private state: SplitViewState
  private narrow = false
  private visibleWorkspaces = NO_VISIBLE_WORKSPACES
  private readonly listeners = new Set<() => void>()

  constructor(initial?: SplitViewState) {
    this.state = initial ?? restore()
    this.visibleWorkspaces = this.collectVisibleWorkspaces()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): SplitViewState => this.state
  readonly hasLayout = (): boolean => this.state.layout !== null
  readonly isNarrow = (): boolean => this.narrow
  /** Worktree id to the pane showing it, for every workspace that is a visible pane's active chip. */
  readonly getVisibleWorkspaces = (): ReadonlyMap<string, string> => this.visibleWorkspaces

  /** Applies a pure transition; returns whether anything changed. */
  update(transition: (state: SplitViewState) => SplitViewState): boolean {
    const next = transition(this.state)
    if (next === this.state) {
      return false
    }
    this.state = next
    try {
      const saved = serializeSplitView(next)
      if (saved === null) {
        globalThis.localStorage?.removeItem(SPLIT_VIEW_STORAGE_KEY)
      } else {
        globalThis.localStorage?.setItem(SPLIT_VIEW_STORAGE_KEY, saved)
      }
    } catch {
      // Storage full or unavailable: the layout still works for this run.
    }
    this.notify()
    return true
  }

  /** The main area is narrower than two minimum panes: only the focused pane shows. */
  setNarrow(narrow: boolean): void {
    if (narrow !== this.narrow) {
      this.narrow = narrow
      this.notify()
    }
  }

  private notify(): void {
    const next = this.collectVisibleWorkspaces()
    const previous = this.visibleWorkspaces
    if (
      next.size !== previous.size ||
      [...next].some(([worktreeId, paneId]) => previous.get(worktreeId) !== paneId)
    ) {
      this.visibleWorkspaces = next
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  private collectVisibleWorkspaces(): ReadonlyMap<string, string> {
    const visible = new Map<string, string>()
    for (const paneId of visibleSplitViewPaneIds(this.state, this.narrow)) {
      const item = activeSplitViewItem(this.state, paneId)
      if (item?.kind === 'workspace') {
        visible.set(item.worktreeId, paneId)
      }
    }
    return visible.size === 0 ? NO_VISIBLE_WORKSPACES : visible
  }
}

export const splitViewStore = new SplitViewStore()

export function useSplitView(): SplitViewState {
  return useSyncExternalStore(splitViewStore.subscribe, splitViewStore.getState)
}

export function useSplitViewHasLayout(): boolean {
  return useSyncExternalStore(splitViewStore.subscribe, splitViewStore.hasLayout)
}

export function useSplitViewNarrow(): boolean {
  return useSyncExternalStore(splitViewStore.subscribe, splitViewStore.isNarrow)
}
