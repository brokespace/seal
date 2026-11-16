import { useLayoutEffect, useRef, type RefObject } from 'react'

type Offset = { top: number; left: number }

/**
 * A surface out of sight is `display: none`, which drops every scroll offset inside it. Showing
 * again puts back the ones nothing else restored (a chat transcript returns to its own place).
 */
export function useKeptScrollOffsets(
  surfaceRef: RefObject<HTMLElement | null>,
  showing: boolean
): void {
  const offsets = useRef(new Map<Element, Offset>())
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !showing) {
      return
    }
    const kept = offsets.current
    for (const [element, offset] of kept) {
      if (!element.isConnected) {
        kept.delete(element)
      } else if (element.scrollTop === 0 && element.scrollLeft === 0) {
        element.scrollTo(offset.left, offset.top)
      }
    }
    const record = (event: Event): void => {
      const element = event.target
      if (!(element instanceof Element)) {
        return
      }
      if (!kept.has(element)) {
        // A surface that stays in front does not go on holding what was scrolled and is gone.
        for (const known of kept.keys()) {
          if (!known.isConnected) {
            kept.delete(known)
          }
        }
      }
      kept.set(element, { top: element.scrollTop, left: element.scrollLeft })
    }
    surface.addEventListener('scroll', record, { capture: true, passive: true })
    return () => surface.removeEventListener('scroll', record, { capture: true })
  }, [showing, surfaceRef])
}
