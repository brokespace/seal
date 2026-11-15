import { findSiblingGroupId } from '../../../../shared/workspace-layout/tab-groups/tab-group-layout-tree'
import {
  settleSplitView,
  splitViewPaneIds,
  withoutSplitViewKeys
} from './split-view-layout-transitions'
import {
  findSplitViewPaneOfKey,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewPane,
  type SplitViewState
} from './split-view-types'

function withPane(state: SplitViewState, paneId: string, pane: SplitViewPane): SplitViewState {
  return { ...state, panes: { ...state.panes, [paneId]: pane } }
}

/** Focuses a pane, showing `key` in it when given. */
export function activateSplitViewChip(
  state: SplitViewState,
  paneId: string,
  key?: string
): SplitViewState {
  const pane = state.panes[paneId]
  if (!state.layout || !pane) {
    return state
  }
  const hasKey = key !== undefined && pane.tabs.some((tab) => splitViewItemKey(tab.item) === key)
  if (state.focusedPaneId === paneId && (!hasKey || pane.activeKey === key)) {
    return state
  }
  return settleSplitView({
    ...(hasKey ? withPane(state, paneId, { ...pane, activeKey: key }) : state),
    focusedPaneId: paneId
  })
}

/**
 * Where navigation lands: the pane that already holds the item gets focus and shows it; otherwise
 * it opens in the focused pane as a preview chip, replacing that pane's previous preview.
 */
export function revealSplitViewItem(state: SplitViewState, item: SplitViewItem): SplitViewState {
  const key = splitViewItemKey(item)
  const paneId = findSplitViewPaneOfKey(state, key)
  if (paneId) {
    return activateSplitViewChip(state, paneId, key)
  }
  const focused = state.focusedPaneId
  const pane = focused ? state.panes[focused] : undefined
  if (!state.layout || !focused || !pane) {
    return state
  }
  const previewAt = pane.tabs.findIndex((tab) => tab.preview)
  const chip = { item, preview: true }
  const tabs =
    previewAt === -1
      ? [...pane.tabs, chip]
      : pane.tabs.map((tab, index) => (index === previewAt ? chip : tab))
  return settleSplitView(withPane(state, focused, { tabs, activeKey: key }))
}

/** A preview chip becomes a kept one. */
export function keepSplitViewChip(state: SplitViewState, key: string): SplitViewState {
  const paneId = findSplitViewPaneOfKey(state, key)
  const pane = paneId ? state.panes[paneId] : undefined
  if (!paneId || !pane?.tabs.some((tab) => tab.preview && splitViewItemKey(tab.item) === key)) {
    return state
  }
  return withPane(state, paneId, {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      splitViewItemKey(tab.item) === key ? { ...tab, preview: false } : tab
    )
  })
}

/** Closing destroys nothing; the items only leave the grid. Also how vanished items are pruned. */
export function closeSplitViewChips(
  state: SplitViewState,
  keys: ReadonlySet<string>
): SplitViewState {
  if (!state.layout || keys.size === 0) {
    return state
  }
  return settleSplitView({ ...state, panes: withoutSplitViewKeys(state.panes, keys) })
}

export function splitViewPaneKeys(state: SplitViewState, paneId: string): string[] {
  return (state.panes[paneId]?.tabs ?? []).map((tab) => splitViewItemKey(tab.item))
}

export function splitViewKeysOtherThan(
  state: SplitViewState,
  paneId: string,
  key: string
): Set<string> {
  return new Set(splitViewPaneKeys(state, paneId).filter((other) => other !== key))
}

/**
 * The item focus goes to once `keys` close: the focused pane's next chip, else the sibling pane's
 * active chip, preferring one that can be resolved. Null when nothing is left.
 */
export function splitViewFocusAfterClose(
  state: SplitViewState,
  keys: ReadonlySet<string>,
  canResolve: (item: SplitViewItem) => boolean = () => true
): SplitViewItem | null {
  if (!state.layout || !state.focusedPaneId) {
    return null
  }
  const panes = withoutSplitViewKeys(state.panes, keys)
  const activeOf = (paneId: string | null): SplitViewItem | null => {
    const pane = paneId ? panes[paneId] : undefined
    return pane?.tabs.find((tab) => splitViewItemKey(tab.item) === pane.activeKey)?.item ?? null
  }
  const sibling = findSiblingGroupId(state.layout, state.focusedPaneId)
  const candidates = [
    activeOf(state.focusedPaneId),
    activeOf(sibling),
    ...splitViewPaneIds(state.layout).map(activeOf)
  ].filter((item): item is SplitViewItem => item !== null)
  return candidates.find(canResolve) ?? candidates[0] ?? null
}

/** Pane ids in tree order (first child before second), which reads left to right, top to bottom. */
export function neighbourSplitViewPane(state: SplitViewState, step: 1 | -1): string | null {
  const paneIds = splitViewPaneIds(state.layout)
  const index = state.focusedPaneId ? paneIds.indexOf(state.focusedPaneId) : -1
  if (paneIds.length < 2 || index === -1) {
    return null
  }
  return paneIds[(index + step + paneIds.length) % paneIds.length]
}
