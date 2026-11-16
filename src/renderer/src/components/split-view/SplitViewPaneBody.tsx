import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WslHostStoppedWorkspaceNotice } from '@/components/wsl-host-stopped/WslHostStoppedWorkspaceNotice'
import { useTranslate } from '@/i18n/use-translate'
import { KEEPS_FOCUS_ATTRIBUTE } from '@/lib/overlay-interaction/focus-keeping-press'
import { useAppStore } from '@/store/index'
import {
  canAdmitTerminalTabsForStartup,
  requestBackgroundTerminalWorktreeMount
} from '../terminal/background-terminal-worktree-mount'
import { registerTabGroupBody } from '../tab-group/tab-group-body-geometry'
import { ItemSurfaceSlot } from './ItemSurfaceSlot'
import { resolveReattachableTabIds } from './pane-workspace-reattach'
import { useWorkspaceSurfaceInPane } from './pane-workspace-surfaces'
import { closeSplitViewItems, focusSplitViewPane } from './split-view-commands'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { splitViewItemKey, type SplitViewItem } from './split-view-types'

function Placeholder({
  children,
  onClose,
  onLoad
}: {
  children: React.ReactNode
  onClose?: () => void
  onLoad?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      data-split-view-placeholder={onClose ? 'unavailable' : onLoad ? 'paused' : 'loading'}
      // What cannot take focus must not take the keyboard from the pane that has it.
      {...(onClose ? { [KEEPS_FOCUS_ATTRIBUTE]: '' } : {})}
      onMouseDown={onClose ? (event) => event.preventDefault() : undefined}
      className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground"
    >
      <p>{children}</p>
      {onClose ? (
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t('seal.splitView.placeholder.close', 'Close')}
        </Button>
      ) : null}
      {onLoad ? (
        <Button type="button" variant="outline" size="sm" onClick={onLoad}>
          {t('seal.splitView.placeholder.load', 'Load')}
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
  // Until startup publishes PTY ownership, a hidden mount could duplicate shells.
  const sessionReady = useAppStore(canAdmitTerminalTabsForStartup)
  const [awaitsFocus, setAwaitsFocus] = useState(false)

  useLayoutEffect(
    () => (slotRef.current ? registerTabGroupBody(paneId, slotRef.current) : undefined),
    [paneId]
  )
  // A workspace this run has not activated has no surface yet; mount it without activating it,
  // and only the terminals that reattach: showing a workspace never starts a shell.
  useEffect(() => {
    if (!available || surfaceShown || !sessionReady) {
      return
    }
    let stale = false
    void resolveReattachableTabIds(worktreeId).then((tabIds) => {
      if (stale) {
        return
      }
      setAwaitsFocus(tabIds === null)
      if (tabIds) {
        requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds })
      }
    })
    return () => {
      stale = true
    }
  }, [available, sessionReady, surfaceShown, worktreeId])

  return (
    <div
      ref={slotRef}
      data-split-view-workspace-slot={worktreeId}
      className="relative min-h-0 min-w-0 flex-1"
    >
      {surfaceShown ? null : available && awaitsFocus ? (
        <Placeholder onLoad={() => focusSplitViewPane(paneId)}>
          {t('seal.splitView.placeholder.paused', '{{name}} starts when you focus this pane.', {
            name: title
          })}
        </Placeholder>
      ) : available ? (
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
  title,
  shown
}: {
  paneId: string
  item: SplitViewItem | null
  resolved: ResolvedSplitViewItem | null
  title: string
  shown: boolean
}): React.JSX.Element {
  const t = useTranslate()
  // What is out of sight has no slot: nothing asks to load a workspace or to draw over it.
  if (!item || !shown) {
    return <div className="flex-1" />
  }
  const close = (): void => closeSplitViewItems(new Set([splitViewItemKey(item)]))
  if (item.kind === 'workspace') {
    return (
      <WorkspaceSlot
        key={item.worktreeId}
        paneId={paneId}
        worktreeId={item.worktreeId}
        available={resolved !== null}
        title={title}
        onClose={close}
      />
    )
  }
  return (
    <ItemSurfaceSlot slotId={paneId}>
      {item.kind === 'project' && !resolved ? (
        <Placeholder onClose={close}>
          {t('seal.splitView.placeholder.projectUnavailable', 'This project is not available.')}
        </Placeholder>
      ) : null}
    </ItemSurfaceSlot>
  )
}
