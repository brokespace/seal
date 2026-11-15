import {
  requestVirtualizedScrollAnchorRecord,
  supersedeVirtualizedScrollAnchorRestore
} from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { readScrollSectionLayout } from '../viewport/scroll-section-insets'

type DragViewRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** Scroll offset of the first row pixel on screen: rows start below the sections sharing the list, and scroll under the pinned Projects header. */
export function measureWorktreeRowsViewTop(container: HTMLElement): number {
  const { margin, pinned } = readScrollSectionLayout(container)
  // 1px more under a pinned header keeps a drop line's upper half out from under it.
  return pinned === 0 ? container.scrollTop : Math.max(margin, container.scrollTop + pinned) + 1
}

type DragAutoscrollView = {
  containerRect: DragViewRect
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  minScrollTop: number
}

/** What a drag autoscrolls: the rows only. The top edge is the Projects header's bottom once it is pinned, and scrolling up ends where Projects begins. */
export function measureWorktreeRowsAutoscrollView(container: HTMLElement): DragAutoscrollView {
  const rect = container.getBoundingClientRect()
  const { margin, pinned } = readScrollSectionLayout(container)
  const headerIsPinned = pinned > 0 && container.scrollTop + pinned >= margin
  return {
    containerRect: {
      left: rect.left,
      right: rect.right,
      top: rect.top + (headerIsPinned ? pinned : 0),
      bottom: rect.bottom
    },
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    minScrollTop: margin - pinned
  }
}

/** Scroll the list for a drag; the position it lands on replaces any the list was about to restore. */
export function scrollWorktreeRowsForDrag(container: HTMLElement, scrollTop: number): void {
  supersedeVirtualizedScrollAnchorRestore(container, scrollTop)
  container.scrollTop = scrollTop
  requestVirtualizedScrollAnchorRecord(container)
}

/** True once each time the rows have moved under a still pointer: the list scrolled, or a section above the rows resized. */
export function haveWorktreeRowsMoved(
  container: HTMLElement,
  lastGeometryKey: { current: string | null }
): boolean {
  const key = `${container.scrollTop}:${readScrollSectionLayout(container).margin}`
  const moved = key !== lastGeometryKey.current
  lastGeometryKey.current = key
  return moved
}
