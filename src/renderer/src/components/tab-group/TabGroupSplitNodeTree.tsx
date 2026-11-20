import { useCallback } from 'react'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import TabGroupPanel, { type TabGroupPanelTabStrip } from './TabGroupPanel'
import type { HoveredTabInsertion } from './useTabDragSplit'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { setGroupRatioThroughLayoutOwner } from './tab-group-layout-owner-commands'
import { SplitLayoutTree, type SplitLayoutLeafPlacement } from './SplitLayoutTree'

/** Host this chrome-free tree in a sized flex container or panes collapse; the host owns drag scope and outer seams. */
export function TabGroupSplitNodeTree({
  layout,
  worktreeId,
  focusedGroupId,
  isWorktreeActive,
  isWorktreeFocused = isWorktreeActive,
  isTabDragActive,
  hoveredTabInsertion,
  tabStrip = 'attached',
  markdownAnnotationsEnabled = true,
  rootTouchesBottomEdge = false,
  reservesWindowChromeSpace = true
}: {
  layout: TabGroupLayoutNode
  worktreeId: string
  focusedGroupId?: string
  /** The workspace is on screen. */
  isWorktreeActive: boolean
  /** The workspace is the one the keyboard and commands act on; several can be on screen. */
  isWorktreeFocused?: boolean
  isTabDragActive: boolean
  hoveredTabInsertion: HoveredTabInsertion | null
  tabStrip?: TabGroupPanelTabStrip
  /** Off for scratch workspaces (the floating panel) whose markdown is not a review surface. */
  markdownAnnotationsEnabled?: boolean
  /** True when the host's own chrome bounds the tree's bottom edge (no border-b to paint). */
  rootTouchesBottomEdge?: boolean
  /** Off where the tree's top corners are not the window's (a split-view pane). */
  reservesWindowChromeSpace?: boolean
}): React.JSX.Element {
  const setTabGroupSplitRatio = useAppStore((state) => state.setTabGroupSplitRatio)
  const recordFeatureInteraction = useAppStore((state) => state.recordFeatureInteraction)
  const hasSplitGroups = layout.type === 'split'

  const renderLeaf = useCallback(
    (groupId: string, placement: SplitLayoutLeafPlacement) => (
      <TabGroupPanel
        groupId={groupId}
        worktreeId={worktreeId}
        isVisible={isWorktreeActive}
        // Retain hidden PTYs/layouts, but grant global terminal shortcuts only to the focused workspace's focused group.
        isFocused={isWorktreeFocused && groupId === focusedGroupId}
        hasSplitGroups={hasSplitGroups}
        tabStrip={tabStrip}
        markdownAnnotationsEnabled={markdownAnnotationsEnabled}
        touchesRightEdge={placement.touchesRightEdge}
        touchesLeftEdge={placement.touchesLeftEdge}
        touchesBottomEdge={placement.touchesBottomEdge}
        suppressLeftBorder={placement.suppressLeftBorder}
        suppressRightBorder={placement.suppressRightBorder}
        suppressBottomBorder={placement.suppressBottomBorder}
        reserveClosedExplorerToggleSpace={
          reservesWindowChromeSpace && placement.touchesTopEdge && placement.touchesRightEdge
        }
        reserveCollapsedSidebarHeaderSpace={
          reservesWindowChromeSpace && placement.touchesTopEdge && placement.touchesLeftEdge
        }
        isTabDragActive={isTabDragActive}
        hoveredTabInsertion={hoveredTabInsertion?.groupId === groupId ? hoveredTabInsertion : null}
      />
    ),
    [
      focusedGroupId,
      hasSplitGroups,
      hoveredTabInsertion,
      isTabDragActive,
      isWorktreeActive,
      isWorktreeFocused,
      markdownAnnotationsEnabled,
      reservesWindowChromeSpace,
      tabStrip,
      worktreeId
    ]
  )
  const commitRatio = useCallback(
    (nodePath: string, ratio: number) =>
      ORCA_LAYOUT_OWNER_IS_MAIN
        ? setGroupRatioThroughLayoutOwner(worktreeId, nodePath, ratio)
        : setTabGroupSplitRatio(worktreeId, nodePath, ratio),
    [setTabGroupSplitRatio, worktreeId]
  )
  const recordResize = useCallback(
    () => recordFeatureInteraction('terminal-panes'),
    [recordFeatureInteraction]
  )

  return (
    <SplitLayoutTree
      layout={layout}
      rootTouchesBottomEdge={rootTouchesBottomEdge}
      renderLeaf={renderLeaf}
      onRatioChange={commitRatio}
      onResizeStart={recordResize}
    />
  )
}
