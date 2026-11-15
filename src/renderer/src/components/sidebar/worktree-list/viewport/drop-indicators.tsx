import { WorktreeSidebarDropIndicator } from '../drag/WorktreeSidebarDropIndicator'
import type { useWorktreeDragRuntime } from '../drag/use-runtime'
import type { useWorktreeSidebarHeaderDrag } from '../drag/use-header-drag'

export function renderWorktreeSidebarDropIndicators(args: {
  headerDrag: ReturnType<typeof useWorktreeSidebarHeaderDrag>
  worktreeDragState: ReturnType<typeof useWorktreeDragRuntime>['worktreeDragState']
  // Drop lines are measured in scroll coordinates and drawn in the rows' own box.
  scrollMargin: number
}): React.ReactNode {
  const { headerDrag, worktreeDragState, scrollMargin } = args
  return (
    <>
      {headerDrag.canReorderRepoHeaders &&
      headerDrag.repoDrag.state.draggingRepoId !== null &&
      headerDrag.repoDrag.state.dropIndicatorY !== null ? (
        <WorktreeSidebarDropIndicator y={headerDrag.repoDrag.state.dropIndicatorY - scrollMargin} />
      ) : null}
      {headerDrag.canReorderProjectGroupHeaders &&
      headerDrag.projectGroupDrag.state.draggingGroupId !== null &&
      headerDrag.projectGroupDrag.state.dropIndicatorY !== null ? (
        <WorktreeSidebarDropIndicator
          y={headerDrag.projectGroupDrag.state.dropIndicatorY - scrollMargin}
        />
      ) : null}
      {headerDrag.hostDrag.state.draggingHostId !== null &&
      headerDrag.hostDrag.state.dropIndicatorY !== null ? (
        <WorktreeSidebarDropIndicator
          y={headerDrag.hostDrag.state.dropIndicatorY - scrollMargin}
          className="z-40"
        />
      ) : null}
      {worktreeDragState.draggingWorktreeId !== null &&
      worktreeDragState.dropIndicatorY !== null ? (
        <WorktreeSidebarDropIndicator y={worktreeDragState.dropIndicatorY - scrollMargin} />
      ) : null}
    </>
  )
}
