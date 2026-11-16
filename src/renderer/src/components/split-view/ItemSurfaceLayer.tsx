import { Activity, useMemo, useRef, useState } from 'react'
import { LiveSessionBody } from '@/components/live-sessions/workspace/LiveSessionBody'
import { useLiveSessionTabs } from '@/components/live-sessions/workspace/live-session-tabs-store'
import { ProjectOverviewBody } from '@/components/project-overview/ProjectOverviewPage'
import { resolveProjectOverviewRepo } from '@/components/project-overview/project-overview-model'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store/index'
import { ITEM_SURFACE_PANE_ATTRIBUTE, SINGLE_VIEW_ITEM_SLOT_ID } from './ItemSurfaceSlot'
import { closeSplitViewItems, focusSplitViewPane } from './split-view-commands'
import { useSplitViewShowing } from './split-view-showing'
import { useSplitView, useSplitViewNarrow, visibleSplitViewPaneIds } from './split-view-store'
import { splitViewItemKey, type SplitViewItem } from './split-view-types'
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

/** Every session and project the main area holds: the grid's tabs, or single view's one page. */
function useItemSurfacePlaces(): ItemSurfacePlace[] {
  const state = useSplitView()
  const narrow = useSplitViewNarrow()
  const showing = useSplitViewShowing()
  const activeView = useAppStore((s) => s.activeView)
  const project = useAppStore((s) => s.projectOverviewTarget)
  const sessionId = useLiveSessionTabs().activeId
  const repos = useAppStore((s) => s.repos)
  return useMemo(() => {
    // The pane or the page says a project is gone, with the way out.
    const shows = (item: SurfaceItem): boolean =>
      item.kind === 'session' || resolveProjectOverviewRepo(repos, item) !== null
    if (state.layout) {
      const onScreen = new Set(showing ? visibleSplitViewPaneIds(state, narrow) : [])
      return Object.entries(state.panes).flatMap(([paneId, pane]) =>
        pane.tabs.flatMap(({ item }): ItemSurfacePlace[] => {
          if (item.kind === 'workspace' || !shows(item)) {
            return []
          }
          const key = splitViewItemKey(item)
          const front = onScreen.has(paneId) && pane.activeKey === key
          return [{ key, item, paneId, slotId: front ? paneId : null }]
        })
      )
    }
    const item: SurfaceItem | null =
      activeView === 'sessions' && sessionId
        ? { kind: 'session', sessionId }
        : activeView === 'project' && project
          ? { kind: 'project', ...project }
          : null
    return item && shows(item)
      ? [{ key: splitViewItemKey(item), item, paneId: null, slotId: SINGLE_VIEW_ITEM_SLOT_ID }]
      : []
  }, [state, narrow, showing, activeView, project, sessionId, repos])
}

/** React hands a surface the events of its menus too, which are drawn outside it. */
function isInSurface(event: React.SyntheticEvent<HTMLElement>): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target)
}

function ItemSurface({ place }: { place: ItemSurfacePlace }): React.JSX.Element {
  const { key, item, paneId, slotId } = place
  const closeProjectOverview = useAppStore((s) => s.closeProjectOverview)
  const surfaceRef = useRef<HTMLDivElement>(null)
  useSurfaceOverSlot(surfaceRef, slotId)
  const front = slotId !== null
  const focusPane = (event: React.SyntheticEvent<HTMLElement>): void => {
    if (paneId && isInSurface(event)) {
      focusSplitViewPane(paneId)
    }
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
      onFocusCapture={focusPane}
    >
      {/* Out of sight it keeps its draft and its place, and stops marking what arrives as seen. */}
      <Activity mode={front ? 'visible' : 'hidden'}>
        {item.kind === 'session' ? (
          <div className="flex min-h-0 flex-1">
            <LiveSessionBody sessionId={item.sessionId} />
          </div>
        ) : (
          <ProjectOverviewBody
            target={item}
            onClose={paneId ? () => closeSplitViewItems(new Set([key])) : closeProjectOverview}
          />
        )}
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
