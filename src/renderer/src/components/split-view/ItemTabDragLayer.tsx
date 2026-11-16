import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { TabDragPreviewChip } from '@/components/tab-bar/TabDragPreview'
import { TabDragProvider } from '@/components/tab-group/tab-drag-context'
import { useTabDragGestureLifecycle } from '@/components/tab-group/tab-drag-gesture-lifecycle'
import { getDragPointer } from '@/components/tab-group/tab-drag-pointer'
import { TabDragPointerSensor } from '@/components/tab-group/tab-drag-pointer-sensor'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX } from '@/components/tab-group/useTabDragSplit'
import { isItemTabDragData, ItemTabIcon } from './ItemTab'
import { bringKeyboardFocusIntoFocusedPane } from './pane-keyboard-focus'
import {
  beginSplitViewDrag,
  commitSplitViewDrop,
  trackSplitViewDrop,
  useSplitViewDragActive
} from './split-view-drop-target'
import type { SplitViewItem } from './split-view-types'
import { useResolvedSplitViewItem, useSplitViewItemTitle } from './use-resolved-split-view-item'

const SENSOR_OPTIONS = { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE_PX } }
// Where a tab lands is read from the panes under the pointer, not from the tabs it passes.
const NO_COLLISIONS: CollisionDetection = () => []
// The pointer has to reach the pane under the ghost.
const GHOST_STYLE: React.CSSProperties = { pointerEvents: 'none' }

/** A release the window never saw arrives as a move with no button down; the sensor ends on a cancel. */
function cancelTabDragOnButtonlessMove(): () => void {
  const onMove = (move: PointerEvent): void => {
    if (move.buttons === 0) {
      document.dispatchEvent(new PointerEvent('pointercancel'))
    }
  }
  window.addEventListener('pointermove', onMove)
  return () => window.removeEventListener('pointermove', onMove)
}

function ItemTabDragPreview({ item }: { item: SplitViewItem }): React.JSX.Element {
  const resolved = useResolvedSplitViewItem(item)
  const title = useSplitViewItemTitle(item, resolved)
  return <TabDragPreviewChip icon={<ItemTabIcon item={item} resolved={resolved} />} label={title} />
}

/**
 * The drag of item tabs, on the tab drag every workspace strip uses: its pointer sensor and
 * activation distance, its ghost, and its recovery from a release the window never saw. The
 * panes take the drop the way they take a sidebar row's.
 */
export function ItemTabDragLayer({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [dragged, setDragged] = useState<SplitViewItem | null>(null)
  const draggedRef = useRef<SplitViewItem | null>(null)
  const tabDragActiveRef = useRef(false)
  const endSplitViewDragRef = useRef<(() => void) | null>(null)
  const clearDragStateRef = useRef<() => void>(() => {})
  const { installMissedEndFallback, releaseMissedEndFallback } = useTabDragGestureLifecycle({
    clearDragStateRef,
    tabDragActiveRef
  })
  const sensors = useSensors(useSensor(TabDragPointerSensor, SENSOR_OPTIONS))
  // A sidebar row over the strips changes their drop targets the way a tab does.
  const anyDragActive = useSplitViewDragActive()

  const clearDragState = useCallback(() => {
    // A browser page gave up the keyboard on the press; a drag that moved no focus hands it back.
    if (tabDragActiveRef.current && document.activeElement === document.body) {
      bringKeyboardFocusIntoFocusedPane(false)
    }
    tabDragActiveRef.current = false
    draggedRef.current = null
    releaseMissedEndFallback()
    endSplitViewDragRef.current?.()
    endSplitViewDragRef.current = null
    setDragged(null)
  }, [releaseMissedEndFallback])
  // A layer that goes away under a held tab ends the drag with it.
  useEffect(() => clearDragState, [clearDragState])

  const handlers = useMemo(
    () => ({
      onDragStart: (event: DragStartEvent): void => {
        const data = event.active.data.current
        if (!isItemTabDragData(data)) {
          return
        }
        tabDragActiveRef.current = true
        draggedRef.current = data.item
        const endSplitViewDrag = beginSplitViewDrag()
        const stopCancelOnButtonlessMove = cancelTabDragOnButtonlessMove()
        endSplitViewDragRef.current = () => {
          stopCancelOnButtonlessMove()
          endSplitViewDrag()
        }
        clearDragStateRef.current = clearDragState
        installMissedEndFallback()
        setDragged(data.item)
      },
      onDragMove: (event: DragMoveEvent): void => {
        const pointer = getDragPointer(event)
        if (pointer && draggedRef.current) {
          trackSplitViewDrop(pointer.x, pointer.y, [draggedRef.current])
        }
      },
      onDragEnd: (event: DragEndEvent): void => {
        const pointer = getDragPointer(event)
        const item = draggedRef.current
        // Before the drag ends: ending it brings back a hover card that would cover the drop.
        if (pointer && item) {
          commitSplitViewDrop(pointer.x, pointer.y, [item])
        }
        clearDragState()
      },
      onDragCancel: clearDragState
    }),
    [clearDragState, installMissedEndFallback]
  )

  return (
    <TabDragProvider
      isTabDragActive={dragged !== null || anyDragActive}
      isTabDragActiveRef={tabDragActiveRef}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={NO_COLLISIONS}
        // Disable edge autoscroll: the strip's scroll buttons scroll it under a held tab.
        autoScroll={false}
        {...handlers}
      >
        {children}
        {/* Keep the source tab anchored while a portal ghost follows the cursor beyond the clipped strip. */}
        <DragOverlay dropAnimation={null} style={GHOST_STYLE}>
          {dragged ? <ItemTabDragPreview item={dragged} /> : null}
        </DragOverlay>
      </DndContext>
    </TabDragProvider>
  )
}
