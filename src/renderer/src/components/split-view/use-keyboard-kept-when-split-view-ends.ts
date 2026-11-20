import { useEffect, useRef, type RefObject } from 'react'
import { bringKeyboardFocusIntoSingleViewItem } from './pane-keyboard-focus'

/** The grid and the page that follows it may not arrive in one render. */
const SPLIT_VIEW_END_SETTLE_MS = 1000

/**
 * Closing the focused pane ends split view on the project of the other pane. The keyboard went
 * with the closed pane; it belongs in what is shown now.
 */
export function useKeyboardKeptWhenSplitViewEnds(
  surfaceRef: RefObject<HTMLElement | null>,
  paneId: string | null,
  front: boolean
): void {
  const inPaneRef = useRef(paneId !== null)
  const leftGridAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (inPaneRef.current && paneId === null) {
      leftGridAtRef.current = performance.now()
    }
    inPaneRef.current = paneId !== null
    const leftGridAt = leftGridAtRef.current
    if (paneId !== null || !front || leftGridAt === null) {
      return
    }
    leftGridAtRef.current = null
    if (performance.now() - leftGridAt < SPLIT_VIEW_END_SETTLE_MS && surfaceRef.current) {
      bringKeyboardFocusIntoSingleViewItem(surfaceRef.current)
    }
  }, [front, paneId, surfaceRef])
}
