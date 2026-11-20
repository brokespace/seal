import { useCallback, useLayoutEffect, type RefObject } from 'react'
import { declineLateWorkspaceFocus, holdKeyboardFocusForSurfacePress } from './pane-keyboard-focus'
import { reportWorkspaceSurfaceInPane } from './pane-workspace-surfaces'
import { focusSplitViewPane } from './split-view-commands'
import { useSurfaceOverSlot } from './use-surface-over-slot'

type PaneFocusHandlers = {
  onPointerDownCapture?: () => void
  onFocusCapture?: (event: React.FocusEvent<HTMLElement>) => void
}

const NO_HANDLERS: PaneFocusHandlers = {}

/**
 * Lays a retained workspace surface over its pane's slot. The slot is click-through, so a press
 * or focus inside the surface is what focuses the pane.
 */
export function useWorkspaceSurfacePaneSlot(
  surfaceRef: RefObject<HTMLDivElement | null>,
  paneId: string | null,
  worktreeId: string
): PaneFocusHandlers {
  useSurfaceOverSlot(surfaceRef, paneId)
  useLayoutEffect(
    () => (paneId ? reportWorkspaceSurfaceInPane(worktreeId) : undefined),
    [paneId, worktreeId]
  )

  const focusPane = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      if (paneId && !declineLateWorkspaceFocus(paneId, event)) {
        focusSplitViewPane(paneId)
      }
    },
    [paneId]
  )
  const pressPane = useCallback(() => {
    if (paneId) {
      holdKeyboardFocusForSurfacePress(paneId)
      focusSplitViewPane(paneId)
    }
  }, [paneId])
  return paneId ? { onPointerDownCapture: pressPane, onFocusCapture: focusPane } : NO_HANDLERS
}
