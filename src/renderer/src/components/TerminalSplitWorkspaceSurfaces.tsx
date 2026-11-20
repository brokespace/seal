import { useAnyBrowserGuestNeedsPaint } from './browser-pane/host-guest/browser-guest-paint-retention'
import { WorktreeSplitSurface } from './TerminalWorktreeSplitSurface'
import { selectParkedEquivalentMountTabIds } from './terminal/startup-terminal-tab-hold'
import type { TerminalController } from './use-terminal-controller'

export function TerminalSplitWorkspaceSurfaces({
  controller
}: {
  controller: TerminalController
}): React.JSX.Element | null {
  const {
    activationDeferredMountTabIdsByWorktreeRef,
    activeGroupIdByWorktree,
    activeView,
    activityTerminalPortals,
    anyMountedWorktreeHasLayout,
    backgroundMountTabIdsByWorktreeRef,
    effectiveActiveLayout,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    getEffectiveLayoutForWorktree,
    prewarmLeasesRef,
    measurableBackgroundWorktreeIdsRef,
    mountedWorktreeIdsRef,
    renderedActiveWorktreeId,
    splitViewShowing,
    startupTerminalTabHold,
    visibleWorkspacePanes,
    workspaceSurfaces
  } = controller
  // In split view the panes decide what shows, so the area stays up with no active workspace layout.
  const showsSurfaces = splitViewShowing ? visibleWorkspacePanes.size > 0 : !!effectiveActiveLayout
  // Every browser guest has this and TerminalSurface as ancestors; both must allow compositing for remote control to receive frames.
  const retainBrowserGuestPaint = useAnyBrowserGuestNeedsPaint(!showsSurfaces)
  if (!anyMountedWorktreeHasLayout) {
    return null
  }
  return (
    <div
      className={`relative flex flex-1 min-w-0 min-h-0 overflow-hidden${
        showsSurfaces ? '' : retainBrowserGuestPaint ? ' opacity-0 pointer-events-none' : ' hidden'
      }`}
    >
      {workspaceSurfaces
        .filter((workspace) => mountedWorktreeIdsRef.current.has(workspace.id))
        .map((workspace) => {
          const layout = getEffectiveLayoutForWorktree(workspace.id)
          if (!layout) {
            return null
          }
          const isVisible = visibleWorkspacePanes.has(workspace.id)
          const shouldMeasureHiddenWorktree =
            !isVisible && measurableBackgroundWorktreeIdsRef.current.has(workspace.id)
          const shouldColdParkTerminalPanes =
            !isVisible &&
            !shouldMeasureHiddenWorktree &&
            effectiveParkedTerminalWorktreeIds.has(workspace.id)
          return (
            <WorktreeSplitSurface
              key={`tab-groups-${workspace.id}`}
              worktreeId={workspace.id}
              worktreePath={workspace.path}
              layout={layout}
              focusedGroupId={activeGroupIdByWorktree[workspace.id]}
              isVisible={isVisible}
              isFocused={
                isVisible && activeView === 'terminal' && workspace.id === renderedActiveWorktreeId
              }
              paneId={visibleWorkspacePanes.get(workspace.id) ?? null}
              shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
              prewarmStage={
                shouldMeasureHiddenWorktree
                  ? (prewarmLeasesRef.current.get(workspace.id) ?? null)
                  : null
              }
              shouldColdParkTerminalPanes={shouldColdParkTerminalPanes}
              isForceParked={forceParkedTerminalWorktreeIds.has(workspace.id)}
              activityTerminalPortals={activityTerminalPortals}
              backgroundMountTabIds={
                backgroundMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null
              }
              activationDeferredMountTabIds={selectParkedEquivalentMountTabIds(
                activationDeferredMountTabIdsByWorktreeRef.current.get(workspace.id),
                startupTerminalTabHold,
                workspace.id
              )}
            />
          )
        })}
    </div>
  )
}
