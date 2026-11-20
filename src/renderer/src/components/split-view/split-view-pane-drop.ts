import {
  createSidebarDragPreview,
  updateSidebarDragPreviewPosition
} from '@/components/sidebar/worktree-list/drag/worktree-sidebar-pointer-drag-dom'
import { beginSplitViewDrag } from './split-view-drag-state'
import {
  commitSplitViewDrop,
  commitSplitViewTabDrop,
  trackSplitViewDrop,
  trackSplitViewTabDrop
} from './split-view-drop-target'
import type { SplitViewItem, SplitViewTabPlace } from './split-view-types'

/** What a sidebar drag carries to the panes. `Dropped` is falsy when no pane took it. */
export type SplitViewPaneLoad<Dropped> = {
  count: number
  track: (x: number, y: number, pointerCaptured: boolean) => boolean
  commit: (x: number, y: number) => Dropped
}

export function splitViewItemsLoad(items: readonly SplitViewItem[]): SplitViewPaneLoad<boolean> {
  return {
    count: items.length,
    track: (x, y, pointerCaptured) => trackSplitViewDrop(x, y, items, pointerCaptured),
    commit: (x, y) => commitSplitViewDrop(x, y, items)
  }
}

/** A tab of the workspace `worktreeId`, or with null of whichever workspace the pane it lands in shows. */
export function splitViewTabLoad(
  worktreeId: string | null
): SplitViewPaneLoad<SplitViewTabPlace | null> {
  return {
    count: 1,
    track: (x, y) => trackSplitViewTabDrop(x, y, worktreeId),
    commit: (x, y) => commitSplitViewTabDrop(x, y, worktreeId)
  }
}

/** A sidebar pointer drag's hand-off to split-view panes. */
export type SplitViewPaneDrop<Dropped = boolean> = {
  /** Shows where a release would land. False while the main area is not taking the pointer. */
  track: (x: number, y: number) => boolean
  commit: (x: number, y: number) => Dropped
  end: () => void
}

/**
 * `ghost` says when a copy of the dragged row follows the pointer: `everywhere` for a row that
 * only ever lands in panes, `over-panes` for one the sidebar also reorders with its own line.
 */
export function beginSplitViewPaneDrop<Dropped>(
  load: SplitViewPaneLoad<Dropped>,
  source: HTMLElement,
  ghost: 'everywhere' | 'over-panes'
): SplitViewPaneDrop<Dropped> {
  const endDrag = beginSplitViewDrag()
  let shown: ReturnType<typeof createSidebarDragPreview> | null = null
  const hide = (): void => {
    shown?.preview.remove()
    shown = null
  }
  const follow = (x: number, y: number): void => {
    if (!shown && source.isConnected) {
      shown = createSidebarDragPreview({
        sourceRow: source,
        pointerX: x,
        pointerY: y,
        draggedCount: load.count
      })
      if (ghost === 'over-panes') {
        // Grabbed in the sidebar, the row first shows here: it hangs by the pointer.
        shown.offsetX = 12
        shown.offsetY = 12
      }
    }
    if (shown) {
      updateSidebarDragPreviewPosition({
        preview: shown.preview,
        pointerX: x,
        pointerY: y,
        offsetX: shown.offsetX,
        offsetY: shown.offsetY
      })
    }
  }
  return {
    track: (x, y) => {
      // A header the sidebar reorders captures the pointer for the length of its drag.
      const taken = load.track(x, y, ghost === 'over-panes')
      if (taken || ghost === 'everywhere') {
        follow(x, y)
      } else {
        hide()
      }
      return taken
    },
    commit: load.commit,
    end: () => {
      hide()
      endDrag()
    }
  }
}
