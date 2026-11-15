import { useEffect, useLayoutEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { LiveSessionBody } from '@/components/live-sessions/workspace/LiveSessionBody'
import { ProjectOverviewBody } from '@/components/project-overview/ProjectOverviewPage'
import { WslHostStoppedWorkspaceNotice } from '@/components/wsl-host-stopped/WslHostStoppedWorkspaceNotice'
import { useTranslate } from '@/i18n/use-translate'
import { requestBackgroundTerminalWorktreeMount } from '../terminal/background-terminal-worktree-mount'
import { registerTabGroupBody } from '../tab-group/tab-group-body-geometry'
import { useWorkspaceSurfaceInPane } from './pane-workspace-surfaces'
import { closeSplitViewItems } from './split-view-commands'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { splitViewItemKey, type SplitViewItem } from './split-view-types'

function Placeholder({
  children,
  onClose
}: {
  children: React.ReactNode
  onClose?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      data-split-view-placeholder={onClose ? 'unavailable' : 'loading'}
      className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground"
    >
      <p>{children}</p>
      {onClose ? (
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t('seal.splitView.placeholder.close', 'Close')}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * A workspace is not rendered here: the retained workbench lays its surface over this empty,
 * click-through slot, so terminals and embedded pages never remount.
 */
function WorkspaceSlot({
  paneId,
  worktreeId,
  available,
  title,
  onClose
}: {
  paneId: string
  worktreeId: string
  available: boolean
  title: string
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const slotRef = useRef<HTMLDivElement>(null)
  const surfaceShown = useWorkspaceSurfaceInPane(worktreeId)

  useLayoutEffect(
    () => (slotRef.current ? registerTabGroupBody(paneId, slotRef.current) : undefined),
    [paneId]
  )
  // A workspace this run has not activated has no surface yet; mount it without activating it.
  useEffect(() => {
    if (available && !surfaceShown) {
      requestBackgroundTerminalWorktreeMount({ worktreeId })
    }
  }, [available, surfaceShown, worktreeId])

  return (
    <div
      ref={slotRef}
      data-split-view-workspace-slot={worktreeId}
      className="relative min-h-0 min-w-0 flex-1"
    >
      {surfaceShown ? null : available ? (
        <Placeholder>
          {t('seal.splitView.placeholder.loading', 'Loading {{name}}', { name: title })}
        </Placeholder>
      ) : (
        <Placeholder onClose={onClose}>
          {t('seal.splitView.placeholder.workspaceUnavailable', 'This workspace is not available.')}
        </Placeholder>
      )}
      {/* The workbench's own copy is sized to the whole main area; here it stays in its pane. */}
      <WslHostStoppedWorkspaceNotice worktreeId={worktreeId} />
    </div>
  )
}

/** What a pane shows under its strip, by the kind of its active item. */
export function SplitViewPaneBody({
  paneId,
  item,
  resolved,
  title
}: {
  paneId: string
  item: SplitViewItem | null
  resolved: ResolvedSplitViewItem | null
  title: string
}): React.JSX.Element {
  const t = useTranslate()
  if (!item) {
    return <div className="flex-1" />
  }
  const close = (): void => closeSplitViewItems(new Set([splitViewItemKey(item)]))
  if (item.kind === 'workspace') {
    return (
      <WorkspaceSlot
        paneId={paneId}
        worktreeId={item.worktreeId}
        available={resolved !== null}
        title={title}
        onClose={close}
      />
    )
  }
  return (
    <div
      data-split-view-pane-body={item.kind}
      className="pointer-events-auto relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
    >
      {item.kind === 'session' ? (
        <div className="flex min-h-0 flex-1">
          <LiveSessionBody sessionId={item.sessionId} />
        </div>
      ) : resolved ? (
        <ProjectOverviewBody target={item} onClose={close} />
      ) : (
        <Placeholder onClose={close}>
          {t('seal.splitView.placeholder.projectUnavailable', 'This project is not available.')}
        </Placeholder>
      )}
    </div>
  )
}
