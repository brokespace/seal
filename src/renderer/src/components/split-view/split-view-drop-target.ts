import { useAppStore } from '@/store/index'
import { isWorkspaceKanbanSidebarDropPointInBoard } from '@/components/sidebar/workspace-board/drag/workspace-kanban-sidebar-drop'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import { resolveDropZone } from '../tab-group/tab-drop-zone'
import {
  currentSplitViewItem,
  navigateToSplitViewItem,
  placeItemsInSplitView,
  workspaceSplitViewItem,
  type SplitViewDropPlace
} from './split-view-commands'
import {
  setSplitViewDropPreview,
  type SplitViewDropPreview,
  type SplitViewDropRect as Rect
} from './split-view-drag-state'
import { containsDropPoint, dropZoneRect, findDropElementAt } from './split-view-drop-geometry'
import { selectItemViewShown } from './split-view-showing'
import { splitViewStore } from './split-view-store'
import {
  SPLIT_VIEW_DROP_AREA_ATTRIBUTE,
  SPLIT_VIEW_PANE_ATTRIBUTE,
  fitSplitViewZoneToSize,
  splitViewPaneGridSize
} from './split-view-pane-size'
import {
  activeSplitViewItem,
  splitViewItemKey,
  type SplitViewItem,
  type SplitViewTabPlace,
  type SplitViewZone
} from './split-view-types'

/** On a strip: the id of its pane. */
export const ITEM_TAB_STRIP_ATTRIBUTE = 'data-item-tab-strip'
export const ITEM_TAB_KEY_ATTRIBUTE = 'data-item-tab-key'
/** On the part of a strip its tabs and their scroll buttons take. */
export const ITEM_TAB_ROW_ATTRIBUTE = 'data-item-tab-row'

const EDGE_SHARE = 0.3

type ResolvedDrop = { place: SplitViewDropPlace | 'open'; preview: SplitViewDropPreview }

/** The main area under the pointer, and what it accepts. */
type DropArea = { mode: DropMode; area: HTMLElement; areaRect: Rect }

/** Null in single view: the main area is one implicit pane. */
type DropPane = { paneId: string | null; pane: HTMLElement }

type DropMode = 'grid' | 'single' | 'open'

/** What the main area accepts right now: nothing on pages that are not items or Home. */
function dropMode(): DropMode | null {
  const state = useAppStore.getState()
  if (selectWorktreeCreationSurfaceShown(state)) {
    return null
  }
  if (selectItemViewShown(state)) {
    if (splitViewStore.hasLayout()) {
      return 'grid'
    }
    return currentSplitViewItem() ? 'single' : 'open'
  }
  return state.activeView === 'home' ? 'open' : null
}

/** A card dropped on the main area lands in a pane, so a lone card is still worth dragging. */
export function canDropOnSplitView(): boolean {
  return dropMode() !== null
}

/** The chips a pane, or single view's implicit pane, already holds. */
function paneKeys(paneId: string | null): string[] {
  if (paneId !== null) {
    return (splitViewStore.getState().panes[paneId]?.tabs ?? []).map((tab) =>
      splitViewItemKey(tab.item)
    )
  }
  const current = currentSplitViewItem()
  return current ? [splitViewItemKey(current)] : []
}

/** The chip a pane, or single view, has in front. */
function shownKey(paneId: string | null): string | null {
  if (paneId !== null) {
    return splitViewStore.getState().panes[paneId]?.activeKey ?? null
  }
  const current = currentSplitViewItem()
  return current ? splitViewItemKey(current) : null
}

function resolveStripDrop(
  strip: HTMLElement,
  x: number,
  paneId: string,
  dragged: ReadonlySet<string>,
  pointerCaptured: boolean
): ResolvedDrop {
  const stripRect = strip.getBoundingClientRect()
  const tabs = [...strip.querySelectorAll<HTMLElement>(`[${ITEM_TAB_KEY_ATTRIBUTE}]`)]
  const scroller = strip.querySelector<HTMLElement>('[role="tablist"]')
  const shown = scroller?.getBoundingClientRect() ?? stripRect
  const row = strip.querySelector(`[${ITEM_TAB_ROW_ATTRIBUTE}]`)?.getBoundingClientRect() ?? shown
  // Tabs scrolled out of the strip lie under what is beside it: past either end is that end.
  let index = x <= shown.left ? 0 : -1
  if (x > shown.left && x < shown.right) {
    // The first tab the pointer is left of the middle of; past them all, the end of the last.
    index = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect()
      return x < rect.left + rect.width / 2
    })
  }
  // Beside the tabs the end it would land at is shown. A scroll button scrolls a held tab along
  // itself, unless the drag captured the pointer and the button never sees it.
  const besideTabs = x <= shown.left || x >= shown.right
  if (scroller && (x < row.left || x > row.right || (pointerCaptured && besideTabs))) {
    scroller.scrollLeft = index === 0 ? 0 : scroller.scrollWidth
  }
  const side = index === -1 ? 'right' : 'left'
  const hovered = tabs.at(index)
  const hoveredRect = hovered?.getBoundingClientRect() ?? stripRect
  // Where the tab draws its own bar, inside that edge; none where the edge is scrolled out of view.
  const barLeft = side === 'left' ? hoveredRect.left : hoveredRect.right - 2
  const barWidth = barLeft < shown.left - 1 || barLeft > shown.right - 1 ? 0 : 2
  const visibleTabId = hovered?.getAttribute(ITEM_TAB_KEY_ATTRIBUTE)
  const under = tabs.find((tab) => {
    const rect = tab.getBoundingClientRect()
    return x >= rect.left && x < rect.right
  })
  const overItself = dragged.has(under?.getAttribute(ITEM_TAB_KEY_ATTRIBUTE) ?? '')
  return {
    place: { paneId, zone: 'center', index: index === -1 ? tabs.length : index },
    preview: {
      kind: 'insert',
      rect: { left: barLeft, top: hoveredRect.top, width: barWidth, height: hoveredRect.height },
      // No bar while over the dragged tab itself, as in a workspace's tab row.
      ...(visibleTabId && !overItself ? { insertion: { groupId: paneId, visibleTabId, side } } : {})
    }
  }
}

function dropAreaAt(x: number, y: number): DropArea | null {
  const area = document.querySelector<HTMLElement>(`[${SPLIT_VIEW_DROP_AREA_ATTRIBUTE}]`)
  const mode = dropMode()
  if (!area || !mode) {
    return null
  }
  const areaRect = area.getBoundingClientRect()
  // The Workspace Board takes the drop while it is open; so does anything else floating above.
  if (!containsDropPoint(areaRect, x, y) || isWorkspaceKanbanSidebarDropPointInBoard(x, y)) {
    return null
  }
  const hit = document.elementFromPoint(x, y)
  return hit && area.contains(hit) ? { mode, area, areaRect } : null
}

function dropPaneAt({ mode, area }: DropArea, x: number, y: number): DropPane | null {
  const pane = mode === 'grid' ? findDropElementAt(SPLIT_VIEW_PANE_ATTRIBUTE, x, y) : area
  return pane
    ? { pane, paneId: mode === 'grid' ? pane.getAttribute(SPLIT_VIEW_PANE_ATTRIBUTE) : null }
    : null
}

function zoneAt(target: DropPane, x: number, y: number): { zone: SplitViewZone; rect: Rect } {
  const rect = target.pane.getBoundingClientRect()
  const zone = fitSplitViewZoneToSize(
    resolveDropZone(rect, { x, y }, EDGE_SHARE),
    splitViewPaneGridSize(target.paneId, rect)
  )
  return { zone, rect }
}

function resolveDrop(
  x: number,
  y: number,
  items: readonly SplitViewItem[],
  pointerCaptured = false
): ResolvedDrop | null {
  const area = items.length > 0 ? dropAreaAt(x, y) : null
  if (!area) {
    return null
  }
  if (area.mode === 'open') {
    return { place: 'open', preview: { kind: 'open', rect: area.areaRect } }
  }
  const dragged = new Set(items.map(splitViewItemKey))
  const strip = findDropElementAt(ITEM_TAB_STRIP_ATTRIBUTE, x, y)
  const stripPaneId = strip?.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE)
  if (strip && stripPaneId) {
    return resolveStripDrop(strip, x, stripPaneId, dragged, pointerCaptured)
  }
  const target = dropPaneAt(area, x, y)
  if (!target) {
    return null
  }
  const { paneId } = target
  const at = zoneAt(target, x, y)
  const held = paneKeys(paneId)
  // Nothing would be left to split from: the drop adds tabs instead.
  const zone = held.every((key) => dragged.has(key)) ? 'center' : at.zone
  // Dropped where it already shows, nothing would change; a tab behind another comes forward.
  if (
    zone === 'center' &&
    [...dragged].every((key) => held.includes(key)) &&
    dragged.has(shownKey(paneId) ?? '')
  ) {
    return null
  }
  return { place: { paneId, zone }, preview: { kind: zone, rect: dropZoneRect(at.rect, zone) } }
}

type ResolvedTabDrop = {
  /** Null where the workspace already shows, or the tab brings none: no pane changes. */
  place: SplitViewDropPlace | 'open' | null
  preview: SplitViewDropPreview
  tab: SplitViewTabPlace
}

/** The workspace a pane, or single view, has in front. */
function shownWorktreeId(paneId: string | null): string | null {
  const shown =
    paneId === null
      ? currentSplitViewItem()
      : activeSplitViewItem(splitViewStore.getState(), paneId)
  return shown?.kind === 'workspace' ? shown.worktreeId : null
}

/**
 * Where a tab lands. One with a workspace of its own brings that along as any item and shows in
 * it; one with none joins the workspace the pane under the pointer shows, on an edge beside its tabs.
 */
function resolveTabDrop(x: number, y: number, worktreeId: string | null): ResolvedTabDrop | null {
  const area = dropAreaAt(x, y)
  const target = area && dropPaneAt(area, x, y)
  if (!area || !target) {
    return null
  }
  if (worktreeId) {
    const workspace = workspaceSplitViewItem({ id: worktreeId })
    const tab: SplitViewTabPlace = { worktreeId, zone: 'center' }
    const drop = resolveDrop(x, y, [workspace])
    if (drop) {
      return { ...drop, tab }
    }
    // Its workspace already shows here: only the tab comes forward.
    return shownKey(target.paneId) === splitViewItemKey(workspace)
      ? { place: null, preview: { kind: 'center', rect: target.pane.getBoundingClientRect() }, tab }
      : null
  }
  const shown = area.mode === 'open' ? null : shownWorktreeId(target.paneId)
  if (shown) {
    const at = zoneAt(target, x, y)
    // On the pane's own strip it is one more tab, as an item dropped there is.
    const zone = findDropElementAt(ITEM_TAB_STRIP_ATTRIBUTE, x, y) ? 'center' : at.zone
    return {
      place: null,
      preview: { kind: zone, rect: dropZoneRect(at.rect, zone) },
      tab: { worktreeId: shown, zone }
    }
  }
  // Home or a project's page shows no workspace: the tab opens in the one last in view.
  const last = useAppStore.getState().activeWorktreeId
  return last
    ? {
        place: null,
        preview: { kind: 'open', rect: area.areaRect },
        tab: { worktreeId: last, zone: 'center' }
      }
    : null
}

/** Shows where a drop would land. False when the main area is not taking the pointer. */
export function trackSplitViewDrop(
  x: number,
  y: number,
  items: readonly SplitViewItem[],
  pointerCaptured = false
): boolean {
  const drop = resolveDrop(x, y, items, pointerCaptured)
  setSplitViewDropPreview(drop?.preview ?? null)
  return drop !== null
}

/** Commits a release at the pointer. False when the main area did not take the drop. */
export function commitSplitViewDrop(
  x: number,
  y: number,
  items: readonly SplitViewItem[],
  activeKey?: string
): boolean {
  const drop = resolveDrop(x, y, items)
  setSplitViewDropPreview(null)
  if (!drop) {
    return false
  }
  const active = items.find((item) => splitViewItemKey(item) === activeKey) ?? items[0]
  if (drop.place === 'open') {
    navigateToSplitViewItem(active)
    return true
  }
  placeItemsInSplitView(items, drop.place, splitViewItemKey(active))
  return true
}

/** Shows where a tab would land; `worktreeId` is the workspace it brings, or null. False when the main area is not taking the pointer. */
export function trackSplitViewTabDrop(x: number, y: number, worktreeId: string | null): boolean {
  const drop = resolveTabDrop(x, y, worktreeId)
  setSplitViewDropPreview(drop?.preview ?? null)
  return drop !== null
}

/** Commits a tab's release: its workspace takes its pane. Returns where the tab opens; null when the main area did not take it. */
export function commitSplitViewTabDrop(
  x: number,
  y: number,
  worktreeId: string | null
): SplitViewTabPlace | null {
  const drop = resolveTabDrop(x, y, worktreeId)
  setSplitViewDropPreview(null)
  if (!drop) {
    return null
  }
  if (worktreeId && drop.place) {
    const workspace = workspaceSplitViewItem({ id: worktreeId })
    if (drop.place === 'open') {
      navigateToSplitViewItem(workspace)
    } else {
      placeItemsInSplitView([workspace], drop.place)
    }
  }
  return drop.tab
}
