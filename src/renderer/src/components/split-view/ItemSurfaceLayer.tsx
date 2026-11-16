import { Activity, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LiveSessionBody } from '@/components/live-sessions/workspace/LiveSessionBody'
import { useLiveSessionTabs } from '@/components/live-sessions/workspace/live-session-tabs-store'
import { ProjectOverviewBody } from '@/components/project-overview/ProjectOverviewPage'
import { resolveProjectOverviewRepo } from '@/components/project-overview/project-overview-model'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store/index'
import { ITEM_SURFACE_PANE_ATTRIBUTE, SINGLE_VIEW_ITEM_SLOT_ID } from './ItemSurfaceSlot'
import { noteKeyboardInItemSurface } from './pane-keyboard-focus'
import { bridgeTabKeyFromItemSurface } from './pane-tab-key-order'
import { closeSplitViewItems, focusSplitViewPane } from './split-view-commands'
import { useSplitViewShowing } from './split-view-showing'
import { useSplitView, useSplitViewNarrow, visibleSplitViewPaneIds } from './split-view-store'
import { splitViewItemKey, type SplitViewItem } from './split-view-types'
import { useKeptScrollOffsets } from './use-kept-scroll-offsets'
import { useSurfaceOverSlot } from './use-surface-over-slot'

type SurfaceItem = Exclude<SplitViewItem, { kind: 'workspace' }>

type ItemSurfacePlace = {
  key: string
  item: SurfaceItem
  /** Null in single view. */
  paneId: string | null
  /** The slot it is in front of; null while another tab, pane or page covers it. */
  slotId: string | null
}

/**
 * Every session and project the main area holds: the grid's tabs, the agent-session page's tabs
 * and single view's project page.
 */
function useItemSurfacePlaces(): ItemSurfacePlace[] {
  const state = useSplitView()
  const narrow = useSplitViewNarrow()
  const showing = useSplitViewShowing()
  const activeView = useAppStore((s) => s.activeView)
  const project = useAppStore((s) => s.projectOverviewTarget)
  const { tabs: sessionTabs, activeId: sessionId } = useLiveSessionTabs()
  const repos = useAppStore((s) => s.repos)
  return useMemo(() => {
    const places = new Map<string, ItemSurfacePlace>()
    const hold = (item: SurfaceItem, paneId: string | null, slotId: string | null): void => {
      const key = splitViewItemKey(item)
      // The pane or the page says a project is gone, with the way out.
      if (
        !places.has(key) &&
        (item.kind === 'session' || resolveProjectOverviewRepo(repos, item))
      ) {
        places.set(key, { key, item, paneId, slotId })
      }
    }
    const grid = state.layout !== null
    const onScreen = new Set(grid && showing ? visibleSplitViewPaneIds(state, narrow) : [])
    for (const [paneId, pane] of grid ? Object.entries(state.panes) : []) {
      for (const { item } of pane.tabs) {
        if (item.kind !== 'workspace') {
          const front = onScreen.has(paneId) && pane.activeKey === splitViewItemKey(item)
          hold(item, paneId, front ? paneId : null)
        }
      }
    }
    // The session page's tabs stay loaded behind one another, and behind a grid, as a pane's do.
    for (const id of sessionTabs) {
      const front = !grid && activeView === 'sessions' && id === sessionId
      hold({ kind: 'session', sessionId: id }, null, front ? SINGLE_VIEW_ITEM_SLOT_ID : null)
    }
    if (!grid && activeView === 'project' && project) {
      hold({ kind: 'project', ...project }, null, SINGLE_VIEW_ITEM_SLOT_ID)
    }
    // A surface that changes place among the others in the page is detached, and so scrolled back.
    return [...places.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [state, narrow, showing, activeView, project, sessionTabs, sessionId, repos])
}

/** React hands a surface the events of its menus too, which are drawn outside it. */
function isInSurface(event: React.SyntheticEvent<HTMLElement>): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target)
}

function ItemSurface({ place }: { place: ItemSurfacePlace }): React.JSX.Element {
  const { key, item, paneId, slotId } = place
  const t = useTranslate()
  const closeProjectOverview = useAppStore((s) => s.closeProjectOverview)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const front = slotId !== null
  useSurfaceOverSlot(surfaceRef, slotId, true)
  useKeptScrollOffsets(surfaceRef, front)
  // Its effects stop one commit after it hides, so the chat first learns that it is out of sight.
  const [wasFront, setWasFront] = useState(front)
  useLayoutEffect(() => setWasFront(front), [front])
  const focusPane = (event: React.SyntheticEvent<HTMLElement>): void => {
    if (paneId && isInSurface(event)) {
      focusSplitViewPane(paneId)
    }
  }
  const noteFocus = (event: React.FocusEvent<HTMLElement>): void => {
    if (isInSurface(event) && event.target instanceof HTMLElement) {
      noteKeyboardInItemSurface(event.currentTarget, event.target)
    }
    focusPane(event)
  }
  return (
    <div
      ref={surfaceRef}
      data-split-view-pane-body={item.kind}
      {...(front && paneId ? { [ITEM_SURFACE_PANE_ATTRIBUTE]: paneId } : {})}
      tabIndex={-1}
      className={cn(
        'pointer-events-auto absolute flex min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground outline-none',
        !front && 'hidden'
      )}
      onPointerDownCapture={focusPane}
      onFocusCapture={noteFocus}
      onKeyDown={(event) => {
        if (paneId && isInSurface(event)) {
          bridgeTabKeyFromItemSurface(event, paneId)
        }
      }}
    >
      {/* Out of sight it keeps its draft and its place, and stops marking what arrives as seen. */}
      <Activity mode={front || wasFront ? 'visible' : 'hidden'}>
        {/* One that fails leaves the others, and their drafts, alone. */}
        <RecoverableRenderErrorBoundary
          boundaryId="item-surface"
          surface="page"
          title={t('auto.App.b7a714db1e', 'This page hit an error.')}
          description={t(
            'auto.App.03a14f6b5b',
            'Retry the page or navigate to another Orca surface.'
          )}
        >
          {item.kind === 'session' ? (
            <div className="flex min-h-0 flex-1">
              <LiveSessionBody sessionId={item.sessionId} visible={front} />
            </div>
          ) : (
            <ProjectOverviewBody
              target={item}
              onClose={paneId ? () => closeSplitViewItems(new Set([key])) : closeProjectOverview}
            />
          )}
        </RecoverableRenderErrorBoundary>
      </Activity>
    </div>
  )
}

const NONE_SHOWN: ReadonlySet<string> = new Set()

/**
 * Draws sessions and projects the way the workbench draws workspaces: one retained surface each,
 * laid over the slot of the pane or page showing it. A pane that splits, closes or moves, and
 * single view turning into a grid and back, remount nothing.
 */
export default function ItemSurfaceLayer(): React.JSX.Element {
  const places = useItemSurfacePlaces()
  // A tab that has never been in front is not loaded.
  const [shownKeys, setShownKeys] = useState(NONE_SHOWN)
  const mounted = places.filter((place) => place.slotId !== null || shownKeys.has(place.key))
  if (mounted.length !== shownKeys.size || mounted.some((place) => !shownKeys.has(place.key))) {
    setShownKeys(new Set(mounted.map((place) => place.key)))
  }
  return (
    <div data-item-surface-layer="" className="pointer-events-none absolute inset-0">
      {mounted.map((place) => (
        <ItemSurface key={place.key} place={place} />
      ))}
    </div>
  )
}
