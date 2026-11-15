import { useCallback, useLayoutEffect, type RefObject } from 'react'
import { subscribeTabGroupBodyRect } from '../tab-group/tab-group-body-geometry'
import { reportWorkspaceSurfaceInPane } from './pane-workspace-surfaces'
import { focusSplitViewPane } from './split-view-commands'

type PaneFocusHandlers = {
  onPointerDownCapture?: () => void
  onFocusCapture?: () => void
}

const NO_HANDLERS: PaneFocusHandlers = {}

/**
 * Lays a retained workspace surface over its pane's slot by writing its box from the slot's rect,
 * so a move, resize, split or maximize re-renders and remounts nothing. The slot is click-through,
 * so a press or focus inside the surface is what focuses the pane.
 */
export function useWorkspaceSurfacePaneSlot(
  surfaceRef: RefObject<HTMLDivElement | null>,
  paneId: string | null,
  worktreeId: string
): PaneFocusHandlers {
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const container = surface?.parentElement
    if (!surface || !container || !paneId) {
      return
    }
    const stopReporting = reportWorkspaceSurfaceInPane(worktreeId)
    const { style } = surface
    const stopFollowing = subscribeTabGroupBodyRect(paneId, container, (rect) => {
      if (!rect) {
        // No slot yet (the grid is still loading): stay out of layout instead of filling the area.
        style.display = 'none'
        return
      }
      style.display = ''
      style.inset = 'auto'
      style.top = `${rect.top}px`
      style.left = `${rect.left}px`
      style.width = `${rect.width}px`
      style.height = `${rect.height}px`
    })
    return () => {
      stopFollowing()
      stopReporting()
      for (const property of ['display', 'inset', 'top', 'left', 'width', 'height']) {
        style.removeProperty(property)
      }
    }
  }, [paneId, surfaceRef, worktreeId])

  const focusPane = useCallback(() => {
    if (paneId) {
      focusSplitViewPane(paneId)
    }
  }, [paneId])
  return paneId ? { onPointerDownCapture: focusPane, onFocusCapture: focusPane } : NO_HANDLERS
}
