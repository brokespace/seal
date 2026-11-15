import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { TabGroupSplitNodeTree } from './TabGroupSplitNodeTree'
import { WorkspaceTabDragLayer } from './WorkspaceTabDragLayer'

/** Compose main-window chrome around the shared drag scope/tree; other hosts supply their own chrome. */
export default function TabGroupSplitLayout({
  layout,
  worktreeId,
  focusedGroupId,
  isWorktreeActive,
  isWorktreeFocused = isWorktreeActive,
  inSplitViewPane = false
}: {
  layout: TabGroupLayoutNode
  worktreeId: string
  focusedGroupId?: string
  /** The workspace is on screen. */
  isWorktreeActive: boolean
  /** The workspace is the one the keyboard and commands act on. */
  isWorktreeFocused?: boolean
  /** The pane owns the chrome around the tree: no window drag strip, sidebar seam or reserved corners. */
  inSplitViewPane?: boolean
}): React.JSX.Element {
  return (
    <WorkspaceTabDragLayer worktreeId={worktreeId} enabled={isWorktreeActive}>
      {({ isTabDragActive, hoveredTabInsertion, setDragRootNode }) => (
        /* Keep the 4px drag strip outside resize panes to align the 36px header; the wrapper owns the single sidebar seam. */
        <div
          ref={setDragRootNode}
          className={
            inSplitViewPane
              ? 'flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden'
              : 'workspace-sidebar-seam flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden border-l border-border'
          }
        >
          {inSplitViewPane ? null : (
            <div
              className="h-[4px] shrink-0 bg-tab-bar"
              data-terminal-focus-release-surface="true"
            />
          )}
          <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
            <TabGroupSplitNodeTree
              layout={layout}
              worktreeId={worktreeId}
              focusedGroupId={focusedGroupId}
              isWorktreeActive={isWorktreeActive}
              isWorktreeFocused={isWorktreeFocused}
              isTabDragActive={isTabDragActive}
              hoveredTabInsertion={hoveredTabInsertion}
              reservesWindowChromeSpace={!inSplitViewPane}
            />
          </div>
        </div>
      )}
    </WorkspaceTabDragLayer>
  )
}
