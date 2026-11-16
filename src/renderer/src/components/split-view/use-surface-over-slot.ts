import { useLayoutEffect, type RefObject } from 'react'
import { subscribeTabGroupBodyRect } from '../tab-group/tab-group-body-geometry'

const BOX_PROPERTIES = ['display', 'inset', 'top', 'left', 'width', 'height']

/**
 * Lays a retained surface over a slot by writing its box from the slot's rect, so a move, resize,
 * split or maximize re-renders and remounts nothing. With no slot id the surface is left alone.
 */
export function useSurfaceOverSlot(
  surfaceRef: RefObject<HTMLDivElement | null>,
  slotId: string | null
): void {
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const container = surface?.parentElement
    if (!surface || !container) {
      return
    }
    const { style } = surface
    if (!slotId) {
      for (const property of BOX_PROPERTIES) {
        style.removeProperty(property)
      }
      return
    }
    let placed = false
    return subscribeTabGroupBodyRect(slotId, container, (rect) => {
      if (rect) {
        placed = true
        style.display = ''
        style.inset = 'auto'
        style.top = `${rect.top}px`
        style.left = `${rect.left}px`
        style.width = `${rect.width}px`
        style.height = `${rect.height}px`
        return
      }
      // Moving to a slot that is not laid out yet, it keeps the last one's box: hiding it would
      // drop the keyboard focus it holds.
      if (placed || style.width === '') {
        // No slot (the grid is still loading): stay out of layout instead of filling the area.
        style.display = 'none'
      }
    })
  }, [slotId, surfaceRef])
}
