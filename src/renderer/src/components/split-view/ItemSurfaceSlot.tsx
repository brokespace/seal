import { useLayoutEffect, useRef } from 'react'
import { registerTabGroupBody } from '../tab-group/tab-group-body-geometry'

/** The one slot single view has: the project page's. */
export const SINGLE_VIEW_ITEM_SLOT_ID = 'single-view'
/** On a project's surface: the pane it is in front of. */
export const ITEM_SURFACE_PANE_ATTRIBUTE = 'data-item-surface-pane-id'

/**
 * Where a project shows. It is not rendered here: the item surface layer lays it
 * over this empty slot, so a layout that changes around it never remounts it.
 */
export function ItemSurfaceSlot({
  slotId = SINGLE_VIEW_ITEM_SLOT_ID,
  children
}: {
  /** A pane id in the grid. */
  slotId?: string
  /** Drawn over the surface: why there is nothing to show. */
  children?: React.ReactNode
}): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    () => (slotRef.current ? registerTabGroupBody(slotId, slotRef.current) : undefined),
    [slotId]
  )
  return (
    <div ref={slotRef} data-item-surface-slot="" className="relative min-h-0 min-w-0 flex-1">
      {children}
    </div>
  )
}
