import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { SplitLayoutTree, type SplitLayoutLeafPlacement } from '../tab-group/SplitLayoutTree'
import { measureAllTabGroupBodies } from '../tab-group/tab-group-body-geometry'
import { resizeSplitViewPanes } from './split-view-commands'
import { splitViewStore, useSplitView, useSplitViewNarrow } from './split-view-store'
import { SplitViewPane } from './SplitViewPane'

/** Below two minimum panes side by side the grid shows the focused pane alone. */
const NARROW_WIDTH_PX = 480

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

  const showsOnePane = narrow || state.maximizedPaneId !== null
  const layout = useMemo(
    (): TabGroupLayoutNode | null =>
      showsOnePane && state.focusedPaneId
        ? { type: 'leaf', groupId: state.focusedPaneId }
        : state.layout,
    [showsOnePane, state.focusedPaneId, state.layout]
  )
  // The geometry registry measures on resize; a pane that only changed place must be re-read.
  useLayoutEffect(() => {
    measureAllTabGroupBodies()
  }, [layout])

  const renderLeaf = useCallback(
    (paneId: string, placement: SplitLayoutLeafPlacement) => (
      <SplitViewPane key={paneId} paneId={paneId} placement={placement} />
    ),
    []
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
        rootTouchesBottomEdge
        renderLeaf={renderLeaf}
        onRatioChange={resizeSplitViewPanes}
      />
    </div>
  )
}
