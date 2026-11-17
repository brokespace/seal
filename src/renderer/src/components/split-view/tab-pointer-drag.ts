import { setSidebarPointerDragDocumentStyles } from '@/components/sidebar/worktree-list/drag/worktree-sidebar-pointer-drag-dom'
import { PROJECT_HEADER_DRAG_THRESHOLD_PX } from '@/components/sidebar/worktree-list/drag/project-header-drag-contract'
import {
  swallowClickAfterNextRelease,
  swallowNextClickOnDragHandle
} from '@/components/sidebar/worktree-list/drag/header-drag-click-swallow'
import {
  beginSplitViewPaneDrop,
  splitViewTabLoad,
  type SplitViewPaneDrop
} from './split-view-pane-drop'
import type { SplitViewTabPlace } from './split-view-types'

/**
 * The pointer drag of a sidebar row that opens as a tab (an agent session's row) and only ever
 * lands in panes. `worktreeId` is the workspace the tab is in, which the drag brings along; null
 * for a tab of no workspace, which joins the one it is dropped on. Call from the row's
 * pointer-down. Esc, window blur and a missed release cancel. `onDropped` runs once the main area
 * took it, with where the tab opens.
 */
export function startTabPointerDrag(
  event: { button: number; clientX: number; clientY: number },
  source: HTMLElement,
  worktreeId: string | null,
  onDropped: (place: SplitViewTabPlace) => void
): void {
  if (event.button !== 0) {
    return
  }
  const startX = event.clientX
  const startY = event.clientY
  let drop: SplitViewPaneDrop<SplitViewTabPlace | null> | null = null

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
      drop = beginSplitViewPaneDrop(splitViewTabLoad(worktreeId), source, 'everywhere')
    }
    drop.track(move.clientX, move.clientY)
  }
  const onUp = (up: PointerEvent): void => {
    let dropped: SplitViewTabPlace | null = null
    if (drop) {
      swallowNextClickOnDragHandle(source)
      // Before the drag ends: ending it brings back a hover card that would cover the drop.
      dropped = drop.commit(up.clientX, up.clientY)
    }
    finish()
    if (dropped) {
      onDropped(dropped)
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
