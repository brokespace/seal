import { readScrollSectionLayout } from '../viewport/scroll-section-insets'

type DragViewRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** Scroll offset of the first row pixel on screen: rows start below the sections sharing the list, and scroll under the pinned Projects header. */
export function measureWorktreeRowsViewTop(container: HTMLElement): number {
  const { margin, pinned } = readScrollSectionLayout(container)
  // 1px more under a pinned header keeps a drop line's upper half out from under it.
  return pinned === 0 ? container.scrollTop : Math.max(margin, container.scrollTop + pinned) + 1
}

/** The list's box for drag autoscroll: its top edge is the Projects header's bottom once that header is pinned over the rows. */
export function measureWorktreeRowsAutoscrollRect(container: HTMLElement): DragViewRect {
  const rect = container.getBoundingClientRect()
  const { margin, pinned } = readScrollSectionLayout(container)
  const headerIsPinned = pinned > 0 && container.scrollTop + pinned >= margin
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top + (headerIsPinned ? pinned : 0),
    bottom: rect.bottom
  }
}
