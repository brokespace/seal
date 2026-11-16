import { memo, Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store/index'
import { usePaneWorkspaceHostId } from './use-pane-workspace-host'
import { WorkspaceFileTreeLiveSync } from './WorkspaceFileTreeLiveSync'
import { WorkspaceFileTreeToggle } from './WorkspaceFileTreeToggle'
import {
  WORKSPACE_FILE_TREE_MAX_WIDTH,
  WORKSPACE_FILE_TREE_MIN_WIDTH,
  useWorkspaceFileTreeOpen,
  useWorkspaceFileTreeWidth,
  workspaceFileTreeStore
} from './workspace-file-tree-store'

const FileExplorer = lazy(() => import('../right-sidebar/file-explorer/panel/FileExplorer'))

type WorkspaceFileTreePanelProps = {
  worktreeId: string
  /** The workspace is on screen; a retained hidden surface keeps the panel's width but no tree. */
  isVisible: boolean
  /** The split-view pane showing the workspace; null in the single view. */
  paneId: string | null
}

type PanelChrome = {
  /** The single view owns the sidebar seam; a pane only parts the tree from its tab groups. */
  edge: string
  /** Matches the tab strip beside it: 36px with the window drag strip, 32px in a pane. */
  header: string
  /** The collapsed sidebar floats its header over the single view's top-left corner. */
  clearsFloatingHeader: boolean
}

function usePanelChrome(paneId: string | null): PanelChrome {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  return paneId === null
    ? {
        edge: 'workspace-sidebar-seam border-l border-border',
        header: 'h-9',
        clearsFloatingHeader: !sidebarOpen
      }
    : { edge: 'border-r border-border', header: 'h-8', clearsFloatingHeader: false }
}

function OpenFileTree({
  worktreeId,
  isVisible,
  paneId
}: WorkspaceFileTreePanelProps): React.JSX.Element {
  const t = useTranslate()
  const chrome = usePanelChrome(paneId)
  const executionHostId = usePaneWorkspaceHostId(paneId, worktreeId)
  const width = useWorkspaceFileTreeWidth()
  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width,
    minWidth: WORKSPACE_FILE_TREE_MIN_WIDTH,
    maxWidth: WORKSPACE_FILE_TREE_MAX_WIDTH,
    deltaSign: 1,
    setWidth: (next) => workspaceFileTreeStore.setWidth(next)
  })

  return (
    <div
      ref={containerRef}
      // Why half: a narrow pane keeps room for its tabs whatever width the tree was dragged to.
      className={cn('relative flex max-w-1/2 shrink-0 flex-col bg-sidebar', chrome.edge)}
      data-workspace-file-tree={worktreeId}
    >
      {chrome.clearsFloatingHeader ? <div className="h-9 shrink-0 border-b border-border" /> : null}
      <div
        className={cn(
          'flex shrink-0 items-center gap-1.5 border-b border-border px-1.5',
          chrome.header
        )}
      >
        <WorkspaceFileTreeToggle worktreeId={worktreeId} open />
        <span className="min-w-0 truncate text-2xs font-semibold uppercase tracking-wider text-foreground">
          {t('seal.fileTree.title', 'Files')}
        </span>
      </div>
      <div className="scrollbar-sleek-parent flex min-h-0 flex-1 flex-col overflow-hidden">
        {isVisible ? (
          <RecoverableRenderErrorBoundary
            boundaryId="workspace-file-tree"
            surface="terminal-workbench"
            resetKey={worktreeId}
            title={t('seal.fileTree.error.title', 'The file tree hit an error.')}
            description={t(
              'seal.fileTree.error.description',
              'The workspace is still running. Retry, or hide the files and show them again.'
            )}
          >
            <WorkspaceFileTreeLiveSync worktreeId={worktreeId} executionHostId={executionHostId} />
            <Suspense fallback={null}>
              <FileExplorer worktreeId={worktreeId} executionHostId={executionHostId} embedded />
            </Suspense>
          </RecoverableRenderErrorBoundary>
        ) : null}
      </div>
      <div
        className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30"
        onMouseDown={onResizeStart}
      />
    </div>
  )
}

function ClosedFileTreeRail({
  worktreeId,
  paneId
}: Pick<WorkspaceFileTreePanelProps, 'worktreeId' | 'paneId'>): React.JSX.Element {
  const chrome = usePanelChrome(paneId)
  return (
    <div className={cn('flex w-7 shrink-0 flex-col items-center bg-sidebar', chrome.edge)}>
      {chrome.clearsFloatingHeader ? <div className="h-9 shrink-0" /> : null}
      <div className={cn('flex shrink-0 items-center', chrome.header)}>
        <WorkspaceFileTreeToggle worktreeId={worktreeId} open={false} />
      </div>
    </div>
  )
}

/**
 * A workspace's file tree at the left edge of its content: a slim rail while closed, the shared
 * explorer while open. Closed or off screen it mounts no tree, so it reads and watches nothing.
 */
export const WorkspaceFileTreePanel = memo(function WorkspaceFileTreePanel(
  props: WorkspaceFileTreePanelProps
): React.JSX.Element {
  const open = useWorkspaceFileTreeOpen(props.worktreeId)
  return open ? (
    <OpenFileTree {...props} />
  ) : (
    <ClosedFileTreeRail worktreeId={props.worktreeId} paneId={props.paneId} />
  )
})
