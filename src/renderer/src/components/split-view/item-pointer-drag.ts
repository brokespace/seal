import {
  createSidebarDragPreview,
  setSidebarPointerDragDocumentStyles,
  updateSidebarDragPreviewPosition
} from '@/components/sidebar/worktree-list/drag/worktree-sidebar-pointer-drag-dom'
import { swallowNextClickOnDragHandle } from '@/components/sidebar/worktree-list/drag/header-drag-click-swallow'
import {
  beginSplitViewDrag,
  commitSplitViewDrop,
  trackSplitViewDrop
} from './split-view-drop-target'
import { splitViewItemKey, type SplitViewItem } from './split-view-types'

/** The sidebar's own threshold, so every row and tab starts dragging at the same distance. */
const DRAG_THRESHOLD_PX = 4

/**
 * One pointer drag for things that only ever land in panes: Active agents rows and tabs in an
 * item strip. Call from the source's pointer-down. Esc and window blur cancel.
 */
export function startItemPointerDrag(
  event: { button: number; clientX: number; clientY: number },
  source: HTMLElement,
  item: SplitViewItem
): void {
  if (event.button !== 0) {
    return
  }
  const items = [item]
  const startX = event.clientX
  const startY = event.clientY
  let drag: { preview: HTMLElement; offsetX: number; offsetY: number; end: () => void } | null =
    null

  const finish = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', finish)
    if (drag) {
      drag.preview.remove()
      drag.end()
      setSidebarPointerDragDocumentStyles(false)
      drag = null
    }
  }
  const onMove = (move: PointerEvent): void => {
    if (!drag) {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) {
        return
      }
      // The press may have started a text selection before selection was turned off.
      window.getSelection()?.removeAllRanges()
      const end = beginSplitViewDrag()
      setSidebarPointerDragDocumentStyles(true)
      drag = {
        ...createSidebarDragPreview({
          sourceRow: source,
          pointerX: move.clientX,
          pointerY: move.clientY,
          draggedCount: 1
        }),
        end
      }
    }
    updateSidebarDragPreviewPosition({
      preview: drag.preview,
      pointerX: move.clientX,
      pointerY: move.clientY,
      offsetX: drag.offsetX,
      offsetY: drag.offsetY
    })
    trackSplitViewDrop(move.clientX, move.clientY, items)
  }
  const onUp = (up: PointerEvent): void => {
    const dragged = drag !== null
    finish()
    if (dragged) {
      swallowNextClickOnDragHandle(source)
      commitSplitViewDrop(up.clientX, up.clientY, items, splitViewItemKey(item))
    }
  }
  const onKeyDown = (key: KeyboardEvent): void => {
    if (key.key === 'Escape' && drag) {
      key.preventDefault()
      key.stopPropagation()
      finish()
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', finish)
}
