import { useEffect, useMemo, useRef } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { SplitLayoutLeafPlacement } from '../tab-group/SplitLayoutTree'
import { ItemTabStrip, type ItemTabCommands } from './ItemTabStrip'
import { focusWorkspacePaneContent } from './pane-workspace-keyboard-focus'
import {
  closeOtherSplitViewItems,
  closeSplitViewItems,
  closeSplitViewPane,
  focusSplitViewPane,
  keepSplitViewItem,
  placeItemsInSplitView,
  toggleSplitViewPaneMaximized
} from './split-view-commands'
import { ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'
import { SPLIT_VIEW_PANE_ATTRIBUTE } from './split-view-pane-size'
import { useSplitView } from './split-view-store'
import { activeSplitViewItem, splitViewItemKey } from './split-view-types'
import { SplitViewPaneBody } from './SplitViewPaneBody'
import { useResolvedSplitViewItem, useSplitViewItemTitle } from './use-resolved-split-view-item'

function paneTabCommands(paneId: string): ItemTabCommands {
  return {
    activate: (item) => focusSplitViewPane(paneId, splitViewItemKey(item)),
    keep: (item) => keepSplitViewItem(splitViewItemKey(item)),
    close: (item) => closeSplitViewItems(new Set([splitViewItemKey(item)])),
    closeOthers: (item) => closeOtherSplitViewItems(paneId, splitViewItemKey(item)),
    closePane: () => closeSplitViewPane(paneId),
    moveToNewPane: (item, edge) => placeItemsInSplitView([item], { paneId, zone: edge })
  }
}

const STRIP_CONTROL_SELECTOR = `[${ITEM_TAB_STRIP_ATTRIBUTE}] [role="tab"], [${ITEM_TAB_STRIP_ATTRIBUTE}] button`

/** A press or focus on a tab or a strip button is its own business: it acts on the pane itself. */
function landsOnStripControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest(STRIP_CONTROL_SELECTOR) !== null
}

const PANE_CONTENT_SELECTOR = `[${SPLIT_VIEW_PANE_ATTRIBUTE}], [data-workspace-surface-pane-id]`

/**
 * Keyboard focus belongs in the focused pane. Focusing a pane by shortcut or by navigation leaves
 * it in the pane that lost focus, and closing the tab that held it leaves it nowhere.
 */
function bringKeyboardFocusIntoPane(
  paneId: string,
  pane: HTMLElement,
  worktreeId: string | null
): void {
  const active = document.activeElement
  const owner = active instanceof HTMLElement && active !== document.body ? active : null
  const content = owner?.closest(PANE_CONTENT_SELECTOR) ?? null
  if (
    owner &&
    (!content ||
      content === pane ||
      content.getAttribute('data-workspace-surface-pane-id') === paneId)
  ) {
    return
  }
  const body = pane.querySelector<HTMLElement>('[data-split-view-pane-body]')
  if (body) {
    body.focus({ preventScroll: true })
    return
  }
  owner?.blur()
  if (worktreeId) {
    focusWorkspacePaneContent(paneId, worktreeId)
  }
}

/** One rectangle of the grid: its strip of tabs, and the active one's content. */
export function SplitViewPane({
  paneId,
  placement,
  shown,
  canMaximize
}: {
  paneId: string
  placement: SplitLayoutLeafPlacement
  /** False while another pane is drawn alone (maximized, or a main area too narrow for two). */
  shown: boolean
  canMaximize: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const state = useSplitView()
  const pane = state.panes[paneId]
  const focused = state.focusedPaneId === paneId
  const maximized = state.maximizedPaneId === paneId
  const active = activeSplitViewItem(state, paneId)
  const resolved = useResolvedSplitViewItem(active)
  const title = useSplitViewItemTitle(active, resolved)
  const commands = useMemo(() => paneTabCommands(paneId), [paneId])
  const activeKey = pane?.activeKey ?? null
  const worktreeId = active?.kind === 'workspace' ? active.worktreeId : null
  const paneRef = useRef<HTMLDivElement>(null)
  // A tab closed anywhere takes its close button away, and the keyboard with it.
  const tabCount = Object.values(state.panes).reduce((count, each) => count + each.tabs.length, 0)
  useEffect(() => {
    if (focused && paneRef.current) {
      bringKeyboardFocusIntoPane(paneId, paneRef.current, worktreeId)
    }
  }, [focused, paneId, activeKey, worktreeId, tabCount])
  const maximizeLabel = maximized
    ? t('seal.splitView.pane.restore', 'Restore panes')
    : t('seal.splitView.pane.maximize', 'Maximize pane')
  const closeLabel = t('seal.splitView.pane.close', 'Close pane')

  return (
    <div
      ref={paneRef}
      role="group"
      aria-label={title}
      {...{ [SPLIT_VIEW_PANE_ATTRIBUTE]: paneId }}
      data-split-view-pane-focused={focused ? '' : undefined}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        !placement.touchesLeftEdge && !placement.suppressLeftBorder && 'border-l border-border'
      )}
      onPointerDownCapture={(event) => {
        if (!landsOnStripControl(event.target)) {
          focusSplitViewPane(paneId)
        }
      }}
      onFocusCapture={(event) => {
        if (!landsOnStripControl(event.target)) {
          focusSplitViewPane(paneId)
        }
      }}
    >
      <ItemTabStrip
        paneId={paneId}
        tabs={pane?.tabs ?? []}
        activeKey={activeKey}
        label={t('seal.splitView.pane.tabs', 'Tabs in this pane')}
        commands={commands}
        className={cn(
          'pointer-events-auto relative',
          // The focused pane is told apart by a line and by strength, not by color alone.
          focused
            ? "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-[2px] before:bg-tab-active-indicator before:content-['']"
            : '[&_[role=tab][aria-selected=true]]:text-muted-foreground'
        )}
        after={
          <div className="flex shrink-0 items-center gap-0.5 px-1">
            {canMaximize ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-split-view-pane-action="maximize"
                aria-label={maximizeLabel}
                aria-pressed={maximized}
                title={maximizeLabel}
                onClick={() => toggleSplitViewPaneMaximized(paneId)}
              >
                {maximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-split-view-pane-action="close"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={() => closeSplitViewPane(paneId)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        }
      />
      <SplitViewPaneBody
        paneId={paneId}
        item={active}
        resolved={resolved}
        title={title}
        shown={shown}
      />
    </div>
  )
}
