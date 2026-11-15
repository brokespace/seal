import { useAppStore } from '@/store/index'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import { liveSessionRegistryStore } from '@/components/live-sessions/live-session-registry-store'
import { liveSessionTabsStore } from '@/components/live-sessions/workspace/live-session-tabs-store'
import { measureAllTabGroupBodies } from '../tab-group/tab-group-body-geometry'
import {
  activateSplitViewChip,
  closeSplitViewChips,
  keepSplitViewChip,
  neighbourSplitViewPane,
  revealSplitViewItem,
  splitViewFocusAfterClose,
  splitViewKeysOtherThan,
  splitViewPaneKeys
} from './split-view-chip-transitions'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import { resolveSplitViewItem } from './split-view-item-resolution'
import {
  placeSplitViewItems,
  seedSplitViewPane,
  setSplitViewRatio,
  toggleSplitViewMaximize
} from './split-view-layout-transitions'
import { fitSplitViewZoneToPane } from './split-view-pane-size'
import { createSplitViewPaneId, splitViewStore } from './split-view-store'
import {
  activeSplitViewItem,
  findSplitViewPaneOfKey,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewState,
  type SplitViewZone
} from './split-view-types'

/** The pane item for a workspace, as the host that lists it knows it. */
export function workspaceSplitViewItem(workspace: {
  id: string
  hostId?: string | null
}): SplitViewItem {
  return { kind: 'workspace', worktreeId: workspace.id, hostId: workspace.hostId ?? null }
}

/** What the main area is about: the active workspace, the active session tab, or the open project. */
export function currentSplitViewItem(): SplitViewItem | null {
  const state = useAppStore.getState()
  if (selectWorktreeCreationSurfaceShown(state)) {
    return null
  }
  if (state.activeView === 'terminal') {
    return state.activeWorktreeId
      ? workspaceSplitViewItem({
          id: state.activeWorktreeId,
          hostId: state.activeWorkspaceExecutionHostId
        })
      : null
  }
  if (state.activeView === 'sessions') {
    const sessionId = liveSessionTabsStore.getState().activeId
    return sessionId ? { kind: 'session', sessionId } : null
  }
  if (state.activeView === 'project') {
    return state.projectOverviewTarget ? { kind: 'project', ...state.projectOverviewTarget } : null
  }
  return null
}

function canResolve(item: SplitViewItem): boolean {
  return (
    resolveSplitViewItem(
      item,
      useAppStore.getState(),
      liveSessionRegistryStore.getState().sessions
    ) !== null
  )
}

/** Makes an item the current one through the open path a sidebar click takes. */
export function navigateToSplitViewItem(item: SplitViewItem): void {
  const state = useAppStore.getState()
  switch (item.kind) {
    case 'workspace': {
      const executionHostId = normalizeExecutionHostId(item.hostId)
      // Focusing a pane must not scroll the sidebar or drop its filters.
      activateAndRevealWorkspace(item.worktreeId, {
        revealInSidebar: false,
        clearSidebarFilters: false,
        ...(executionHostId ? { executionHostId } : {})
      })
      return
    }
    case 'session':
      liveSessionTabsStore.adopt([item.sessionId])
      liveSessionTabsStore.activate(item.sessionId)
      state.openAgentSessionTabs()
      return
    case 'project': {
      // A project that is gone keeps its placeholder; settle returns focus to the current item.
      const resolved = resolveSplitViewItem(item, state, [])
      if (resolved?.kind === 'project') {
        state.openProjectOverview(resolved.repo)
      }
    }
  }
}

function adoptSessionChips(state: SplitViewState): void {
  const sessionIds = Object.values(state.panes).flatMap((pane) =>
    pane.tabs.flatMap((tab) => (tab.item.kind === 'session' ? [tab.item.sessionId] : []))
  )
  liveSessionTabsStore.adopt(sessionIds)
}

/** After a grid command: the focused pane's active chip becomes the current item, in the same turn. */
function navigateToFocusedChip(): void {
  const state = splitViewStore.getState()
  const item = state.focusedPaneId ? activeSplitViewItem(state, state.focusedPaneId) : null
  const current = currentSplitViewItem()
  if (item && (!current || splitViewItemKey(current) !== splitViewItemKey(item))) {
    navigateToSplitViewItem(item)
  }
  // The registry measures on resize, not on move.
  requestAnimationFrame(measureAllTabGroupBodies)
}

/** Focus is navigation: the pane's item becomes the active workspace, session tab or project. */
export function focusSplitViewPane(paneId: string, key?: string): void {
  const before = splitViewStore.getState()
  if (
    before.focusedPaneId === paneId &&
    (key === undefined || before.panes[paneId]?.activeKey === key)
  ) {
    return
  }
  if (splitViewStore.update((state) => activateSplitViewChip(state, paneId, key))) {
    navigateToFocusedChip()
  }
}

export function focusSplitViewPaneOfWorkspace(worktreeId: string): void {
  const paneId = splitViewStore.getVisibleWorkspaces().get(worktreeId)
  if (paneId) {
    focusSplitViewPane(paneId)
  }
}

export function focusNeighbourSplitViewPane(step: 1 | -1): void {
  const state = splitViewStore.getState()
  // A workspace or project that is gone cannot become the current item, so focus passes over it.
  const paneId = neighbourSplitViewPane(state, step, (candidate) => {
    const item = activeSplitViewItem(state, candidate)
    const isSession = item?.kind === 'session'
    return !item || isSession || resolveSplitViewItem(item, useAppStore.getState(), []) !== null
  })
  if (paneId) {
    focusSplitViewPane(paneId)
  }
}

/**
 * Where navigation lands: the pane that holds the item gets focus and shows it; otherwise it
 * opens in the focused pane as a preview chip. A session preview it replaces closes its tab too.
 */
export function revealItemInSplitView(item: SplitViewItem): void {
  const before = splitViewStore.getState()
  if (!splitViewStore.update((state) => revealSplitViewItem(state, item))) {
    return
  }
  const after = new Set(
    Object.values(splitViewStore.getState().panes).flatMap((pane) =>
      pane.tabs.map((tab) => splitViewItemKey(tab.item))
    )
  )
  for (const pane of Object.values(before.panes)) {
    for (const tab of pane.tabs) {
      if (tab.item.kind === 'session' && !after.has(splitViewItemKey(tab.item))) {
        liveSessionTabsStore.close(tab.item.sessionId)
      }
    }
  }
  if (item.kind === 'session') {
    liveSessionTabsStore.adopt([item.sessionId])
  }
  requestAnimationFrame(measureAllTabGroupBodies)
}

/** False when the item is not in the grid. */
export function closeItemInSplitView(item: SplitViewItem): boolean {
  const key = splitViewItemKey(item)
  if (!findSplitViewPaneOfKey(splitViewStore.getState(), key)) {
    return false
  }
  closeSplitViewItems(new Set([key]))
  return true
}

export function keepSplitViewItem(key: string): void {
  splitViewStore.update((state) => keepSplitViewChip(state, key))
}

/** What single view shows, as the chips of a first pane: every open session tab comes along. */
function currentViewItems(): { items: SplitViewItem[]; activeKey: string | null } {
  const current = currentSplitViewItem()
  if (!current) {
    return { items: [], activeKey: null }
  }
  if (current.kind !== 'session') {
    return { items: [current], activeKey: splitViewItemKey(current) }
  }
  return {
    items: liveSessionTabsStore
      .getState()
      .tabs.map((sessionId): SplitViewItem => ({ kind: 'session', sessionId })),
    activeKey: splitViewItemKey(current)
  }
}

export type SplitViewDropPlace = {
  /** Null in single view: the main area is one implicit pane showing the current item. */
  paneId: string | null
  zone: SplitViewZone
  index?: number
}

/**
 * Puts items in the grid: in a pane's strip, or in a new pane beside it. The first placement
 * creates split view from what the main area was showing. The placed item ends up focused.
 */
export function placeItemsInSplitView(
  items: readonly SplitViewItem[],
  place: SplitViewDropPlace,
  activeKey?: string
): void {
  if (items.length === 0) {
    return
  }
  const newPaneId = createSplitViewPaneId()
  const seedPaneId = createSplitViewPaneId()
  const before = splitViewStore.getState()
  const zone = fitSplitViewZoneToPane(
    place.zone,
    before.layout ? (place.paneId ?? before.focusedPaneId) : null
  )
  splitViewStore.update((state) => {
    let seeded = state
    let paneId = place.paneId ?? state.focusedPaneId
    if (!state.layout) {
      const view = currentViewItems()
      // Nothing is showing (Home): the placed items are the first pane themselves.
      const first = view.items.length > 0 ? view : { items: [...items], activeKey: null }
      seeded = seedSplitViewPane(state, seedPaneId, first.items, first.activeKey)
      paneId = seedPaneId
    }
    if (!paneId) {
      return state
    }
    return placeSplitViewItems(
      seeded,
      items,
      { paneId, zone, index: place.index },
      { newPaneId, activeKey }
    )
  })
  const next = splitViewStore.getState()
  if (next.layout) {
    adoptSessionChips(next)
    navigateToFocusedChip()
    return
  }
  // No split came of it (a lone item, or the current item dropped on itself): a plain open.
  navigateToSplitViewItem(items.find((item) => splitViewItemKey(item) === activeKey) ?? items[0])
}

/** The focused pane, or single view's implicit pane. */
export function openItemsInSplitView(items: readonly SplitViewItem[], zone: SplitViewZone): void {
  placeItemsInSplitView(items, { paneId: splitViewStore.getState().focusedPaneId, zone })
}

/**
 * Closing destroys nothing: the items leave the grid, and a session's tab closes with its chip.
 * The next focus is picked from the grid and navigated to first, so no item the user never
 * placed takes the closed one's place.
 */
export function closeSplitViewItems(keys: ReadonlySet<string>): void {
  const state = splitViewStore.getState()
  if (!state.layout || keys.size === 0) {
    return
  }
  const closedSessionIds = Object.values(state.panes).flatMap((pane) =>
    pane.tabs.flatMap((tab) =>
      tab.item.kind === 'session' && keys.has(splitViewItemKey(tab.item))
        ? [tab.item.sessionId]
        : []
    )
  )
  const current = currentSplitViewItem()
  if (!current || keys.has(splitViewItemKey(current))) {
    const next = splitViewFocusAfterClose(state, keys, canResolve)
    if (next) {
      navigateToSplitViewItem(next)
    }
  }
  splitViewStore.update((before) => closeSplitViewChips(before, keys))
  for (const sessionId of closedSessionIds) {
    liveSessionTabsStore.close(sessionId)
  }
  navigateToFocusedChip()
}

/** Back to a single view of the focused pane's item. */
export function leaveSplitView(): void {
  const state = splitViewStore.getState()
  const kept = state.focusedPaneId ? state.panes[state.focusedPaneId]?.activeKey : null
  closeSplitViewItems(
    new Set(
      Object.values(state.panes)
        .flatMap((pane) => pane.tabs.map((tab) => splitViewItemKey(tab.item)))
        .filter((key) => key !== kept)
    )
  )
}

export function closeSplitViewPane(paneId: string): void {
  closeSplitViewItems(new Set(splitViewPaneKeys(splitViewStore.getState(), paneId)))
}

export function closeOtherSplitViewItems(paneId: string, key: string): void {
  closeSplitViewItems(splitViewKeysOtherThan(splitViewStore.getState(), paneId, key))
}

export function toggleSplitViewPaneMaximized(paneId?: string): void {
  const { layout, maximizedPaneId } = splitViewStore.getState()
  // One pane already shows alone: maximizing would only be seen once the window widens.
  if (maximizedPaneId === null && (layout?.type !== 'split' || splitViewStore.isNarrow())) {
    return
  }
  if (splitViewStore.update((state) => toggleSplitViewMaximize(state, paneId))) {
    navigateToFocusedChip()
  }
}

export function resizeSplitViewPanes(path: string, ratio: number): void {
  splitViewStore.update((state) => setSplitViewRatio(state, path, ratio))
}
