import { useLayoutEffect, type RefObject } from 'react'

const OPENED_BY_POINTING = '[data-slot="hover-card-trigger"], [data-slot="tooltip-trigger"]'

/**
 * The pointer cannot leave what is no longer on screen. A surface that goes behind is told the
 * pointer left it, so a card or tooltip opened by pointing closes and is not there on return.
 */
export function usePointerLeftWhenSurfaceHides(
  surfaceRef: RefObject<HTMLElement | null>,
  front: boolean
): void {
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (front || !surface) {
      return
    }
    for (const trigger of surface.querySelectorAll(OPENED_BY_POINTING)) {
      if (trigger.getAttribute('data-state')?.endsWith('open')) {
        trigger.dispatchEvent(
          new PointerEvent('pointerout', {
            bubbles: true,
            pointerType: 'mouse',
            // The leave stays inside the surface.
            relatedTarget: surface.parentElement
          })
        )
      }
    }
  }, [front, surfaceRef])
}
