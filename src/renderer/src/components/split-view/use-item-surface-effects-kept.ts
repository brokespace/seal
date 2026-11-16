import { useEffect, useState } from 'react'

/** Longer than the exit animation of a menu or a popover. */
const OVERLAY_EXIT_MS = 1000

/**
 * Whether a surface's effects run: while it is in front, and for a moment after. A menu or a
 * popover it opened is drawn outside it and leaves the page through effects; stopped while one is
 * closing, they would leave it on screen.
 */
export function useItemSurfaceEffectsKept(front: boolean): boolean {
  const [kept, setKept] = useState(front)
  if (front && !kept) {
    setKept(true)
  }
  useEffect(() => {
    if (front) {
      return undefined
    }
    const timer = setTimeout(() => setKept(false), OVERLAY_EXIT_MS)
    return () => clearTimeout(timer)
  }, [front])
  return front || kept
}
