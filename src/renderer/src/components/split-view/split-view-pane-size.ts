import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { splitViewStore } from './split-view-store'
import type { SplitViewZone } from './split-view-types'

type Size = { width: number; height: number }

/** Marks the main content area: the one implicit pane of single view, and the bounds of every drop. */
export const SPLIT_VIEW_DROP_AREA_ATTRIBUTE = 'data-split-view-drop-area'
export const SPLIT_VIEW_PANE_ATTRIBUTE = 'data-split-view-pane-id'

const SPLIT_VIEW_LAYER_SELECTOR = '[data-split-view-layer]'

const MIN_PANE_WIDTH_PX = 240
const MIN_PANE_HEIGHT_PX = 160

/** A pane too small to halve takes the items as tabs: one rule for drops, menus and shortcuts. */
export function fitSplitViewZoneToSize(zone: SplitViewZone, size: Size): SplitViewZone {
  if (zone === 'center') {
    return zone
  }
  const fits =
    zone === 'left' || zone === 'right'
      ? size.width >= 2 * MIN_PANE_WIDTH_PX
      : size.height >= 2 * MIN_PANE_HEIGHT_PX
  return fits ? zone : 'center'
}

function paneShareOfGrid(layout: TabGroupLayoutNode | null, paneId: string): Size | null {
  if (!layout) {
    return null
  }
  if (layout.type === 'leaf') {
    return layout.groupId === paneId ? { width: 1, height: 1 } : null
  }
  const ratio = layout.ratio ?? 0.5
  const first = paneShareOfGrid(layout.first, paneId)
  const inner = first ?? paneShareOfGrid(layout.second, paneId)
  if (!inner) {
    return null
  }
  const share = first ? ratio : 1 - ratio
  return layout.direction === 'horizontal'
    ? { width: inner.width * share, height: inner.height }
    : { width: inner.width, height: inner.height * share }
}

/**
 * The size a pane has in the grid. One drawn alone (maximized, or in a narrow main area) covers
 * the whole grid, so its share of that is what a split would halve.
 */
export function splitViewPaneGridSize(paneId: string | null, drawn: Size): Size {
  const state = splitViewStore.getState()
  const alone = state.maximizedPaneId !== null || splitViewStore.isNarrow()
  const share = alone && paneId ? paneShareOfGrid(state.layout, paneId) : null
  return share ? { width: drawn.width * share.width, height: drawn.height * share.height } : drawn
}

/** Measures the pane on screen; null is single view, whose one implicit pane is the main area. */
export function fitSplitViewZoneToPane(zone: SplitViewZone, paneId: string | null): SplitViewZone {
  const selector =
    paneId === null
      ? `[${SPLIT_VIEW_DROP_AREA_ATTRIBUTE}]`
      : `[${SPLIT_VIEW_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`
  // A pane that is not drawn (another one is maximized) is measured by the grid it is part of.
  const drawn = [
    document.querySelector(selector),
    document.querySelector(SPLIT_VIEW_LAYER_SELECTOR)
  ].find((element) => element && element.getClientRects().length > 0)
  return drawn
    ? fitSplitViewZoneToSize(zone, splitViewPaneGridSize(paneId, drawn.getBoundingClientRect()))
    : zone
}
