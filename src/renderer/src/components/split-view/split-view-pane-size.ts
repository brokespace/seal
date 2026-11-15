import type { SplitViewZone } from './split-view-types'

/** Marks the main content area: the one implicit pane of single view, and the bounds of every drop. */
export const SPLIT_VIEW_DROP_AREA_ATTRIBUTE = 'data-split-view-drop-area'
export const SPLIT_VIEW_PANE_ATTRIBUTE = 'data-split-view-pane-id'

const MIN_PANE_WIDTH_PX = 240
const MIN_PANE_HEIGHT_PX = 160

/** A pane too small to halve takes the items as tabs: one rule for drops, menus and shortcuts. */
export function fitSplitViewZoneToSize(
  zone: SplitViewZone,
  size: { width: number; height: number }
): SplitViewZone {
  if (zone === 'center') {
    return zone
  }
  const fits =
    zone === 'left' || zone === 'right'
      ? size.width >= 2 * MIN_PANE_WIDTH_PX
      : size.height >= 2 * MIN_PANE_HEIGHT_PX
  return fits ? zone : 'center'
}

/** Measures the pane on screen; null is single view, whose one implicit pane is the main area. */
export function fitSplitViewZoneToPane(zone: SplitViewZone, paneId: string | null): SplitViewZone {
  const selector =
    paneId === null
      ? `[${SPLIT_VIEW_DROP_AREA_ATTRIBUTE}]`
      : `[${SPLIT_VIEW_PANE_ATTRIBUTE}="${CSS.escape(paneId)}"]`
  const pane = document.querySelector(selector)
  // A pane that is not drawn (another one is maximized) has no size to judge.
  return pane ? fitSplitViewZoneToSize(zone, pane.getBoundingClientRect()) : zone
}
