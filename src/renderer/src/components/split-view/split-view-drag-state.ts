import { useSyncExternalStore } from 'react'
import { acquireWebviewsDragPassthrough } from '@/components/browser-pane/host-guest/webview-drag-passthrough'
import type { HoveredTabInsertion } from '../tab-group/tab-insertion'
import type { SplitViewZone } from './split-view-types'

const SPLIT_VIEW_DRAG_ATTRIBUTE = 'data-split-view-drag'

export type SplitViewDropRect = { left: number; top: number; width: number; height: number }

export type SplitViewDropPreview = {
  /** In viewport coordinates. */
  rect: SplitViewDropRect
  kind: SplitViewZone | 'insert' | 'open'
  /** For `insert`: the tab the pointer is on and the side of it, in the strip `groupId` names. */
  insertion?: HoveredTabInsertion
}

let preview: SplitViewDropPreview | null = null
let dragCount = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSplitViewDropPreview(next: SplitViewDropPreview | null): void {
  const same =
    next === preview ||
    (next !== null &&
      preview !== null &&
      next.kind === preview.kind &&
      next.rect.left === preview.rect.left &&
      next.rect.top === preview.rect.top &&
      next.rect.width === preview.rect.width &&
      next.rect.height === preview.rect.height &&
      next.insertion?.groupId === preview.insertion?.groupId &&
      next.insertion?.visibleTabId === preview.insertion?.visibleTabId &&
      next.insertion?.side === preview.insertion?.side)
  if (same) {
    return
  }
  preview = next
  notify()
}

export function useSplitViewDropPreview(): SplitViewDropPreview | null {
  return useSyncExternalStore(subscribe, () => preview)
}

/** Something is being dragged towards the panes: a sidebar row, a project, or a tab. */
export function useSplitViewDragActive(): boolean {
  return useSyncExternalStore(subscribe, () => dragCount > 0)
}

/** Lets the pointer through embedded pages for the length of a drag. Returns the end of it. */
export function beginSplitViewDrag(): () => void {
  const releaseWebviews = acquireWebviewsDragPassthrough()
  // Hover cards open under a held pointer too, and one under it would take the drop.
  document.body.toggleAttribute(SPLIT_VIEW_DRAG_ATTRIBUTE, true)
  dragCount += 1
  notify()
  let ended = false
  return () => {
    if (ended) {
      return
    }
    ended = true
    releaseWebviews()
    dragCount -= 1
    document.body.toggleAttribute(SPLIT_VIEW_DRAG_ATTRIBUTE, dragCount > 0)
    preview = null
    notify()
  }
}
