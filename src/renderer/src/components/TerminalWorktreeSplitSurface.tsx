import React, { useRef } from 'react'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import type { ActivityTerminalPortalTarget } from './activity/activity-terminal-portal'
import {
  useBrowserGuestPaintRetention,
  useWorktreeBrowserPageIds
} from './browser-pane/host-guest/browser-guest-paint-retention'
import {
  shouldKeepHiddenWorktreeSurfacePaintable,
  shouldMountRetainedBrowserOverlay
} from './browser-pane/host-guest/browser-worktree-surface-paintability'
import TabGroupSplitLayout from './tab-group/TabGroupSplitLayout'
import { WorkspacePaneOverlayLayers } from './WorkspacePaneOverlayLayers'
import type { TerminalPrewarmStage } from './terminal/terminal-worktree-prewarm'
import { useWorkspaceSurfacePaneSlot } from './split-view/use-workspace-surface-pane-slot'
import { WorkspaceFileTreePanel } from './workspace-file-tree/WorkspaceFileTreePanel'

export const WorktreeSplitSurface = React.memo(function WorktreeSplitSurface({
  worktreeId,
  worktreePath,
  layout,
  focusedGroupId,
  isVisible,
  isFocused,
  paneId,
  shouldMeasureHiddenWorktree,
  prewarmStage,
  shouldColdParkTerminalPanes,
  isForceParked,
  activityTerminalPortals,
  backgroundMountTabIds,
  activationDeferredMountTabIds
}: {
  worktreeId: string
  worktreePath: string
  layout: TabGroupLayoutNode
  focusedGroupId?: string
  /** On screen: the single view's workspace, or the active chip of a visible split-view pane. */
  isVisible: boolean
  /** The workspace the keyboard and commands act on. */
  isFocused: boolean
  /** The split-view pane whose slot this surface is laid over; null fills the area. */
  paneId: string | null
  shouldMeasureHiddenWorktree: boolean
  /** Hover intent: mount, then lay out, then render the revealable terminals while hidden. */
  prewarmStage: TerminalPrewarmStage | null
  shouldColdParkTerminalPanes: boolean
  isForceParked: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
}): React.JSX.Element {
  const browserPageIds = useWorktreeBrowserPageIds(worktreeId)
  const needsBrowserGuestPaint = useBrowserGuestPaintRetention(browserPageIds)
  const shouldKeepPaintable = shouldKeepHiddenWorktreeSurfacePaintable({
    // A mount-stage prewarm stays display:none so its style/layout cost lands in a later task.
    shouldMeasureHiddenWorktree: shouldMeasureHiddenWorktree && prewarmStage !== 'mount',
    needsBrowserGuestPaint
  })

  const surfaceRef = useRef<HTMLDivElement>(null)
  const slotPaneId = isVisible ? paneId : null
  const paneFocusHandlers = useWorkspaceSurfacePaneSlot(surfaceRef, slotPaneId, worktreeId)

  return (
    <div
      ref={surfaceRef}
      {...paneFocusHandlers}
      className={
        isVisible
          ? 'absolute inset-0 flex'
          : shouldKeepPaintable
            ? 'absolute inset-0 flex opacity-0 pointer-events-none'
            : 'absolute inset-0 hidden'
      }
      inert={!isVisible}
      aria-hidden={!isVisible}
      data-workspace-surface-id={worktreeId}
      data-workspace-surface-pane-id={slotPaneId ?? undefined}
    >
      <WorkspaceFileTreePanel worktreeId={worktreeId} isVisible={isVisible} paneId={slotPaneId} />
      <TabGroupSplitLayout
        layout={layout}
        worktreeId={worktreeId}
        focusedGroupId={focusedGroupId}
        isWorktreeActive={isVisible}
        isWorktreeFocused={isFocused}
        inSplitViewPane={slotPaneId !== null}
      />
      <WorkspacePaneOverlayLayers
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isVisible={isVisible}
        isFocused={isFocused}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        hiddenTerminalPrewarm={prewarmStage === 'mount' ? null : prewarmStage}
        shouldColdParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={isForceParked}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIds}
        activationDeferredMountTabIds={activationDeferredMountTabIds}
        mountRetainedBrowserOverlay={shouldMountRetainedBrowserOverlay({
          isWorktreeVisible: isVisible,
          hasDeferredBackgroundMounts: backgroundMountTabIds !== null,
          needsBrowserGuestPaint
        })}
        mountEmulatorOverlay={isVisible || backgroundMountTabIds === null}
      />
    </div>
  )
})
