import type { SplitViewDropRect as Rect } from './split-view-drag-state'
import type { SplitViewZone } from './split-view-types'

export function containsDropPoint(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  )
}

/** The first element carrying `attribute` whose box holds the point. */
export function findDropElementAt(attribute: string, x: number, y: number): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    if (containsDropPoint(element.getBoundingClientRect(), x, y)) {
      return element
    }
  }
  return null
}

/** The half of `rect` an edge zone takes; all of it for the center. */
export function dropZoneRect(rect: Rect, zone: SplitViewZone): Rect {
  const half = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  if (zone === 'left' || zone === 'right') {
    half.width = rect.width / 2
    half.left = zone === 'left' ? rect.left : rect.left + rect.width / 2
  } else if (zone === 'up' || zone === 'down') {
    half.height = rect.height / 2
    half.top = zone === 'up' ? rect.top : rect.top + rect.height / 2
  }
  return half
}
