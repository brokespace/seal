import {
  createSidebarDragPreview,
  updateSidebarDragPreviewPosition
} from '@/components/sidebar/worktree-list/drag/worktree-sidebar-pointer-drag-dom'
import {
  beginSplitViewDrag,
  commitSplitViewDrop,
  trackSplitViewDrop
} from './split-view-drop-target'
import type { SplitViewItem } from './split-view-types'

/** A sidebar pointer drag's hand-off to split-view panes. */
export type SplitViewPaneDrop = {
  /** Shows where a release would land. False while the main area is not taking the pointer. */
  track: (x: number, y: number) => boolean
  /** Commits a release. False when no pane took the items. */
  commit: (x: number, y: number) => boolean
  end: () => void
}

/**
 * `ghost` says when a copy of the dragged row follows the pointer: `everywhere` for a row that
 * only ever lands in panes, `over-panes` for one the sidebar also reorders with its own line.
 */
export function beginSplitViewPaneDrop(
  items: readonly SplitViewItem[],
  source: HTMLElement,
  ghost: 'everywhere' | 'over-panes'
): SplitViewPaneDrop {
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
        draggedCount: items.length
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
      const taken = trackSplitViewDrop(x, y, items)
      if (taken || ghost === 'everywhere') {
        follow(x, y)
      } else {
        hide()
      }
      return taken
    },
    commit: (x, y) => commitSplitViewDrop(x, y, items),
    end: () => {
      hide()
      endDrag()
    }
  }
}
