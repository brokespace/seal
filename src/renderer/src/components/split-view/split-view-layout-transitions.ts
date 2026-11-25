import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import {
  buildSplitNode,
  findSiblingGroupId,
  removeGroupLayoutLeaf,
  replaceLeaf,
  updateSplitRatio
} from '../../../../shared/workspace-layout/tab-groups/tab-group-layout-tree'
import { collectTabGroupLayoutGroupIds } from '../../../../shared/workspace-layout/tab-groups/tab-group-moves'
import {
  EMPTY_SPLIT_VIEW,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewPane,
  type SplitViewPlacement,
  type SplitViewState,
  type SplitViewTab
} from './split-view-types'

export function splitViewPaneIds(layout: TabGroupLayoutNode | null): string[] {
  return [...collectTabGroupLayoutGroupIds(layout)]
}

/** Every transition ends here: emptied panes go, focus is repaired, and a lone chip ends split view. */
export function settleSplitView(state: SplitViewState): SplitViewState {
  if (!state.layout) {
    return EMPTY_SPLIT_VIEW
  }
  let layout: TabGroupLayoutNode | null = state.layout
  const panes: Record<string, SplitViewPane> = {}
  const placedKeys = new Set<string>()
  for (const paneId of splitViewPaneIds(state.layout)) {
    const pane = state.panes[paneId]
    const tabs = (pane?.tabs ?? []).filter((tab) => {
      const key = splitViewItemKey(tab.item)
      if (placedKeys.has(key)) {
        return false
      }
      placedKeys.add(key)
      return true
    })
    if (tabs.length === 0 || Object.hasOwn(panes, paneId)) {
      layout = layout && removeGroupLayoutLeaf(layout, paneId)
      continue
    }
    const keys = tabs.map((tab) => splitViewItemKey(tab.item))
    const activeKey =
      pane.activeKey !== null && keys.includes(pane.activeKey) ? pane.activeKey : keys[0]
    panes[paneId] = { tabs, activeKey }
  }
  const paneIds = Object.keys(panes)
  if (!layout || paneIds.length === 0) {
    return EMPTY_SPLIT_VIEW
  }
  if (paneIds.length === 1 && panes[paneIds[0]].tabs.length <= 1) {
    return EMPTY_SPLIT_VIEW
  }
  let focusedPaneId = state.focusedPaneId
  if (!focusedPaneId || !Object.hasOwn(panes, focusedPaneId)) {
    const sibling = focusedPaneId ? findSiblingGroupId(state.layout, focusedPaneId) : null
    focusedPaneId = sibling && Object.hasOwn(panes, sibling) ? sibling : paneIds[0]
  }
  return {
    layout,
    panes,
    focusedPaneId,
    // The maximized pane is always the focused one.
    maximizedPaneId: state.maximizedPaneId !== null && paneIds.length > 1 ? focusedPaneId : null
  }
}

/** The chip a pane shows once `removed` leave it: the one after the active chip, else the one before. */
export function nextActiveSplitViewKey(
  pane: SplitViewPane,
  removed: ReadonlySet<string>
): string | null {
  if (pane.activeKey !== null && !removed.has(pane.activeKey)) {
    return pane.activeKey
  }
  const keys = pane.tabs.map((tab) => splitViewItemKey(tab.item))
  const from = Math.max(0, keys.indexOf(pane.activeKey ?? ''))
  const after = keys.slice(from).find((key) => !removed.has(key))
  return after ?? keys.slice(0, from).findLast((key) => !removed.has(key)) ?? null
}

export function withoutSplitViewKeys(
  panes: Record<string, SplitViewPane>,
  removed: ReadonlySet<string>
): Record<string, SplitViewPane> {
  return Object.fromEntries(
    Object.entries(panes).map(([paneId, pane]) => [
      paneId,
      {
        tabs: pane.tabs.filter((tab) => !removed.has(splitViewItemKey(tab.item))),
        activeKey: nextActiveSplitViewKey(pane, removed)
      }
    ])
  )
}

/**
 * What the main area was showing becomes the first pane. Not settled: the caller places an item
 * next, and a lone chip would otherwise end split view before it existed.
 */
export function seedSplitViewPane(
  state: SplitViewState,
  paneId: string,
  items: readonly SplitViewItem[],
  activeKey: string | null
): SplitViewState {
  if (state.layout || items.length === 0) {
    return state
  }
  return {
    layout: { type: 'leaf', groupId: paneId },
    panes: { [paneId]: { tabs: items.map((item) => ({ item, preview: false })), activeKey } },
    focusedPaneId: paneId,
    maximizedPaneId: null
  }
}

/** Puts items in a pane's strip or in a new pane beside it. Items already in the grid move. */
export function placeSplitViewItems(
  state: SplitViewState,
  items: readonly SplitViewItem[],
  placement: SplitViewPlacement,
  options: { newPaneId: string; activeKey?: string }
): SplitViewState {
  const target = state.panes[placement.paneId]
  if (!state.layout || !target || items.length === 0) {
    return state
  }
  const moved = new Map(items.map((item) => [splitViewItemKey(item), item]))
  const movedKeys = new Set(moved.keys())
  const tabs: SplitViewTab[] = [...moved.values()].map((item) => ({ item, preview: false }))
  const activeKey =
    options.activeKey !== undefined && movedKeys.has(options.activeKey)
      ? options.activeKey
      : splitViewItemKey(tabs[0].item)
  const panes = withoutSplitViewKeys(state.panes, movedKeys)
  const remaining = panes[placement.paneId].tabs
  // A pane's own chips dropped on its edge leave nothing to split from: they stay as its tabs.
  if (placement.zone === 'center' || remaining.length === 0) {
    const before = target.tabs
      .slice(0, placement.index ?? target.tabs.length)
      .filter((tab) => !movedKeys.has(splitViewItemKey(tab.item))).length
    const at = placement.zone === 'center' ? before : remaining.length
    // Tabs that change places in their own strip change nothing else, as in any tab strip.
    const reordered =
      placement.index !== undefined &&
      [...movedKeys].every((key) => target.tabs.some((tab) => splitViewItemKey(tab.item) === key))
    panes[placement.paneId] = {
      tabs: [...remaining.slice(0, at), ...tabs, ...remaining.slice(at)],
      activeKey: reordered ? target.activeKey : activeKey
    }
    return settleSplitView({
      ...state,
      panes,
      focusedPaneId: reordered ? state.focusedPaneId : placement.paneId
    })
  }
  const horizontal = placement.zone === 'left' || placement.zone === 'right'
  const first = placement.zone === 'left' || placement.zone === 'up'
  panes[options.newPaneId] = { tabs, activeKey }
  return settleSplitView({
    ...state,
    layout: replaceLeaf(
      state.layout,
      placement.paneId,
      buildSplitNode(
        placement.paneId,
        options.newPaneId,
        horizontal ? 'horizontal' : 'vertical',
        first ? 'first' : 'second'
      )
    ),
    panes,
    focusedPaneId: options.newPaneId
  })
}

/** `path` is the split node's place in the tree, as the tree renderer names it ("first.second"). */
export function setSplitViewRatio(
  state: SplitViewState,
  path: string,
  ratio: number
): SplitViewState {
  if (!state.layout) {
    return state
  }
  return {
    ...state,
    layout: updateSplitRatio(state.layout, path.length > 0 ? path.split('.') : [], ratio)
  }
}

/** Shows one pane across the whole area, or the grid again. Nothing closes. */
export function toggleSplitViewMaximize(state: SplitViewState, paneId?: string): SplitViewState {
  const target = paneId ?? state.focusedPaneId
  if (!state.layout || !target || !Object.hasOwn(state.panes, target)) {
    return state
  }
  if (state.maximizedPaneId !== null) {
    return settleSplitView({ ...state, focusedPaneId: target, maximizedPaneId: null })
  }
  return settleSplitView({ ...state, focusedPaneId: target, maximizedPaneId: target })
}
