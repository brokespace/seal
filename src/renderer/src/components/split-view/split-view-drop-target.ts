import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store/index'
import { liveSessionTabsStore } from '@/components/live-sessions/workspace/live-session-tabs-store'
import { acquireWebviewsDragPassthrough } from '@/components/browser-pane/host-guest/webview-drag-passthrough'
import { isWorkspaceKanbanSidebarDropPointInBoard } from '@/components/sidebar/workspace-board/drag/workspace-kanban-sidebar-drop'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import { resolveDropZone } from '../tab-group/tab-drop-zone'
import {
  currentSplitViewItem,
  navigateToSplitViewItem,
  placeItemsInSplitView,
  type SplitViewDropPlace
} from './split-view-commands'
import { selectItemViewShown } from './split-view-showing'
import { splitViewStore } from './split-view-store'
import {
  SPLIT_VIEW_DROP_AREA_ATTRIBUTE,
  SPLIT_VIEW_PANE_ATTRIBUTE,
  fitSplitViewZoneToSize,
  splitViewPaneGridSize
} from './split-view-pane-size'
import { splitViewItemKey, type SplitViewItem, type SplitViewZone } from './split-view-types'

const SPLIT_VIEW_DRAG_ATTRIBUTE = 'data-split-view-drag'
/** On a strip: its pane id, or empty for the agent-session page's strip in single view. */
export const ITEM_TAB_STRIP_ATTRIBUTE = 'data-item-tab-strip'
export const ITEM_TAB_KEY_ATTRIBUTE = 'data-item-tab-key'

const EDGE_SHARE = 0.3

type Rect = { left: number; top: number; width: number; height: number }

export type SplitViewDropPreview = {
  /** In viewport coordinates. */
  rect: Rect
  kind: SplitViewZone | 'insert' | 'open'
}

type ResolvedDrop = { place: SplitViewDropPlace | 'open'; preview: SplitViewDropPreview }

let preview: SplitViewDropPreview | null = null
const listeners = new Set<() => void>()

function setPreview(next: SplitViewDropPreview | null): void {
  const same =
    next === preview ||
    (next !== null &&
      preview !== null &&
      next.kind === preview.kind &&
      next.rect.left === preview.rect.left &&
      next.rect.top === preview.rect.top &&
      next.rect.width === preview.rect.width &&
      next.rect.height === preview.rect.height)
  if (same) {
    return
  }
  preview = next
  for (const listener of listeners) {
    listener()
  }
}

export function useSplitViewDropPreview(): SplitViewDropPreview | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => preview
  )
}

function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  )
}

function findAt(selector: string, x: number, y: number): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[${selector}]`)) {
    if (contains(element.getBoundingClientRect(), x, y)) {
      return element
    }
  }
  return null
}

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
  if (current?.kind === 'session') {
    return liveSessionTabsStore
      .getState()
      .tabs.map((sessionId) => splitViewItemKey({ kind: 'session', sessionId }))
  }
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

function resolveStripDrop(strip: HTMLElement, x: number, paneId: string | null): ResolvedDrop {
  const stripRect = strip.getBoundingClientRect()
  const tabs = [...strip.querySelectorAll<HTMLElement>(`[${ITEM_TAB_KEY_ATTRIBUTE}]`)]
  let index = tabs.length
  let barLeft = tabs.at(-1)?.getBoundingClientRect().right ?? stripRect.left
  for (const [at, tab] of tabs.entries()) {
    const rect = tab.getBoundingClientRect()
    if (x < rect.left + rect.width / 2) {
      index = at
      barLeft = rect.left
      break
    }
  }
  return {
    place: { paneId, zone: 'center', index },
    preview: {
      kind: 'insert',
      rect: { left: barLeft - 1, top: stripRect.top, width: 2, height: stripRect.height }
    }
  }
}

function resolveDrop(x: number, y: number, items: readonly SplitViewItem[]): ResolvedDrop | null {
  const area = document.querySelector<HTMLElement>(`[${SPLIT_VIEW_DROP_AREA_ATTRIBUTE}]`)
  const mode = dropMode()
  if (!area || !mode || items.length === 0) {
    return null
  }
  const areaRect = area.getBoundingClientRect()
  // The Workspace Board takes the drop while it is open; so does anything else floating above.
  if (!contains(areaRect, x, y) || isWorkspaceKanbanSidebarDropPointInBoard(x, y)) {
    return null
  }
  const hit = document.elementFromPoint(x, y)
  if (!hit || !area.contains(hit)) {
    return null
  }
  if (mode === 'open') {
    return { place: 'open', preview: { kind: 'open', rect: areaRect } }
  }
  const strip = findAt(ITEM_TAB_STRIP_ATTRIBUTE, x, y)
  if (strip) {
    const stripPaneId = strip.getAttribute(ITEM_TAB_STRIP_ATTRIBUTE) || null
    const held = paneKeys(stripPaneId)
    // The agent-session page orders its own tabs; only a pane's strip reorders.
    if (stripPaneId === null && items.every((item) => held.includes(splitViewItemKey(item)))) {
      return null
    }
    return resolveStripDrop(strip, x, stripPaneId)
  }
  const pane = mode === 'grid' ? findAt(SPLIT_VIEW_PANE_ATTRIBUTE, x, y) : area
  if (!pane) {
    return null
  }
  const paneId = mode === 'grid' ? pane.getAttribute(SPLIT_VIEW_PANE_ATTRIBUTE) : null
  const rect = pane.getBoundingClientRect()
  let zone = fitSplitViewZoneToSize(
    resolveDropZone(rect, { x, y }, EDGE_SHARE),
    splitViewPaneGridSize(paneId, rect)
  )
  const dragged = new Set(items.map(splitViewItemKey))
  const held = paneKeys(paneId)
  const leavesNothing = held.every((key) => dragged.has(key))
  // Nothing would be left to split from: the drop adds tabs instead.
  if (leavesNothing) {
    zone = 'center'
  }
  // Dropped where it already shows, nothing would change; a tab behind another comes forward.
  if (
    zone === 'center' &&
    [...dragged].every((key) => held.includes(key)) &&
    dragged.has(shownKey(paneId) ?? '')
  ) {
    return null
  }
  const half = { ...rect, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  if (zone === 'left' || zone === 'right') {
    half.width = rect.width / 2
    half.left = zone === 'left' ? rect.left : rect.left + rect.width / 2
  } else if (zone === 'up' || zone === 'down') {
    half.height = rect.height / 2
    half.top = zone === 'up' ? rect.top : rect.top + rect.height / 2
  }
  return { place: { paneId, zone }, preview: { kind: zone, rect: half } }
}

/** Shows where a drop would land. False when the main area is not taking the pointer. */
export function trackSplitViewDrop(x: number, y: number, items: readonly SplitViewItem[]): boolean {
  const drop = resolveDrop(x, y, items)
  setPreview(drop?.preview ?? null)
  return drop !== null
}

export function clearSplitViewDropPreview(): void {
  setPreview(null)
}

/** Commits a release at the pointer. False when the main area did not take the drop. */
export function commitSplitViewDrop(
  x: number,
  y: number,
  items: readonly SplitViewItem[],
  activeKey?: string
): boolean {
  const drop = resolveDrop(x, y, items)
  setPreview(null)
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

/** Lets the pointer through embedded pages for the length of a drag. Returns the end of it. */
export function beginSplitViewDrag(): () => void {
  const releaseWebviews = acquireWebviewsDragPassthrough()
  // Hover cards open under a held pointer too, and one under it would take the drop.
  document.body.toggleAttribute(SPLIT_VIEW_DRAG_ATTRIBUTE, true)
  return () => {
    releaseWebviews()
    document.body.toggleAttribute(SPLIT_VIEW_DRAG_ATTRIBUTE, false)
    setPreview(null)
  }
}
