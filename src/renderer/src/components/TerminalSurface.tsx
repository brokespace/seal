import EditorAutosaveController from './editor/autosave/EditorAutosaveController'
import { useAnyBrowserGuestNeedsPaint } from './browser-pane/host-guest/browser-guest-paint-retention'
import { TerminalTitlebarTabs } from './TerminalTitlebarTabs'
import { TerminalSplitWorkspaceSurfaces } from './TerminalSplitWorkspaceSurfaces'
import { TerminalLegacyWorkspaceSurface } from './TerminalLegacyWorkspaceSurface'
import { TerminalWorkspaceDialogs } from './TerminalWorkspaceDialogs'
import { WslHostStoppedWorkspaceNotice } from './wsl-host-stopped/WslHostStoppedWorkspaceNotice'
import type { TerminalController } from './use-terminal-controller'

export function TerminalSurface({
  controller
}: {
  controller: TerminalController
}): React.JSX.Element {
  const { renderedActiveWorktreeId, splitViewShowing } = controller
  // Split view shows workspaces in panes whether or not one of them is the active workspace.
  const showsWorkspaces = Boolean(renderedActiveWorktreeId) || splitViewShowing
  const retainBrowserGuestPaint = useAnyBrowserGuestNeedsPaint(!showsWorkspaces)
  return (
    <div
      // The workbench already removes hidden content from flow; only keep this ancestor paintable.
      className={`relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden${
        showsWorkspaces
          ? ''
          : retainBrowserGuestPaint
            ? ' opacity-0 pointer-events-none'
            : ' hidden'
      }`}
      data-rendered-active-worktree-id={renderedActiveWorktreeId ?? undefined}
    >
      <EditorAutosaveController />
      <TerminalTitlebarTabs controller={controller} />
      <TerminalSplitWorkspaceSurfaces controller={controller} />
      <TerminalLegacyWorkspaceSurface controller={controller} />
      {/* Sized to the whole workbench, so it would cover other panes. */}
      <WslHostStoppedWorkspaceNotice
        worktreeId={splitViewShowing ? null : renderedActiveWorktreeId}
      />
      <TerminalWorkspaceDialogs controller={controller} />
    </div>
  )
}
