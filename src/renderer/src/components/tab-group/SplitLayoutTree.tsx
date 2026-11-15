import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { acquireWebviewsDragPassthrough } from '../browser-pane/host-guest/webview-drag-passthrough'

const MIN_RATIO = 0.15
const MAX_RATIO = 0.85

export function ResizeHandle({
  direction,
  onResizeStart,
  onResizeEnd,
  onRatioChange
}: {
  direction: 'horizontal' | 'vertical'
  onResizeStart: () => void
  onResizeEnd?: () => void
  onRatioChange: (ratio: number) => void
}): React.JSX.Element {
  const isHorizontal = direction === 'horizontal'
  const [dragging, setDragging] = useState(false)
  const activeResizeCleanupRef = useRef<((updateDragging?: boolean) => void) | null>(null)

  useEffect(
    () => () => {
      activeResizeCleanupRef.current?.(false)
    },
    []
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      // Why: a second pointer must not steal or finalize the active gesture.
      if (activeResizeCleanupRef.current) {
        return
      }
      const handle = event.currentTarget
      const container = handle.parentElement
      if (!container) {
        return
      }
      const firstPane = handle.previousElementSibling as HTMLElement | null
      const secondPane = handle.nextElementSibling as HTMLElement | null
      if (!firstPane || !secondPane) {
        return
      }
      onResizeStart()
      setDragging(true)
      handle.setPointerCapture(event.pointerId)
      // Why: a guest page under the first move takes the gesture before capture activates; keep guests click-through.
      const releaseWebviewDragPassthrough = acquireWebviewsDragPassthrough()
      // Why: measure outside pointermove so pane writes never force a readback.
      let rect = container.getBoundingClientRect()
      const resizeObserver = new ResizeObserver(() => {
        rect = container.getBoundingClientRect()
      })
      resizeObserver.observe(container)
      let draggedRatio: number | null = null

      const onPointerMove = (moveEvent: PointerEvent): void => {
        // Why: Linux Chromium delivers pointermove while hasPointerCapture() reports false; own by pointerId only.
        if (moveEvent.pointerId !== event.pointerId) {
          return
        }
        // Why: a release outside the window can arrive as a buttonless move instead of pointerup.
        if (moveEvent.buttons === 0) {
          cleanup()
          return
        }
        const ratio = isHorizontal
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
        const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
        draggedRatio = clamped
        // Write pane styles during drag to avoid 60–120 global store updates per second; commit once on release.
        firstPane.style.flex = `${clamped} 1 0%`
        secondPane.style.flex = `${1 - clamped} 1 0%`
      }

      let cleaned = false
      const cleanup = (updateDragging = true): void => {
        if (cleaned) {
          return
        }
        cleaned = true
        resizeObserver.disconnect()
        releaseWebviewDragPassthrough()
        onResizeEnd?.()
        if (draggedRatio !== null) {
          onRatioChange(draggedRatio)
        }
        if (updateDragging) {
          setDragging(false)
        }
        try {
          if (handle.hasPointerCapture(event.pointerId)) {
            handle.releasePointerCapture(event.pointerId)
          }
        } catch {
          // Best effort: unmount cleanup can run after Chromium has already dropped capture.
        }
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        handle.removeEventListener('lostpointercapture', onLostPointerCapture)
        window.removeEventListener('blur', onWindowBlur)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('pointerdown', onNextPointerDown, true)
        if (activeResizeCleanupRef.current === cleanup) {
          activeResizeCleanupRef.current = null
        }
      }

      const onPointerUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId === event.pointerId) {
          cleanup()
        }
      }

      const onPointerCancel = (cancelEvent: PointerEvent): void => {
        if (cancelEvent.pointerId === event.pointerId) {
          cleanup()
        }
      }

      const onLostPointerCapture = (lostEvent: PointerEvent): void => {
        if (lostEvent.pointerId === event.pointerId) {
          cleanup()
        }
      }

      // Why: a release outside a blurred or hidden window may never arrive; end the gesture so guests take input again.
      const onWindowBlur = (): void => cleanup()
      // Why: a new press of the same pointer anywhere proves the old release was missed; end it before the press is handled.
      const onNextPointerDown = (downEvent: PointerEvent): void => {
        if (downEvent.pointerId === event.pointerId) {
          cleanup()
        }
      }
      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
          cleanup()
        }
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
      handle.addEventListener('lostpointercapture', onLostPointerCapture)
      window.addEventListener('blur', onWindowBlur)
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('pointerdown', onNextPointerDown, true)
      activeResizeCleanupRef.current = cleanup
    },
    [isHorizontal, onRatioChange, onResizeStart, onResizeEnd]
  )

  return (
    <div
      className={`tab-group-split-resize-handle ${
        isHorizontal ? 'is-vertical' : 'is-horizontal'
      }${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}

/** Where a leaf sits in its tree: the edges it touches and the seams a resize handle already draws. */
export type SplitLayoutLeafPlacement = {
  touchesTopEdge: boolean
  touchesRightEdge: boolean
  touchesLeftEdge: boolean
  touchesBottomEdge: boolean
  suppressLeftBorder: boolean
  suppressRightBorder: boolean
  suppressBottomBorder: boolean
}

type SplitLayoutTreeProps = {
  /** Draws one leaf; `groupId` names it in the tree. */
  renderLeaf: (groupId: string, placement: SplitLayoutLeafPlacement) => React.JSX.Element
  /** `nodePath` names the split node ("", "first", "first.second"). */
  onRatioChange: (nodePath: string, ratio: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

function SplitLayoutNode({
  node,
  nodePath,
  placement,
  ...tree
}: SplitLayoutTreeProps & {
  node: TabGroupLayoutNode
  nodePath: string
  placement: SplitLayoutLeafPlacement
}): React.JSX.Element {
  if (node.type === 'leaf') {
    return tree.renderLeaf(node.groupId, placement)
  }

  const isHorizontal = node.direction === 'horizontal'
  const ratio = node.ratio ?? 0.5

  return (
    <div
      className="flex flex-1 min-w-0 min-h-0 overflow-hidden"
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div className="flex min-w-0 min-h-0 overflow-hidden" style={{ flex: `${ratio} 1 0%` }}>
        <SplitLayoutNode
          {...tree}
          node={node.first}
          nodePath={nodePath.length > 0 ? `${nodePath}.first` : 'first'}
          placement={{
            ...placement,
            touchesRightEdge: isHorizontal ? false : placement.touchesRightEdge,
            touchesBottomEdge: isHorizontal ? placement.touchesBottomEdge : false,
            // The resize handle owns the inner seam; pane borders would stack into extra lines.
            suppressRightBorder: isHorizontal ? true : placement.suppressRightBorder,
            suppressBottomBorder: isHorizontal ? placement.suppressBottomBorder : true
          }}
        />
      </div>
      <ResizeHandle
        direction={node.direction}
        onResizeStart={() => tree.onResizeStart?.()}
        onResizeEnd={tree.onResizeEnd}
        onRatioChange={(ratio) => tree.onRatioChange(nodePath, ratio)}
      />
      <div className="flex min-w-0 min-h-0 overflow-hidden" style={{ flex: `${1 - ratio} 1 0%` }}>
        <SplitLayoutNode
          {...tree}
          node={node.second}
          nodePath={nodePath.length > 0 ? `${nodePath}.second` : 'second'}
          placement={{
            ...placement,
            touchesTopEdge: isHorizontal ? placement.touchesTopEdge : false,
            touchesLeftEdge: isHorizontal ? false : placement.touchesLeftEdge,
            suppressLeftBorder: isHorizontal ? true : placement.suppressLeftBorder
          }}
        />
      </div>
    </div>
  )
}

/** Draws any split tree with its resize handles. Host it in a sized flex container or the panes collapse. */
export function SplitLayoutTree({
  layout,
  rootTouchesBottomEdge = false,
  ...tree
}: SplitLayoutTreeProps & {
  layout: TabGroupLayoutNode
  /** True when the host's own chrome bounds the tree's bottom edge (no border-b to paint). */
  rootTouchesBottomEdge?: boolean
}): React.JSX.Element {
  return (
    <SplitLayoutNode
      {...tree}
      node={layout}
      nodePath=""
      placement={{
        touchesTopEdge: true,
        touchesRightEdge: true,
        touchesLeftEdge: true,
        touchesBottomEdge: rootTouchesBottomEdge,
        suppressLeftBorder: false,
        suppressRightBorder: false,
        suppressBottomBorder: false
      }}
    />
  )
}
