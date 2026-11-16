import { useEffect } from 'react'
import type { useTabStripOverflowNavigation } from '@/components/tab-bar/tab-strip-overflow-navigation'
import {
  findTabStripSlot,
  getActiveTabDockSide,
  revealTabStripSlot
} from '@/components/tab-bar/tab-strip-slot-geometry'
import { ITEM_TAB_ROW_ATTRIBUTE } from './split-view-drop-target'

/**
 * Keeps the selected tab in view while its pane narrows. A strip with room for two tabs docks it
 * at an edge; a narrower one, in a pane a splitter squeezed, would leave it scrolled away.
 */
export function useSelectedTabKeptInNarrowingStrip(
  navigation: Pick<
    ReturnType<typeof useTabStripOverflowNavigation>,
    'tabStripRef' | 'subscribeToStripResize'
  >,
  activeKey: string | null
): void {
  const { tabStripRef, subscribeToStripResize } = navigation
  useEffect(() => {
    // The row, not the strip: the strip itself shrinks when a widening row gains scroll buttons.
    const rowWidth = (): number =>
      tabStripRef.current?.closest(`[${ITEM_TAB_ROW_ATTRIBUTE}]`)?.clientWidth ?? 0
    let width = rowWidth()
    return subscribeToStripResize(() => {
      const strip = tabStripRef.current
      if (!strip) {
        return
      }
      const narrowed = rowWidth() < width
      width = rowWidth()
      const slot = narrowed && activeKey !== null ? findTabStripSlot(strip, activeKey) : undefined
      // A docked tab is in view wherever the strip is scrolled to.
      if (slot && getActiveTabDockSide(strip) === null) {
        revealTabStripSlot(strip, slot)
      }
    })
  }, [activeKey, subscribeToStripResize, tabStripRef])
}
