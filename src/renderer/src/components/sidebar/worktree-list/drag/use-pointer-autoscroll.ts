import { useCallback, useRef } from 'react'
import type React from 'react'
import { getWorktreeSidebarDragAutoscroll } from './worktree-sidebar-drag-autoscroll'
import {
  haveWorktreeRowsMoved,
  measureWorktreeRowsAutoscrollView,
  scrollWorktreeRowsForDrag
} from './worktree-rows-drag-view'
import type { WorktreeDragRuntime } from './use-runtime'
import type { WorktreeDragSession } from './use-session'
import type { WorktreePointerDrag } from './row-state'

// Refresh drag geometry on each autoscrolled frame so the insertion line tracks the correct row.
export function useWorktreePointerDragAutoscroll(args: {
  session: WorktreeDragSession
  runtime: WorktreeDragRuntime
  scrollRef: React.RefObject<HTMLDivElement | null>
  markScrollMovement: () => void
  scheduleWorktreePointerDragFrame: (drag: WorktreePointerDrag) => void
}): () => void {
  const { session, runtime, scrollRef, markScrollMovement, scheduleWorktreePointerDragFrame } = args
  const {
    worktreePointerDragRef,
    pointerAutoscrollFrameIdRef,
    pointerAutoscrollLastFrameTimeRef,
    cancelWorktreePointerAutoscroll,
    clearWorktreeDrag
  } = runtime

  const rowsGeometryKeyRef = useRef<string | null>(null)
  const runFrame = useCallback(
    (frameTime: number) => {
      pointerAutoscrollFrameIdRef.current = null
      const drag = worktreePointerDragRef.current
      const container = scrollRef.current
      const dragSession = session.worktreeDragSessionRef.current
      if (!drag?.active || !container || !dragSession) {
        cancelWorktreePointerAutoscroll()
        return
      }

      const previousFrameTime = pointerAutoscrollLastFrameTimeRef.current ?? frameTime
      pointerAutoscrollLastFrameTimeRef.current = frameTime
      const autoscroll = getWorktreeSidebarDragAutoscroll({
        point: { clientX: drag.currentX, clientY: drag.currentY },
        ...measureWorktreeRowsAutoscrollView(container),
        elapsedMs: frameTime - previousFrameTime
      })
      if (autoscroll) {
        markScrollMovement()
        scrollWorktreeRowsForDrag(container, autoscroll.scrollTop)
      }
      if (haveWorktreeRowsMoved(container, rowsGeometryKeyRef)) {
        if (!session.refreshWorktreeDragSession()) {
          clearWorktreeDrag()
          return
        }
        scheduleWorktreePointerDragFrame(drag)
      }

      pointerAutoscrollFrameIdRef.current = window.requestAnimationFrame(runFrame)
    },
    [
      cancelWorktreePointerAutoscroll,
      clearWorktreeDrag,
      markScrollMovement,
      pointerAutoscrollFrameIdRef,
      pointerAutoscrollLastFrameTimeRef,
      scheduleWorktreePointerDragFrame,
      scrollRef,
      session,
      worktreePointerDragRef
    ]
  )

  return useCallback(() => {
    if (pointerAutoscrollFrameIdRef.current !== null) {
      return
    }
    pointerAutoscrollLastFrameTimeRef.current = null
    pointerAutoscrollFrameIdRef.current = window.requestAnimationFrame(runFrame)
  }, [pointerAutoscrollFrameIdRef, pointerAutoscrollLastFrameTimeRef, runFrame])
}
