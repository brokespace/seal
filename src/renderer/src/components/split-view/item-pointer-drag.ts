import { setSidebarPointerDragDocumentStyles } from '@/components/sidebar/worktree-list/drag/worktree-sidebar-pointer-drag-dom'
import { PROJECT_HEADER_DRAG_THRESHOLD_PX } from '@/components/sidebar/worktree-list/drag/project-header-drag-contract'
import {
  swallowClickAfterNextRelease,
  swallowNextClickOnDragHandle
} from '@/components/sidebar/worktree-list/drag/header-drag-click-swallow'
import { beginSplitViewPaneDrop, type SplitViewPaneDrop } from './split-view-pane-drop'
import type { SplitViewItem } from './split-view-types'

/**
 * The pointer drag of a sidebar row that only ever lands in panes (an agent session's row). Call
 * from the row's pointer-down. Esc, window blur and a missed release cancel. `onDropped` runs
 * once the main area took the item.
 */
export function startItemPointerDrag(
  event: { button: number; clientX: number; clientY: number },
  source: HTMLElement,
  item: SplitViewItem,
  onDropped?: () => void
): void {
  if (event.button !== 0) {
    return
  }
  const startX = event.clientX
  const startY = event.clientY
  let drop: SplitViewPaneDrop | null = null

  const finish = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', finish)
    if (drop) {
      drop.end()
      setSidebarPointerDragDocumentStyles(false)
      drop = null
    }
  }
  const onMove = (move: PointerEvent): void => {
    // A release the window never saw (over a guest page, or outside) arrives as a buttonless move.
    if (move.buttons === 0) {
      finish()
      return
    }
    if (!drop) {
      if (
        Math.hypot(move.clientX - startX, move.clientY - startY) < PROJECT_HEADER_DRAG_THRESHOLD_PX
      ) {
        return
      }
      // The press may have started a text selection before selection was turned off.
      window.getSelection()?.removeAllRanges()
      setSidebarPointerDragDocumentStyles(true)
      drop = beginSplitViewPaneDrop([item], source, 'everywhere')
    }
    drop.track(move.clientX, move.clientY)
  }
  const onUp = (up: PointerEvent): void => {
    let dropped = false
    if (drop) {
      swallowNextClickOnDragHandle(source)
      // Before the drag ends: ending it brings back a hover card that would cover the drop.
      dropped = drop.commit(up.clientX, up.clientY)
    }
    finish()
    if (dropped) {
      onDropped?.()
    }
  }
  const onKeyDown = (key: KeyboardEvent): void => {
    if (key.key === 'Escape' && drop) {
      key.preventDefault()
      key.stopPropagation()
      finish()
      swallowClickAfterNextRelease(source)
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', finish)
}
