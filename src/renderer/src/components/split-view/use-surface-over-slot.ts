import { useLayoutEffect, type RefObject } from 'react'
import { subscribeTabGroupBodyRect } from '../tab-group/tab-group-body-geometry'

const BOX_PROPERTIES = ['display', 'inset', 'top', 'left', 'width', 'height']

/**
 * Lays a retained surface over a slot by writing its box from the slot's rect, so a move, resize,
 * split or maximize re-renders and remounts nothing. With no slot id the surface gets its own
 * box back, or keeps the slot's (`keepsBox`) to have a size to scroll in when it shows again.
 */
export function useSurfaceOverSlot(
  surfaceRef: RefObject<HTMLDivElement | null>,
  slotId: string | null,
  keepsBox = false
): void {
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const container = surface?.parentElement
    if (!surface || !container) {
      return
    }
    const { style } = surface
    if (!slotId) {
      for (const property of keepsBox ? [] : BOX_PROPERTIES) {
        style.removeProperty(property)
      }
      return
    }
    let placed = false
    let slotLaidOut = false
    let subscribed = true
    const unsubscribe = subscribeTabGroupBodyRect(slotId, container, (rect) => {
      slotLaidOut = rect !== null
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
        // The slot it leaves is gone before this render tells it of the next one: wait for that.
        queueMicrotask(() => {
          if (subscribed && !slotLaidOut) {
            // No slot (the grid is still loading): stay out of layout instead of filling the area.
            style.display = 'none'
          }
        })
      }
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [slotId, surfaceRef, keepsBox])
}
