import { useEffect, useMemo, useRef } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { SplitLayoutLeafPlacement } from '../tab-group/SplitLayoutTree'
import { ItemTabStrip, type ItemTabCommands } from './ItemTabStrip'
import {
  closeOtherSplitViewItems,
  closeSplitViewItems,
  closeSplitViewPane,
  focusSplitViewPane,
  keepSplitViewItem,
  placeItemsInSplitView,
  toggleSplitViewPaneMaximized
} from './split-view-commands'
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

/** A press or focus on a tab is that tab's own business: it activates on click. */
function landsOnTab(target: EventTarget): boolean {
  return target instanceof Element && target.closest('[role="tab"], button') !== null
}

const PANE_CONTENT_SELECTOR = `[${SPLIT_VIEW_PANE_ATTRIBUTE}], [data-workspace-surface-pane-id]`

/**
 * Focusing a pane by shortcut or by navigation leaves keyboard focus where it was, which may be
 * a terminal or a composer in a pane that just lost focus; keys must not keep going there.
 */
function takeKeyboardFocusFromOtherPanes(paneId: string, pane: HTMLElement): void {
  const owner = document.activeElement
  const content = owner instanceof HTMLElement ? owner.closest(PANE_CONTENT_SELECTOR) : null
  if (
    !(owner instanceof HTMLElement) ||
    !content ||
    content === pane ||
    content.getAttribute('data-workspace-surface-pane-id') === paneId
  ) {
    return
  }
  const body = pane.querySelector<HTMLElement>('[data-split-view-pane-body]')
  if (body) {
    body.focus({ preventScroll: true })
  } else {
    // A workspace's terminal or editor takes focus by itself once its pane is the focused one.
    owner.blur()
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
  const paneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused && paneRef.current) {
      takeKeyboardFocusFromOtherPanes(paneId, paneRef.current)
    }
  }, [focused, paneId])
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
        if (!landsOnTab(event.target)) {
          focusSplitViewPane(paneId)
        }
      }}
      onFocusCapture={(event) => {
        if (!landsOnTab(event.target)) {
          focusSplitViewPane(paneId)
        }
      }}
    >
      <ItemTabStrip
        paneId={paneId}
        tabs={pane?.tabs ?? []}
        activeKey={pane?.activeKey ?? null}
        label={t('seal.splitView.pane.tabs', 'Tabs in this pane')}
        commands={commands}
        className={cn(
          'pointer-events-auto relative',
          // The focused pane is told apart by a line and by strength, not by color alone.
          focused
            ? "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-[2px] before:bg-tab-active-indicator before:content-['']"
            : '[&_[role=tablist]]:opacity-60'
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
