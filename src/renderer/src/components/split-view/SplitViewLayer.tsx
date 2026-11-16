import { useCallback, useLayoutEffect, useRef } from 'react'
import { SplitLayoutTree, type SplitLayoutLeafPlacement } from '../tab-group/SplitLayoutTree'
import { measureAllTabGroupBodies } from '../tab-group/tab-group-body-geometry'
import { bringKeyboardFocusIntoFocusedPane } from './pane-keyboard-focus'
import { resizeSplitViewPanes } from './split-view-commands'
import { splitViewStore, useSplitView, useSplitViewNarrow } from './split-view-store'
import { SplitViewPane } from './SplitViewPane'

/** Below two minimum panes side by side the grid shows the focused pane alone. */
const NARROW_WIDTH_PX = 480

// A browser page gives up the keyboard on any press outside it, a splitter's included.
function returnKeyboardAfterResize(): void {
  bringKeyboardFocusIntoFocusedPane(false)
}

/**
 * The grid of panes, laid over the workbench. Its root takes no pointer events: a workspace
 * pane's slot is empty and click-through, so the workspace surface beneath gets the pointer.
 */
export default function SplitViewLayer(): React.JSX.Element | null {
  const state = useSplitView()
  const narrow = useSplitViewNarrow()
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      splitViewStore.setNarrow(entry.contentRect.width < NARROW_WIDTH_PX)
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      splitViewStore.setNarrow(false)
    }
  }, [])

  const { layout } = state
  // Maximized or too narrow: the focused pane alone. The others stay mounted, so a session keeps
  // its draft and its place in the transcript.
  const soloPaneId = narrow || state.maximizedPaneId !== null ? state.focusedPaneId : null
  // Nothing to maximize over: one pane, or a main area that already shows one alone.
  const canMaximize = layout?.type === 'split' && (!narrow || state.maximizedPaneId !== null)
  // The geometry registry measures on resize; a pane that only changed place must be re-read.
  useLayoutEffect(() => {
    measureAllTabGroupBodies()
  }, [layout, soloPaneId])

  const renderLeaf = useCallback(
    (paneId: string, placement: SplitLayoutLeafPlacement) => (
      <SplitViewPane
        key={paneId}
        paneId={paneId}
        placement={placement}
        shown={soloPaneId === null || soloPaneId === paneId}
        canMaximize={canMaximize}
      />
    ),
    [soloPaneId, canMaximize]
  )

  if (!layout) {
    return null
  }
  return (
    <div
      ref={rootRef}
      data-split-view-layer=""
      className="split-view-layer pointer-events-none absolute inset-0 flex min-h-0 min-w-0"
    >
      <SplitLayoutTree
        layout={layout}
        soloLeafId={soloPaneId}
        rootTouchesBottomEdge
        renderLeaf={renderLeaf}
        onRatioChange={resizeSplitViewPanes}
        onResizeEnd={returnKeyboardAfterResize}
      />
    </div>
  )
}
